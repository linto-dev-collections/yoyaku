/** ドメイン違反。HTTP ステータスへマップして API が返す（competition は 409）。 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "DomainError";
  }
}

export const seatConflict = (message?: string) =>
  new DomainError("seat_conflict", 409, message);
export const limitExceeded = (message?: string) =>
  new DomainError("limit_exceeded", 409, message);
export const invalidState = (message?: string) =>
  new DomainError("invalid_state", 409, message);
export const notFound = (message?: string) =>
  new DomainError("not_found", 404, message);
/** 決済額/通貨が確保時の固定額と不一致（価格固定 FR-38/BR-14・照合 kind と同名）。 */
export const amountMismatch = (message?: string) =>
  new DomainError("amount_mismatch", 409, message);
