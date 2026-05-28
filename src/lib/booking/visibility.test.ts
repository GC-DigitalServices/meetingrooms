import { describe, it, expect } from "vitest";
import { canSeeRoom, bookingDetailVisibility } from "./visibility";

const staffViewer   = { upn: "staff@gc.ac.uk",   isStaff: true,  isAdmin: false };
const adminViewer   = { upn: "admin@gc.ac.uk",   isStaff: false, isAdmin: true  };
const studentViewer = { upn: "student@gc.ac.uk", isStaff: false, isAdmin: false };

describe("canSeeRoom", () => {
  it("staff always see all rooms", () => {
    expect(canSeeRoom(staffViewer, { bookable: false })).toBe(true);
  });

  it("admin always sees all rooms", () => {
    expect(canSeeRoom(adminViewer, { bookable: false })).toBe(true);
  });

  it("student sees bookable rooms", () => {
    expect(canSeeRoom(studentViewer, { bookable: true })).toBe(true);
  });

  it("student hides non-bookable rooms by default", () => {
    expect(canSeeRoom(studentViewer, { bookable: false })).toBe(false);
  });

  it("student sees non-bookable rooms when showAll is true", () => {
    expect(canSeeRoom(studentViewer, { bookable: false }, true)).toBe(true);
  });
});

describe("bookingDetailVisibility", () => {
  const staffBooking   = { organiserUpn: "staff@gc.ac.uk",   organiserIsStaff: true  };
  const studentBooking = { organiserUpn: "student2@gc.ac.uk", organiserIsStaff: false };

  it("organiser always sees own booking in full", () => {
    expect(bookingDetailVisibility(staffViewer, { ...staffBooking, organiserUpn: staffViewer.upn, organiserIsStaff: true })).toBe("full");
  });

  it("admin sees all bookings in full", () => {
    expect(bookingDetailVisibility(adminViewer, studentBooking)).toBe("full");
  });

  it("student-organised booking is busy to everyone except organiser/admin", () => {
    expect(bookingDetailVisibility(staffViewer, studentBooking)).toBe("busy");
    expect(bookingDetailVisibility(studentViewer, studentBooking)).toBe("busy");
  });

  it("staff-organised booking is full for staff", () => {
    expect(bookingDetailVisibility(staffViewer, staffBooking)).toBe("full");
  });

  it("staff-organised booking is busy for students", () => {
    expect(bookingDetailVisibility(studentViewer, staffBooking)).toBe("busy");
  });
});
