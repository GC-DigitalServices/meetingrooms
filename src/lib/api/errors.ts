import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Canonical API error envelope: { error: { code, message, details? } }
// All route handlers must use apiError() instead of NextResponse.json({ error })
// so clients get a consistent shape they can switch on.
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "BOOKING_CONFLICT"
  | "ROOM_NOT_BOOKABLE"
  | "OUT_OF_HOURS"
  | "BEYOND_HORIZON"
  | "LOCK_TIMEOUT"
  | "RATE_LIMITED"
  | "GRAPH_UNAVAILABLE"
  | "INTERNAL_ERROR";

const DEFAULT_STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  BOOKING_CONFLICT: 409,
  ROOM_NOT_BOOKABLE: 400,
  OUT_OF_HOURS: 400,
  BEYOND_HORIZON: 400,
  LOCK_TIMEOUT: 503,
  RATE_LIMITED: 429,
  GRAPH_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

// Maps booking-domain error class names to API error codes.
const DOMAIN_ERROR_CODES: Record<string, ApiErrorCode> = {
  NotPermittedError: "FORBIDDEN",
  ConflictError: "BOOKING_CONFLICT",
  NotOrganiserError: "FORBIDDEN",
  OutOfHoursError: "OUT_OF_HOURS",
  BeyondHorizonError: "BEYOND_HORIZON",
  RoomNotBookableError: "ROOM_NOT_BOOKABLE",
  LockTimeoutError: "LOCK_TIMEOUT",
  GraphUnavailableError: "GRAPH_UNAVAILABLE",
};

export function apiError(
  code: ApiErrorCode,
  message: string,
  options?: { details?: unknown; headers?: Record<string, string> }
): NextResponse {
  const status = DEFAULT_STATUS[code];
  const body: { error: { code: string; message: string; details?: unknown } } = {
    error: { code, message },
  };
  if (options?.details !== undefined) body.error.details = options.details;
  return NextResponse.json(body, { status, headers: options?.headers });
}

/**
 * Converts a booking-service domain error to the correct API response.
 * Falls back to INTERNAL_ERROR for anything unrecognised.
 */
export function bookingServiceError(err: unknown): NextResponse {
  if (err instanceof Error) {
    // Match on err.name (set explicitly in each domain error constructor),
    // NOT err.constructor.name — the latter is mangled by production
    // minification, which would collapse every domain error into a 500.
    const code = DOMAIN_ERROR_CODES[err.name];
    if (code) return apiError(code, err.message);
  }
  // Genuinely unexpected — log it so a 500 in the booking path is traceable.
  logger.error({ err }, "api: unhandled error in booking service");
  return apiError("INTERNAL_ERROR", "An unexpected error occurred");
}
