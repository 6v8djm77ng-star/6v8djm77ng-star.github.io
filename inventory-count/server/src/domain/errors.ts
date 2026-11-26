export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'ROUND_NOT_ACTIVE'
  | 'FREEZE_VIOLATION'
  | 'SAP_ERROR'
  | 'RATE_LIMITED';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ROUND_NOT_ACTIVE: 409,
  FREEZE_VIOLATION: 409,
  SAP_ERROR: 502,
  RATE_LIMITED: 429,
};

/** Error with a user-facing Hebrew message. */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}
