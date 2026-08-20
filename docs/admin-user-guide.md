# Meeting Rooms — Administrator Guide

A plain-English guide for administrators of the Meeting Rooms booking system. You
don't need any technical knowledge to use it — this covers everything you'll do
day to day. Where something is best left to IT, it says so.

---

## What the system does

Staff (and students, for some rooms) book meeting rooms, minibuses, and visitor
car-park bays through the website. Small iPad screens outside rooms show whether
each room is free or busy. As an administrator you can manage rooms, tidy up
bookings, look after the iPad displays, and check that everything's healthy.

You can also book further ahead than everyone else. Ordinary users can book up
to 60 days in advance; as an administrator you can book a room up to a year
ahead, and a minibus or visitor bay up to 360 days ahead. The date picker will
simply let you pick those later dates — there's nothing extra to switch on.

## Signing in

Go to the booking website and sign in with your college Microsoft account — the
same login as your email. If you're already signed in to Office 365, it usually
lets you straight in.

You'll know you're an administrator because you'll see an **Admin** link in the
menu. If you don't see it, you haven't been given admin rights yet — ask IT (see
"Getting admin access" near the end).

---

## The Admin area — a quick tour

Open **Admin** from the menu. You'll see cards for each area:

| Area | Use it to… |
|---|---|
| **Bookings** | Find and cancel any booking (room, minibus, or car park) |
| **Meeting Rooms** | Add or edit rooms and control who's allowed to book them |
| **Devices** | Set up and manage the iPad displays outside rooms |
| **Minibus checklist** | Update the safety-check document emailed to minibus bookers |
| **Audit log** | See a history of who booked or cancelled what |
| **System status** | Check the system is healthy and displays are online |

The rest of this guide walks through each one.

---

## Cancelling or finding a booking (Bookings)

Use this when someone asks you to cancel a booking they can't cancel themselves, or
you need to find who booked something.

1. **Admin → Bookings.**
2. Type in the **search box** — you can search by the booking's subject, the
   person who booked it, or the room name.
3. Optionally narrow by **type** (buttons for room / minibus / car park) and by a
   **From / To** date range. Leave the dates empty to include past bookings.
4. Each result shows the subject, room, date and time, and who booked it.
5. To cancel one, click the **bin/delete icon** on that booking and confirm.

Cancelling here removes the booking from the room's calendar too — the same as if
the person had cancelled it themselves. If a search says "showing the first 100
matches", add a date range or more specific text to narrow it down.

---

## Adding and editing rooms (Meeting Rooms)

**Admin → Meeting Rooms** lists every room with its building, capacity, type,
who can access it, and whether it's currently bookable.

### Add a room
1. Click **Add room**.
2. Fill in:
   - **Display name** (required) — what people see, e.g. "CT12".
   - **Building** and **Floor** — optional, helps people find it.
   - **Capacity** (required) — how many people it seats.
   - **Type** — Standard room, Minibus, Car Park Pool, or Car Park Bay.
     *(You can only set the type when creating; it can't be changed later.)*
   - **Mailbox** — the room's calendar address, e.g. `ct12@greenhead.ac.uk`.
     **This must be a real room mailbox that IT has set up** — check with IT before
     entering it, or leave it to them. A room won't take bookings without one.
   - **Bookable** — tick to allow bookings; untick to temporarily take a room out
     of use without deleting it.
   - **Allowed groups** — see below.
3. Click **Add room**.

### Controlling who can book a room ("Allowed groups")
- **Leave all groups unticked** → anyone signed in can book the room.
- **Tick one or more groups** → only members of those groups can book it (e.g.
  staff-only). The common groups appear as tick-boxes.
- The "Additional group IDs" box is for IT — you can ignore it.

### Edit or remove a room
- Click **Edit** (pencil) on a row to change its details.
- Click the **bin** icon to delete a room. This can't be undone, so only delete
  rooms that are genuinely gone.
- Rooms marked **Read-only** (composite/section rooms) are managed by IT — leave
  those alone.

> **Tip:** to stop a room being booked temporarily (redecoration, AV broken),
> just **untick "Bookable"** and edit — don't delete it.

---

## Managing iPad displays (Devices)

The small screens outside rooms are "displays". **Admin → Devices** lists each one
with when it was **Last seen** (a recent time means it's online and working).

### Pair a new display
1. Click **Pair display**.
2. Choose the **meeting room** the screen is for.
3. Choose the **display scope** if asked (for most rooms there's only one option).
4. Optionally give it a **name** (e.g. "iPad outside Main Hall") so you can spot it
   in the list later.
5. Click **Generate pairing code**. You'll see a large code and a web address.
6. On the **iPad**, open that web address and enter the code before it expires
   (about 10 minutes). The screen then locks to that room.

### If a display is playing up
- Check **Last seen** — if it's hours/days ago, the iPad is offline (check its
  power and Wi-Fi first).
- To retire or replace a display, click **Revoke** on its row. Revoking stops that
  iPad working until it's paired again.
- If it still won't come online after checking power/Wi-Fi, contact IT.

---

## Updating the minibus checklist

When someone books a minibus they get a confirmation email with a safety-check
checklist attached. To update that document:

1. **Admin → Minibus checklist.**
2. It shows the current file (name, size, who uploaded it and when).
3. Click to choose a new **PDF or Word** file (max 4 MB) and **Upload**.
4. The new version is used immediately for all future minibus bookings.

If no checklist has been uploaded, bookers still get their confirmation email — it
just won't have an attachment.

---

## Seeing who did what (Audit log)

**Admin → Audit log** is a running history of every booking created, changed, or
cancelled — and by whom. Use the **Action** and **Date** filters to narrow it, and
the page links at the bottom to go further back.

It's read-only — a record for answering "who cancelled that?" You may also see rows
noting when a notification email failed to send; if you see those, mention it to IT.

---

## Checking everything's healthy (System status)

**Admin → System status** shows whether the underlying services and the iPad
displays are working.

- Green/OK indicators mean all is well.
- If you see a **warning that room updates may stop working** (a "subscription"
  expiring), click **Renew now**.
- If anything shows red or the warning won't clear after "Renew now", contact IT
  and tell them what it said.

---

## Getting admin access (for you or a colleague)

Admin rights aren't granted inside this system — they come from a Microsoft group
managed by IT. To give a colleague admin:

1. Ask **IT** to add them to the **MRBS Admin** group.
2. Once added, the person must **sign out and sign back in** for it to take effect.

The same is true for removing admin, or changing who can book restricted rooms —
those are group changes IT makes, and they only take effect after the person next
signs in.

---

## When something looks wrong

A few things you can check yourself before calling IT:

- **Someone can't book a room** → in Meeting Rooms, check the room is **Bookable**
  and that its **Allowed groups** include that person's group (or are all unticked).
- **A room shows free but is actually booked (or vice-versa)** → check **System
  status** and click **Renew now**; wait a minute and refresh.
- **An iPad is blank/wrong** → check its power and Wi-Fi, and its **Last seen** in
  Devices.
- **Booking fails for everyone with a "temporarily unavailable" message** → this is
  a system-level issue; contact IT.

When you do contact IT, tell them: what you were doing, the exact message on screen,
roughly when it happened, and which room/person was involved. IT have a separate
technical guide (`docs/it-support-guide.md`) that covers fixes.

---

## A few golden rules

- **Don't delete a room** just to take it out of use — untick **Bookable** instead.
- **Don't guess a room's Mailbox address** — get it from IT; a wrong one breaks
  bookings for that room.
- **Cancelling a booking is instant and can't be undone** — double-check the person,
  room, and date before confirming.
- Anything marked **Read-only**, or asking for **group IDs / codes**, is IT's
  domain — leave it to them rather than guessing.
