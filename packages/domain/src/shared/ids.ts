/** ブランド型（名目型）。実体は string だが取り違えを型で防ぐ。 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type ShowingId = Brand<string, "ShowingId">;
export type ReservationId = Brand<string, "ReservationId">;
export type SeatId = Brand<string, "SeatId">;
export type UserId = Brand<string, "UserId">;
export type OrgId = Brand<string, "OrgId">;
export type TicketTypeId = Brand<string, "TicketTypeId">;

export const asShowingId = (s: string): ShowingId => s as ShowingId;
export const asReservationId = (s: string): ReservationId => s as ReservationId;
export const asSeatId = (s: string): SeatId => s as SeatId;
export const asUserId = (s: string): UserId => s as UserId;
export const asOrgId = (s: string): OrgId => s as OrgId;
export const asTicketTypeId = (s: string): TicketTypeId => s as TicketTypeId;
