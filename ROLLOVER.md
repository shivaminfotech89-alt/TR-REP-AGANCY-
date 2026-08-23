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

### 1. Finish estimating last tender's jobs FIRST — before you create the new AT

Produce and send the estimates for any jobs already booked under the old
tender **before** creating the new AT.

**If you skip it: the estimate prints the wrong amount, and nothing warns
you.** Estimates use whichever AT is currently selected, not the AT the job
was booked under. Create the new AT first and a job from last tender is priced
at the new tender's percentage. The estimate looks completely normal.

Nothing can be done afterwards except reissuing the document, so this is the
one step that has to happen in order.

*Already created the new AT? Switch back to the old one in the bar at the top
of Agency Settings, do the estimating, then switch forward again.*

### 2. Check the AT percentages before you press Create

When you open the create form, the percentages are **already filled in from
last year's AT**. That is a starting point, not an answer.

**If you skip it: every estimate under this tender is priced at last year's
percentage and looks correct.** A wrong percentage is invisible on the
finished document — there is no line saying which percentage was used.

Check all three (CRGO, Amorphous, Wound Core) against the new tender document.
The form says where the numbers came from; read it rather than clicking past.

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
