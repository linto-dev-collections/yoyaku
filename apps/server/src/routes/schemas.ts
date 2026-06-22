import { currencySchema, minorAmountSchema } from "@yoyaku/shared";
import { z } from "zod";

/** 席種（公演ヘッダに内包。currency は公演 currency と一致＝ドメインの通貨整合ガードで検証）。 */
const ticketTypeInputSchema = z.object({
  ticketTypeId: z.string().min(1),
  name: z.string().min(1),
  unitAmount: minorAmountSchema,
  currency: currencySchema,
});

/** POST /showings（RegisterShowing・draft ヘッダ）。startsAt 等は epoch ms。 */
export const registerShowingSchema = z.object({
  organizationId: z.string().min(1),
  title: z.string().min(1),
  venue: z.string().min(1).optional(),
  startsAt: z.number().int().positive(),
  salesStartAt: z.number().int().positive().optional(),
  salesEndAt: z.number().int().positive().optional(),
  currency: currencySchema,
  ticketTypes: z.array(ticketTypeInputSchema).min(1),
  totalSeats: z.number().int().positive(),
  // 公平性/不正対策（Phase 09・NFR-15/FR-15）。未指定は domain が general・上限 4 を補完。
  riskTier: z.enum(["general", "popular", "high_risk"]).optional(),
  maxSeatsPerUser: z.number().int().positive().max(100).optional(),
});
export type RegisterShowingInput = z.infer<typeof registerShowingSchema>;

// 文字列フィールドは長さを上限化（envelope バイト数を席数で見積もれるようにする＝128KB 保証の土台）。
const seatInputSchema = z.object({
  seatId: z.string().min(1).max(64),
  rowLabel: z.string().min(1).max(64).optional(),
  seatNumber: z.string().min(1).max(64).optional(),
  ticketTypeId: z.string().min(1).max(64),
});

/** POST /showings/:id/seats:import（ImportSeats・section チャンク）。 */
export const importSeatsSchema = z.object({
  section: z.string().min(1).max(128),
  seats: z.array(seatInputSchema).min(1),
});

/** POST /reservations（StartReservation）。価格は ticket_types から確定（FR-38）。 */
export const startReservationSchema = z.object({
  showingId: z.string().min(1),
  // 重複 seatId は拒否（課金前に弾く）。重複は価格二重計上・購入上限の過大計上・完売誤判定を招く。
  seatIds: z
    .array(z.string().min(1))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "seatIds must be unique",
    }),
});
