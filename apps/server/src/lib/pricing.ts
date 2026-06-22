import { db } from "@yoyaku/db";
import { seatAvailabilities, ticketTypes } from "@yoyaku/db/schema";
import type { Pricing } from "@yoyaku/shared";
import { and, eq, inArray } from "drizzle-orm";
import { APPLICATION_FEE_BPS } from "../durable-objects/_shared/policy";

export type PricingResult =
  | { ok: true; pricing: Pricing }
  | { ok: false; missingSeats: string[] };

/**
 * 確保対象席の固定価格を read model（ticket_types × seat_availabilities）から確定する（FR-38/BR-14）。
 * 各席の ticketTypeId→unitAmount を合算し、application_fee（既定 10%）を固定額へ組み込む（Phase 06）。
 * 席が read model に無い（未投影/不正）場合は missingSeats を返し route が 422 にする。
 */
export async function computePricing(
  showingId: string,
  seatIds: string[],
  currency: string,
): Promise<PricingResult> {
  const seatRows = await db
    .select({
      seatId: seatAvailabilities.seatId,
      ticketTypeId: seatAvailabilities.ticketTypeId,
    })
    .from(seatAvailabilities)
    .where(
      and(
        eq(seatAvailabilities.showingId, showingId),
        inArray(seatAvailabilities.seatId, seatIds),
      ),
    )
    .all();

  const seatToType = new Map(seatRows.map((s) => [s.seatId, s.ticketTypeId]));
  const missingSeats = seatIds.filter((id) => !seatToType.has(id));
  if (missingSeats.length > 0) return { ok: false, missingSeats };

  const typeRows = await db
    .select({
      ticketTypeId: ticketTypes.ticketTypeId,
      unitAmount: ticketTypes.unitAmount,
    })
    .from(ticketTypes)
    .where(eq(ticketTypes.showingId, showingId))
    .all();
  const unitOf = new Map(typeRows.map((t) => [t.ticketTypeId, t.unitAmount]));

  let subtotalAmount = 0;
  for (const id of seatIds) {
    const ttId = seatToType.get(id);
    const unit = ttId != null ? unitOf.get(ttId) : undefined;
    if (unit == null) return { ok: false, missingSeats: [id] };
    subtotalAmount += unit;
  }

  // 顧客の支払額 = subtotal。手数料はそこから差し引いて主催へ送金（destination charge・§2）。
  const applicationFeeAmount = Math.floor(
    (subtotalAmount * APPLICATION_FEE_BPS) / 10000,
  );
  return {
    ok: true,
    pricing: {
      quantity: seatIds.length,
      subtotalAmount,
      applicationFeeAmount,
      totalAmount: subtotalAmount,
      currency,
    },
  };
}
