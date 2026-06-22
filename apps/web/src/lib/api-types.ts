import type { InferResponseType } from "hono/client";
import type { api } from "./api";

/**
 * RPC のレスポンス型は **Hono RPC（hc）から推論**して使い、手書きの型定義は持たない。
 * 成功(200)応答の形だけを取り出して各コンポーネントの prop 型に使う。
 */
export type ShowingList = InferResponseType<typeof api.showings.$get, 200>;
export type Showing = ShowingList["showings"][number];

export type SeatsView = InferResponseType<
  (typeof api.showings)[":id"]["seats"]["$get"],
  200
>;
export type Seat = SeatsView["seats"][number];

export type SalesView = InferResponseType<
  (typeof api.showings)[":id"]["sales"]["$get"],
  200
>;

export type ReservationView = InferResponseType<
  (typeof api.reservations)[":id"]["$get"],
  200
>;

export type MyTickets = InferResponseType<typeof api.me.tickets.$get, 200>;
export type Ticket = MyTickets["confirmed"][number];
