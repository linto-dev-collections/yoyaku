import { computeRequestHash } from "@yoyaku/event-store";
import type {
  AllocateResult,
  IntakeStub,
} from "../durable-objects/_shared/rpc";
import type { Bindings } from "../types";

/**
 * IntakeDO で作成系コマンドの正準 ID を払い出す（二段冪等の一段目・§1）。
 * idemKey で DO を addressing し、request_hash（正規化本文の SHA-256）で再試行/横取りを判定。
 */
export async function allocateCanonicalId(
  env: Bindings,
  idemKey: string,
  commandType: string,
  body: unknown,
): Promise<AllocateResult> {
  const requestHash = await computeRequestHash(body);
  const stub = env.INTAKE.getByName(idemKey) as unknown as IntakeStub;
  return stub.allocate(commandType, requestHash);
}
