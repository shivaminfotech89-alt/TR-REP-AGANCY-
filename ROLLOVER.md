# AT rollover checklist

What to do when a tender period ends. There are two situations and they are
very different amounts of work:

- **The tender was EXTENDED** — same AT number, later end date. **One step.**
- **A NEW tender started** — new AT number. **Five steps.**

If you are not sure which you have: look at the paperwork from the division.
A new AT number means a new AT. A letter extending the existing one means an
extension. **If it is an extension, do not create a new AT** — you would split
one tender across two records, and every report that groups by AT would show
half the work under each.

Steps are ordered by **what goes wrong if you skip them**, not by the order
they appear on screen. The first ones fail *quietly*.

---

## A tender was EXTENDED

### 1. Change the end date. That is all.

Agency Settings → **This AT Period** → the AT → Edit → new end date → Save.

Nothing else needs touching. Job numbers keep counting, allotments stay as
they are, divisions and prefixes stay, the AT percentages stay.

**If you skip it:** nothing breaks. The dates are shown on screen but nothing
in the app calculates from them — no document is dated from them, no
percentage, no numbering. An out-of-date end date is a tidiness problem, not a
correctness one.

---

## A NEW tender started

### 1. Book last tender's transformers under last tender's AT

A job is priced by **the AT it was booked under**, permanently — not by whichever
AT is selected when you produce the estimate. So estimating can wait; **booking
cannot**.

This matters at the boundary. Clause 39.0 of the tender says a transformer
**delivered before the old order expired, and jointly inspected**, is repaired at
the **old rate**. But creating a new AT switches you to it immediately, so a
transformer that arrived in the old period and gets booked after you create the
new AT lands on the new AT and is priced at the new tender's rates.

**The app does not check this for you.** It has both dates and uses neither —
rate selection keys on the AT alone. So before booking anything at the boundary,
ask when the transformer was delivered, not when you are typing.

**If you skip it:** the job carries the wrong rates for its whole life and the
estimate looks completely normal. Re-booking it under the correct AT is the only
fix, and that is easier before any document goes out.

*Estimates and bills already produced keep the amounts they were sent with.*

### 2. Enter the AT percentages — all three, from your bid

The three percentage boxes now open **empty** and the form will not create the
AT until all three are filled. They used to be pre-filled from last year's AT,
which meant they were usually submitted unread.

They are what **your agency quoted above (+) or below (−) the UGVCL schedule**
in its bid document — not a property of the tender, which is why they differ
between agencies working the same one. Live examples: +7 across the board on
one tender, and +4 CRGO with −8 Amorphous and −4 Wound Core on another.

There is a **Copy from *(previous AT)*** link if this tender was bid at the
same percentages. Use it, then check the numbers against the new bid.

**If the bid was at the schedule rate exactly, type 0.** A blank is refused; a
typed zero is accepted. They are not the same thing, and a blank used to be
stored as zero silently — which read as "bid at par" rather than "nobody
answered".

**If you skip it: you cannot** — the form blocks. That is the point. A wrong
percentage is invisible on the finished document, because no line says which
percentage was used.

### 3. Enter the divisions and prefixes — if any prefix changed

Agency Settings → **This AT Period** → the new AT → **Divisions & Core
Prefixes**.

**If you skip it and a prefix changed: new jobs get the OLD prefix, silently.**
With nothing entered, the app falls back to the prefixes stored on the agency,
which are last tender's. If the prefixes did not change, the fallback gives the
right answer and skipping is harmless — but you have to know they did not
change, and the only way to know is to check the tender document.

### 4. Enter the allotment quotas

Agency Settings → **This AT Period** → the new AT → **Allotment Quotas &
Letters**. One per division and core type, from the allotment letter.

**If you skip it: booking a job is refused.** This one is loud — you get a
message naming the division and core type, with a button that takes you
straight to the right screen. Nothing is lost; the intake you were typing is
saved and comes back.

### 5. Check the job numbering message on the new AT

Nothing to enter. When you create the AT a panel appears saying what the next
job number will be for each division, for example `SABARMATI_CRGO: next is 41`.

Job numbers **continue** from the agency's existing series — they do not
restart at 1. The prefix already identifies the tender, so restarting would
reuse a number that belongs to a different transformer.

**Read the panel once.** If it warns that some job numbers could not be read,
it names them and tells you which divisions are affected. It means the next
number offered *may* be lower than one already used. You do not have to act on
it: if a duplicate does occur, saving the job is refused and you pick the next
free number. It is a heads-up, not a task.

---

## If the tender's RATES changed, not just its dates

A new AT number does not by itself change any price. Since rate schedules became
per-tender, **which schedule an AT uses is a property of the tender**, chosen once by the
administrator and carried onto the AT — you never pick it yourself.

There are **two cases**, and they cost very different amounts.

### First: which case are you in? Three cells, not fifty-one.

Do **not** compare the whole sheet. Open the new tender's Schedule-A and check these three
against what the app currently prices. They are spread across the sheet and all three moved
between the 2020 and 2026 tenders, so if a tender reprices at all these will show it:

| Sr. | item | UGVCL-2020 | UGVCL-2026 |
|---|---|---|---|
| **1a** at 25 KVA | Labour charge only | 2061 | **2079** |
| **17** (any capacity) | Sealed → bolted conversion | 1511 | **1524** |
| **21** at 63 KVA | Overhauling | 3162 | **3189** |

- **All three match a schedule the app already has** → Case A. The tender reuses that
  schedule. Nothing about rates needs doing.
- **Any one differs** → Case B. The tender has repriced and **the new schedule has to be
  entered in code before any job is booked under it.**

Two of those figures sit at the top and bottom of the sheet and one is a single flat number,
so the check takes a minute. If you want more certainty, add `12A(b)` — the aluminium HV
coil per kg, 163 in 2020 and 165 in 2026 — because it is the most expensive line on most
estimates.

### Case A — the tender reuses an existing schedule

1. Create the AT as normal. The **Rate schedule** field shows which schedule applies as a
   statement of fact; you do not choose it.
2. If a rate template exists for that schedule it is **pre-selected** and its rates are
   copied onto the AT when you save. That is the whole job.
3. If no template exists, ask the administrator to publish one — Admin Panel → **New tender
   template** → name it, give the tender number and period, choose the schedule, publish.
   It takes a minute and every agency on that tender can then adopt it.

### Case B — the tender repriced

**The rates cannot be typed in.** Schedule-A, Schedule-B, the radiator table and the Clause
4.0 sanction limits live in the app's code, not in any screen, and that is deliberate: they
are the tender's figures, not an agency's, so no agency can edit them.

1. **Send the schedule pages to whoever maintains the app.** All of them — Schedule-A,
   Schedule-B and the Clause 4.0 limits. A partial set means a tender priced half from the
   new schedule and half from the old, which is worse than waiting.
2. They add it as a new schedule and tell you when it is live.
3. The administrator publishes a template against the new schedule.
4. You create the AT and pick that template — or, if the AT already exists, adopt onto it
   from Estimate Master → **Copy to this AT**.

**A correction in the code reaches every AT on that schedule the moment it ships** — no
republishing, no re-adopting, nobody clicking anything. That is the opposite of anything held
in the estimate master, which needs a new template version and every agency to take it.

### Before the first estimate goes out

The first time you send an estimate under a tender whose schedule was carried over rather
than chosen, the app asks you to confirm it once — naming the schedule and where it came
from. **Read it rather than clicking through.** It is the only point at which a wrong
schedule can be caught: the schedule is not printed on the estimate, so a job priced from the
wrong tender looks entirely normal on paper.

**If you skip all this: estimates use the previous tender's rates and look completely
normal.** There is no warning on the document, because an out-of-date rate is
indistinguishable from a current one.

## After either one — a quick check

Book nothing for real yet. Open **New Job** and look at the job number it
proposes and the division list:

- **Job number** — is it the next one after your last job, with the right
  prefix?
- **Divisions** — are the ones from this tender listed?
- **AT shown at the top of the screen** — is it the new AT?

If all three look right, the rollover is done. If the AT at the top is still
last year's, change it in the bar at the top of Agency Settings.

---

## Things worth knowing

**Creating a new AT switches you to it immediately.** There is no separate
"activate" step, and no confirmation. If you were mid-way through work on the
old tender, finish it first (see step 1).

**Marking an AT "Closed" does not stop anything.** It only affects which AT is
picked automatically when nothing is selected. Jobs can still be booked
against a closed AT. Closing one is bookkeeping, not a lock.

**Allotment quotas do not carry over and do not lapse.** Each AT has its own.
An unused quota on last tender stays on last tender; the new AT starts with
none recorded, which is why step 4 is required rather than optional.

**Nothing recalculates when an AT changes.** Jobs already booked keep the AT
they were booked under, and documents already sent keep the amounts they were
sent with. Only work done *after* the change is affected.
