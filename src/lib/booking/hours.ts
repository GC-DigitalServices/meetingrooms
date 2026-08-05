/**
 * Bookable hours, minutes from midnight (Europe/London wall clock).
 * The single source of truth — booking forms, slot suggestions and
 * quick-book buttons must all agree on when a booking may start and end.
 * (Timeline/grid VIEW windows may be wider than this for context.)
 */
export const BOOKABLE_START_MIN = 7 * 60; // 07:00
export const BOOKABLE_END_MIN = 21 * 60; // 21:00

/** Booking slot granularity in minutes. */
export const SLOT_STEP_MIN = 15;
