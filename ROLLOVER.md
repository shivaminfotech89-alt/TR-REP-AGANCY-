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

### 2. Enter the AT percentage — one figure, from your acceptance letter

**There is one percentage box, not three.** It applies to every core type. It
used to be three, one each for CRGO, Amorphous and Wound Core, on the strength
of stored figures that turned out to be test data.

It is what the tender **accepted above (+) or below (−) the UGVCL schedule** —
A/T 1819 accepts *7.00% above*, so you type **7**. A negative number is below
the schedule. The form says so beside the field; the sign is the whole meaning,
because 7 and −7 are fourteen points apart on every line of every estimate.

**Two ways it gets filled:**

- **The template supplies it.** Where a tender quotes one rate to every agency,
  the administrator puts it on the template and the box arrives filled, with a
  green line naming the tender it came from. **Confirm it against your
  acceptance letter** — it stays editable, and an agency on varied terms should
  change it.
- **You type it.** Where agencies bid separately, the template carries nothing
  and the box opens empty and must be answered.

There is a **Copy from *(previous AT)*** link if this tender was accepted at the
same figure. Use it, then check against the new letter.

**If the rate was the schedule exactly, type 0.** A blank is refused; a typed
zero is accepted. They are not the same thing, and a blank used to be stored as
zero silently — which read as "at par" rather than "nobody answered".

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
3. If no template exists, ask the administrator to publish one. It takes a minute and every
   agency on that tender can then adopt it — see **For the administrator** below for what
   they do.

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

## FOR THE ADMINISTRATOR — publishing the tender's rates

Everything above is what an **agency** does. This is what the **administrator**
does once, when a new tender arrives, so that every agency on it can take the
rates instead of typing them.

### First: which case are you in?

**The same three cells as above.** Open the new tender's Schedule-A and check
these against what the app prices today:

| Sr. | item | UGVCL-2020 | UGVCL-2026 |
|---|---|---|---|
| **1a** at 25 KVA | Labour charge only | 2061 | **2079** |
| **17** (any capacity) | Sealed → bolted conversion | 1511 | **1524** |
| **21** at 63 KVA | Overhauling | 3162 | **3189** |

All three match a schedule the app already has → **Case 1**. Any one differs →
**Case 2**.

There is a second way to tell, and it is the more reliable one: **open the
publish form and look at the schedule dropdown.** It lists only schedules that
are fully in the app. If the tender you are publishing for is not in that list,
you are in Case 2 whatever the three cells say.

---

### Case 1 — the rates are a schedule the app already has

**Admin Panel → New tender template.** Fill in:

1. **Template name** — what agencies will pick it by, e.g. *UGVCL 2026-28
   Schedule A*.
2. **AT number** — the tender number as the DISCOM writes it.
3. **Tender period** — start and end date. These prefill the dates on an
   agency's Add AT form; they are a suggestion, not a rule.
4. **Accepted percentage** — **optional.** Fill it *only* if the tender sets one
   rate for every agency (A/T 1819 does: 7.00% above, so enter 7). Leave it blank
   when agencies bid separately — each will then answer from its own acceptance
   letter. **A wrong percentage here reaches every agency that adopts the
   template**, which is why it is optional rather than required: a blank each
   agency answers is better than a guess they all inherit.
5. **Schedule** — **required.** The publish is refused without one. This decides
   what every item on every job under those tenders costs.

Then **Publish template**.

**If the schedule you need is not in the dropdown, stop — you are in Case 2.**
You cannot publish against a schedule that is not in the app, and the form will
not let you try. That refusal is the feature: a template with no schedule would
leave every adopting AT falling back to whatever its form happened to default to.

**A template always carries all five rate sections** — CRGO, Amorphous, Wound
Core, Overhauling and the Clause 4.0 circle limits. There is no partial publish.

**If the schedule is only partly transcribed**, the form says so in amber and
names which parts are borrowed from an older tender. UGVCL-2026 is in that state
today: its Clause 4.0 circle limits are 2020's, because the 2026 pages have not
been supplied. Publishing is still correct — the mixture is declared on screen
wherever rates are shown — but read the notice so you know what you are sending.

---

### Case 2 — the tender repriced

**The rates cannot be typed in anywhere.** Schedule-A, Schedule-B, the radiator
table and the Clause 4.0 limits live in the app's code, deliberately: they are
the tender's figures, not an agency's, so no agency and no administrator can edit
them from a screen.

1. **Send the schedule pages to whoever maintains the app.** All of them.
   A partial set produces a tender priced half from the new schedule and half
   from the old, which is worse than waiting.
2. They add it to the schedule registry and tell you when it is live.
3. It then appears in the publish dropdown, and you are in **Case 1**.

---

### Revising a template you have already published

**Admin Panel → New tender template**, then change the dropdown at the top of the
form from *A NEW template* to **Revise "…" — currently vN**. Everything prefills:
name, AT number, dates, schedule, percentage. Change what you need and press
**Publish new version**.

**The version number only moves if the RATES changed.** Correcting a name, a
tender number, the notes or the percentage leaves it where it is — so nobody who
already copied the template is prompted to take an update that would change
nothing. That is intended, and it means:

> **Adding a percentage to a template does not reach agencies that already
> adopted it.** They keep the percentage they typed. Only agencies creating an AT
> *after* the revision get it prefilled.

**Do not use the Publish button on the Estimate Master screen for this.** That
one publishes an AT's own rates and cannot set the schedule, the period or the
percentage. It is for a different job.

---

### What the agency does after you publish

They pick your template from the **Agency rate master** dropdown when creating
their AT — or, if the AT already exists, from **Estimate Master → Published AT
templates → Copy to this AT**.

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
