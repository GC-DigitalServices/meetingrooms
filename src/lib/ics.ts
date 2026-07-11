// Minimal RFC 5545 iCalendar builder for single-event exports.

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/[,;]/g, (c) => `\\${c}`)
    .replace(/\r\n|\r|\n/g, "\\n");
}

function icsTimestamp(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

// RFC 5545 §3.1: content lines SHOULD be at most 75 octets; longer lines are
// folded with CRLF + a single space. Splitting at 74 chars is conservative
// enough for occasional multi-byte characters in subjects.
function fold(line: string): string {
  if (line.length <= 74) return line;
  return line.match(/.{1,74}/g)!.join("\r\n ");
}

export interface IcsEvent {
  uid: string;
  startUtc: string; // ISO
  endUtc: string; // ISO
  summary: string;
  location?: string;
}

export function buildIcs(event: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Greenhead College//Room Booking//EN",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${icsTimestamp(new Date().toISOString())}`,
    `DTSTART:${icsTimestamp(event.startUtc)}`,
    `DTEND:${icsTimestamp(event.endUtc)}`,
    `SUMMARY:${icsEscape(event.summary)}`,
    ...(event.location ? [`LOCATION:${icsEscape(event.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
