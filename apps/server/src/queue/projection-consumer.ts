import type { Message, MessageBatch } from "@cloudflare/workers-types";
import { db } from "@yoyaku/db";
import { positions } from "@yoyaku/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { structuredLog } from "../lib/observability";
import type { Bindings, ProjectionMessage } from "../types";
import { projectionEnvelopeSchema } from "./envelope-schema";
import { gapDecision } from "./gap";
import { PROJECTIONS } from "./projections";
import type { Projection, ProjectionStmt } from "./projections/types";

/** Queue consumer。at-least-once・順序保証なし前提（NFR-04）。gap は能動 backfill で回復。 */
export async function handleProjectionBatch(
  batch: MessageBatch<ProjectionMessage>,
  env: Bindings,
): Promise<void> {
  for (const msg of batch.messages) {
    await projectMessage(msg, env);
  }
}

async function projectMessage(
  msg: Message<ProjectionMessage>,
  env: Bindings,
): Promise<void> {
  // 毒メッセージ隔離（指摘2）: envelope 構造を検証。不正なら自己修復しないため単体 retry→DLQ。
  const parsed = projectionEnvelopeSchema.safeParse(msg.body);
  if (!parsed.success) {
    console.log(
      structuredLog("error", "projection_envelope_invalid", {
        error: parsed.error.message,
      }),
    );
    msg.retry(); // 構造不正 → maxRetries 超過で DLQ に退避・記録される
    return;
  }
  try {
    for (const projection of PROJECTIONS) {
      if (!projection.subscribesTo(msg.body.aggregateType)) continue;
      const result = await advance(projection, msg.body, env);
      if (result === "retry") {
        msg.retry(); // backfill で埋まらない gap → 先行 seq を待って再配信（保険）
        return;
      }
    }
    msg.ack();
  } catch (e) {
    // 想定外の例外（apply の throw・D1 一時障害等）は **このメッセージ単体のみ** retry し、
    // バッチ全体を巻き込まない（従来は例外が batch へ伝播し全件再試行＝毒メッセージが後続を道連れにした）。
    // 決定的に失敗する毒メッセージは maxRetries 超過で DLQ へ退避され、DLQ consumer が記録する。
    console.log(
      structuredLog("error", "projection_message_failed", {
        eventId: msg.body.eventId,
        aggregateType: msg.body.aggregateType,
        aggregateId: msg.body.aggregateId,
        seq: msg.body.seq,
        eventType: msg.body.eventType,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    msg.retry();
  }
}

type AdvanceResult = "ack" | "retry";

async function advance(
  projection: Projection,
  body: ProjectionMessage,
  env: Bindings,
): Promise<AdvanceResult> {
  const { aggregateId, seq, aggregateType } = body;
  const last = await readLastSeq(projection.name, aggregateId);
  const decision = gapDecision(seq, last);
  if (decision === "skip") return "ack";
  if (decision === "apply") {
    await applyOne(projection, body);
    return "ack";
  }

  // gap（順序逆転/欠落）: DO（正本）から欠落分を能動取得して埋める（NFR-04・指摘 3）。
  await backfill(projection, aggregateId, aggregateType, env);

  const after = gapDecision(
    seq,
    await readLastSeq(projection.name, aggregateId),
  );
  if (after === "skip") return "ack";
  if (after === "apply") {
    await applyOne(projection, body);
    return "ack";
  }
  return "retry";
}

/** DO の events から (last, head] を取り出し、連続適用して read model の seq 連続性を回復。 */
async function backfill(
  projection: Projection,
  aggregateId: string,
  aggregateType: ProjectionMessage["aggregateType"],
  env: Bindings,
): Promise<void> {
  const stub = eventSourceStub(env, aggregateType, aggregateId);
  const from = await readLastSeq(projection.name, aggregateId);
  const missing = await stub.getEventsSince(from);
  for (const ev of missing) {
    const current = await readLastSeq(projection.name, aggregateId);
    if (ev.seq <= current) continue;
    if (ev.seq > current + 1) break; // DO は連続のはず。万一不連続なら retry に委ねる
    await applyOne(projection, ev);
  }
}

/** read model 更新＋positions 前進を単一 db.batch（D1=順序実行・暗黙Tx・全体ロールバック）。 */
async function applyOne(
  projection: Projection,
  body: ProjectionMessage,
): Promise<void> {
  // position 前進は **単調**（setWhere: lastSeq < seq）＝ position 列の後退のみを防ぐ。
  // 投影本体の stale write 防止: reservations/showings/seat_availabilities/ticket_types の各行 UPDATE/UPSERT は
  // `WHERE last_seq < :seq`（行ごと CAS）で順序非依存化済み。reorder/重複/backfill の再適用で read model を
  // 巻き戻さない（sales_dashboards は絶対値導出のため元々順序非依存）。
  // → maxConcurrency:1（alchemy.run.ts）は「唯一の砦」ではなく多層防御の一層。並行化しても read model 本体は
  //   壊れない（実際に maxConcurrency を上げるかはスループット要求と統合テストを前提に別途判断・§13 runbook）。
  const positionUpsert: ProjectionStmt = db
    .insert(positions)
    .values({
      projection: projection.name,
      aggregateId: body.aggregateId,
      lastSeq: body.seq,
    })
    .onConflictDoUpdate({
      target: [positions.projection, positions.aggregateId],
      set: { lastSeq: body.seq },
      setWhere: lt(positions.lastSeq, body.seq),
    });
  const statements: [ProjectionStmt, ...ProjectionStmt[]] = [
    positionUpsert,
    ...projection.apply(body),
  ];
  await db.batch(statements);
}

async function readLastSeq(
  projectionName: string,
  aggregateId: string,
): Promise<number> {
  const row = await db
    .select({ lastSeq: positions.lastSeq })
    .from(positions)
    .where(
      and(
        eq(positions.projection, projectionName),
        eq(positions.aggregateId, aggregateId),
      ),
    )
    .get();
  return row?.lastSeq ?? 0;
}

/** ソース DO の getEventsSince RPC スタブ（aggregateId=ctx.id.name で再構成）。 */
type EventSourceStub = {
  getEventsSince: (seq: number) => Promise<ProjectionMessage[]>;
};

function eventSourceStub(
  env: Bindings,
  aggregateType: ProjectionMessage["aggregateType"],
  aggregateId: string,
): EventSourceStub {
  const ns = aggregateType === "Showing" ? env.SHOWING : env.RESERVATION;
  return ns.getByName(aggregateId) as unknown as EventSourceStub;
}
