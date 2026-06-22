import { DurableObject } from "cloudflare:workers";
import { ulid } from "ulid";
import type { Bindings } from "../types";
import type { AllocateResult } from "./_shared/rpc";

type IntakeRow = {
  request_hash: string;
  canonical_id: string;
};

/**
 * 作成系コマンド（RegisterShowing/StartReservation）の冪等 ID 払い出し（FR-28・テーブル設計書 §2.6）。
 * addressing は `getByName(idempotencyKey)`＝1 冪等キー = 1 IntakeDO。
 * 同一キー＋同一 request_hash の再試行は保存済み正準 ID を返し、ハッシュ不一致は 409。
 */
export class IntakeDO extends DurableObject<Bindings> {
  private key: string;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.key = ctx.id.name ?? ctx.id.toString();
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS intake_keys (
           key TEXT PRIMARY KEY,
           command_type TEXT NOT NULL,
           request_hash TEXT NOT NULL,
           canonical_id TEXT NOT NULL,
           response_json TEXT,
           created_at INTEGER NOT NULL
         )`,
      );
    });
  }

  /**
   * 正準 ID を払い出す（単一ライターのため lookup→insert は原子的）。
   * - 既存キー＋hash 一致 → 保存済み canonical_id（isNew=false）
   * - 既存キー＋hash 不一致 → idempotency_conflict（409）
   * - 無し → ulid() を採番・記録（isNew=true）
   */
  async allocate(
    commandType: string,
    requestHash: string,
  ): Promise<AllocateResult> {
    const existing = this.ctx.storage.sql
      .exec<IntakeRow>(
        "SELECT request_hash, canonical_id FROM intake_keys WHERE key = ?",
        this.key,
      )
      .toArray();

    const row = existing[0];
    if (row) {
      if (row.request_hash !== requestHash) {
        return {
          ok: false,
          code: "idempotency_conflict",
          httpStatus: 409,
          message: "Idempotency-Key reused with a different request body",
        };
      }
      return { ok: true, canonicalId: row.canonical_id, isNew: false };
    }

    const canonicalId = ulid();
    this.ctx.storage.sql.exec(
      "INSERT INTO intake_keys (key, command_type, request_hash, canonical_id, created_at) VALUES (?, ?, ?, ?, ?)",
      this.key,
      commandType,
      requestHash,
      canonicalId,
      Date.now(),
    );
    return { ok: true, canonicalId, isNew: true };
  }
}
