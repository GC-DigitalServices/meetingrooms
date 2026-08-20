export class NotPermittedError extends Error {
  constructor(message = "Not permitted to book this room") {
    super(message);
    this.name = "NotPermittedError";
  }
}

export class ConflictError extends Error {
  constructor(message = "Room is already booked for this time") {
    super(message);
    this.name = "ConflictError";
  }
}

export class NotOrganiserError extends Error {
  constructor(message = "Only the organiser or an admin can modify this booking") {
    super(message);
    this.name = "NotOrganiserError";
  }
}

export class OutOfHoursError extends Error {
  constructor(message = "Booking is outside room operating hours") {
    super(message);
    this.name = "OutOfHoursError";
  }
}

export class BeyondHorizonError extends Error {
  constructor(message = "Booking is too far in the future") {
    super(message);
    this.name = "BeyondHorizonError";
  }
}

export class RoomNotBookableError extends Error {
  constructor(message = "Room is not available for booking") {
    super(message);
    this.name = "RoomNotBookableError";
  }
}

export class LockTimeoutError extends Error {
  constructor(lockKey: string) {
    super(`Failed to acquire lock: ${lockKey}`);
    this.name = "LockTimeoutError";
  }
}

export class GraphUnavailableError extends Error {
  constructor(message = "Booking service temporarily unavailable — please try again shortly") {
    super(message);
    this.name = "GraphUnavailableError";
  }
}
