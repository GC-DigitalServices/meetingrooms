import { describe, it, expect, vi, beforeEach } from "vitest";

// Prevent module-level db/graphClient initialisations from failing in tests.
const { dbMock, graphMock, configMock } = vi.hoisted(() => ({
  dbMock: {
    booking: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  graphMock: { getCalendar: vi.fn() },
  configMock: { SYNC_WINDOW_DAYS: 180 },
}));

vi.mock("@/lib/db/client", () => ({ db: dbMock }));
vi.mock("@/lib/graph/client", () => ({ graphClient: graphMock }));
vi.mock("@/lib/config", () => ({ getConfig: () => configMock }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resolveLogicalRoomId, syncMailbox, fetchSeriesOccurrences } from "@/lib/graph/sync";

// Fixture: composite "comp1" has sections "s1" and "s2"; "std1" is standalone.
const mailboxToRoomId = new Map([
  ["s1@rooms.example.com", "s1"],
  ["s2@rooms.example.com", "s2"],
  ["std1@rooms.example.com", "std1"],
]);
const sectionToParentId = new Map([
  ["s1", "comp1"],
  ["s2", "comp1"],
]);

describe("resolveLogicalRoomId", () => {
  it("returns fallbackRoomId when no attendees are present", () => {
    expect(resolveLogicalRoomId([], mailboxToRoomId, sectionToParentId, "fallback")).toBe(
      "fallback",
    );
  });

  it("returns fallbackRoomId when no attendees match known mailboxes", () => {
    expect(
      resolveLogicalRoomId(
        ["unknown@rooms.example.com"],
        mailboxToRoomId,
        sectionToParentId,
        "fallback",
      ),
    ).toBe("fallback");
  });

  it("returns the section id when one section is invited", () => {
    expect(
      resolveLogicalRoomId(
        ["s1@rooms.example.com"],
        mailboxToRoomId,
        sectionToParentId,
        "fallback",
      ),
    ).toBe("s1");
  });

  it("returns the standard room id when a standalone room is invited", () => {
    expect(
      resolveLogicalRoomId(
        ["std1@rooms.example.com"],
        mailboxToRoomId,
        sectionToParentId,
        "fallback",
      ),
    ).toBe("std1");
  });

  it("normalises UPN casing before lookup", () => {
    expect(
      resolveLogicalRoomId(
        ["S1@ROOMS.EXAMPLE.COM"],
        mailboxToRoomId,
        sectionToParentId,
        "fallback",
      ),
    ).toBe("s1");
  });

  it("returns the composite id when all sections of the composite are invited", () => {
    expect(
      resolveLogicalRoomId(
        ["s1@rooms.example.com", "s2@rooms.example.com"],
        mailboxToRoomId,
        sectionToParentId,
        "fallback",
      ),
    ).toBe("comp1");
  });

  it("returns the composite id when sections arrive in mixed case", () => {
    expect(
      resolveLogicalRoomId(
        ["S1@rooms.example.com", "s2@ROOMS.EXAMPLE.COM"],
        mailboxToRoomId,
        sectionToParentId,
        "fallback",
      ),
    ).toBe("comp1");
  });

  it("returns fallbackRoomId when sections belong to different composites", () => {
    const twoComposites = new Map([
      ["s1", "comp1"],
      ["s2", "comp2"],
    ]);
    expect(
      resolveLogicalRoomId(
        ["s1@rooms.example.com", "s2@rooms.example.com"],
        mailboxToRoomId,
        twoComposites,
        "fallback",
      ),
    ).toBe("fallback");
  });

  it("returns fallbackRoomId when a section and an unrelated standard room are both invited", () => {
    // s1 resolves to parent comp1; std1 has no parent so resolves to itself — two different roots.
    expect(
      resolveLogicalRoomId(
        ["s1@rooms.example.com", "std1@rooms.example.com"],
        mailboxToRoomId,
        sectionToParentId,
        "fallback",
      ),
    ).toBe("fallback");
  });

  it("handles three sections all sharing the same composite", () => {
    const extended = new Map([...mailboxToRoomId, ["s3@rooms.example.com", "s3"]]);
    const extendedParents = new Map([...sectionToParentId, ["s3", "comp1"]]);
    expect(
      resolveLogicalRoomId(
        ["s1@rooms.example.com", "s2@rooms.example.com", "s3@rooms.example.com"],
        extended,
        extendedParents,
        "fallback",
      ),
    ).toBe("comp1");
  });
});

// ---------------------------------------------------------------------------
// syncMailbox — stale removal must never reach outside the synced window
// ---------------------------------------------------------------------------
// Regression cover for a resync that deleted every booking it had not just
// fetched. calendarView only returns [now, now + SYNC_WINDOW_DAYS], so past
// bookings and anything beyond the horizon were absent from the response and
// got wiped from Postgres while still live in Exchange — leaving the portal
// believing an exam-occupied room was free.

const DAY = 24 * 60 * 60 * 1000;

interface Fixture {
  id: string;
  graphICalUid: string;
  roomId: string;
  startUtc: Date;
  endUtc: Date;
}

/** Bookings held in Postgres for room "std1", spread either side of the window. */
function fixtures(now: number): Fixture[] {
  const at = (startOffsetDays: number, durationHours = 1): [Date, Date] => [
    new Date(now + startOffsetDays * DAY),
    new Date(now + startOffsetDays * DAY + durationHours * 60 * 60 * 1000),
  ];
  const mk = (id: string, offset: number): Fixture => {
    const [startUtc, endUtc] = at(offset);
    return { id, graphICalUid: `uid-${id}`, roomId: "std1", startUtc, endUtc };
  };
  return [
    mk("past", -30), // finished a month ago — before the window starts
    mk("soon", 5), // inside the window, still present in Exchange
    mk("cancelled", 10), // inside the window, genuinely gone from Exchange
    mk("exam", 200), // beyond a 180-day window — Salamander exam block
  ];
}

/** Minimal Graph event shaped like the calendarView projection sync.ts selects. */
function graphEvent(f: Fixture) {
  return {
    id: `event-${f.id}`,
    iCalUId: f.graphICalUid,
    subject: f.id,
    start: { dateTime: f.startUtc.toISOString().replace("Z", ""), timeZone: "UTC" },
    end: { dateTime: f.endUtc.toISOString().replace("Z", ""), timeZone: "UTC" },
    isAllDay: false,
    organizer: { emailAddress: { address: "std1@rooms.example.com", name: "Room 1" } },
    attendees: [],
    singleValueExtendedProperties: [],
  };
}

/**
 * Runs syncMailbox against `rows`, with Exchange returning only `present`.
 * db.findMany applies the real where-clause so the test exercises scoping
 * rather than asserting on the query shape.
 */
interface BookingWhere {
  roomId: string;
  startUtc?: { lt?: Date };
  endUtc?: { gt?: Date };
}
interface DeleteManyArg {
  where?: { graphICalUid?: { in?: string[] } };
}

async function runSync(rows: Fixture[], present: Fixture[]) {
  dbMock.booking.findMany.mockImplementation(async ({ where }: { where: BookingWhere }) =>
    rows
      .filter(
        (b) =>
          b.roomId === where.roomId &&
          (where.startUtc?.lt === undefined || b.startUtc < where.startUtc.lt) &&
          (where.endUtc?.gt === undefined || b.endUtc > where.endUtc.gt),
      )
      .map((b) => ({ id: b.id, graphICalUid: b.graphICalUid })),
  );
  graphMock.getCalendar.mockResolvedValue({ value: present.map(graphEvent) });

  const stats = await syncMailbox(
    "std1@rooms.example.com",
    "std1",
    new Map([["std1@rooms.example.com", "std1"]]),
    new Map(),
  );

  const deleted: string[] = dbMock.booking.deleteMany.mock.calls.flatMap(
    (c: unknown[]) => (c[0] as DeleteManyArg | undefined)?.where?.graphICalUid?.in ?? [],
  );
  return { stats, deleted, url: graphMock.getCalendar.mock.calls[0]?.[0] as string };
}

describe("syncMailbox stale removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.SYNC_WINDOW_DAYS = 180;
    dbMock.booking.findFirst.mockResolvedValue(null);
    dbMock.booking.update.mockResolvedValue({});
    dbMock.booking.create.mockResolvedValue({});
    dbMock.booking.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("deletes an in-window booking that has disappeared from Exchange", async () => {
    const rows = fixtures(Date.now());
    const soon = rows.find((r) => r.id === "soon")!;
    const { deleted, stats } = await runSync(rows, [soon]);

    expect(deleted).toContain("uid-cancelled");
    expect(stats.removed).toBe(1);
  });

  it("keeps bookings beyond the sync window (the exam case)", async () => {
    const rows = fixtures(Date.now());
    const soon = rows.find((r) => r.id === "soon")!;
    const { deleted } = await runSync(rows, [soon]);

    // "exam" sits 200 days out, past the 180-day horizon, so calendarView never
    // returned it. It is still a live Exchange booking and must survive.
    expect(deleted).not.toContain("uid-exam");
  });

  it("keeps past bookings", async () => {
    const rows = fixtures(Date.now());
    const soon = rows.find((r) => r.id === "soon")!;
    const { deleted } = await runSync(rows, [soon]);

    expect(deleted).not.toContain("uid-past");
  });

  it("deletes nothing when Exchange still has every in-window booking", async () => {
    const rows = fixtures(Date.now());
    const inWindow = rows.filter((r) => r.id === "soon" || r.id === "cancelled");
    const { deleted, stats } = await runSync(rows, inWindow);

    expect(deleted).toEqual([]);
    expect(stats.removed).toBe(0);
  });

  it("brings far-future bookings into scope once the window is widened", async () => {
    // With a 365-day window the 200-day exam IS fetched, so its absence from
    // Exchange now legitimately means cancelled.
    configMock.SYNC_WINDOW_DAYS = 365;
    const rows = fixtures(Date.now());
    const soon = rows.find((r) => r.id === "soon")!;
    const { deleted } = await runSync(rows, [soon]);

    expect(deleted).toContain("uid-exam");
  });

  it("requests the window length given by SYNC_WINDOW_DAYS", async () => {
    configMock.SYNC_WINDOW_DAYS = 90;
    const rows = fixtures(Date.now());
    const { url } = await runSync(rows, []);

    const end = new Date(decodeURIComponent(url.match(/endDateTime=([^&]+)/)![1]));
    const spanDays = (end.getTime() - Date.now()) / DAY;
    expect(spanDays).toBeGreaterThan(89.9);
    expect(spanDays).toBeLessThan(90.1);
  });
});

// ---------------------------------------------------------------------------
// Recurring series expansion
// ---------------------------------------------------------------------------
// A Salamander timetable slot arrives as one recurring series. Graph notifies
// us about the series master, whose start/end cover only the first lesson, so
// the webhook expands the master into its occurrences instead of mirroring it.

describe("fetchSeriesOccurrences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.SYNC_WINDOW_DAYS = 370;
  });

  function occurrence(i: number) {
    const start = new Date(Date.now() + i * 7 * DAY);
    return {
      id: `occ-${i}`,
      // Each occurrence of a series has its own iCalUId, so each mirrors as an
      // independent booking rather than collapsing onto one row.
      iCalUId: `uid-occ-${i}`,
      subject: "Computer Science (A2) F1",
      start: { dateTime: start.toISOString().replace("Z", ""), timeZone: "UTC" },
      end: { dateTime: start.toISOString().replace("Z", ""), timeZone: "UTC" },
      isAllDay: false,
      type: "occurrence" as const,
      organizer: { emailAddress: { address: "m17@rooms.example.com", name: "M17" } },
      attendees: [],
    };
  }

  it("asks the master's instances endpoint for the whole sync window", async () => {
    graphMock.getCalendar.mockResolvedValueOnce({ value: [occurrence(0)] });

    await fetchSeriesOccurrences("m17@rooms.example.com", "master-1");

    const url = graphMock.getCalendar.mock.calls[0][0] as string;
    expect(url).toContain("/events/master-1/instances");
    const end = new Date(decodeURIComponent(url.match(/endDateTime=([^&]+)/)![1]));
    const spanDays = (end.getTime() - Date.now()) / DAY;
    expect(spanDays).toBeGreaterThan(369.9);
    expect(spanDays).toBeLessThan(370.1);
  });

  it("returns every occurrence, not just the first", async () => {
    const weekly = Array.from({ length: 38 }, (_, i) => occurrence(i));
    graphMock.getCalendar.mockResolvedValueOnce({ value: weekly });

    const result = await fetchSeriesOccurrences("m17@rooms.example.com", "master-1");

    expect(result).toHaveLength(38);
    expect(new Set(result.map((o) => o.iCalUId)).size).toBe(38);
  });

  it("follows nextLink pagination", async () => {
    graphMock.getCalendar
      .mockResolvedValueOnce({ value: [occurrence(0)], "@odata.nextLink": "/next-page" })
      .mockResolvedValueOnce({ value: [occurrence(1)] });

    const result = await fetchSeriesOccurrences("m17@rooms.example.com", "master-1");

    expect(result.map((o) => o.id)).toEqual(["occ-0", "occ-1"]);
    expect(graphMock.getCalendar).toHaveBeenCalledTimes(2);
    expect(graphMock.getCalendar.mock.calls[1][0]).toBe("/next-page");
  });
});
