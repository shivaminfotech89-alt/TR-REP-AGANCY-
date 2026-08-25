# What is still wrong on a clean database

Every record in the app today is test data and is being wiped before launch. This file lists
what remains **in the code** — the defects a real customer meets on an empty database.

Ranked by when it bites, not by how interesting it is. Nothing here is started.

Full detail for each is in `AUDIT.md` under the item number.

---

## Tier 1 — wrong on the first real job

These do not need a rollover, a second agency, or an unusual case. A first customer meets
them in their first week.

### 1. `billAmount` applies the AT percentage twice — **O3**

`BillingSystem.calculateJobTotal` returns an AT-inclusive figure (`est.baseTotal * (1 + atPct/100)`).
`handleConfirmSendBill:1212` then does `(baseAmt * (1 + atPct/100)) * (1 + gst)`.

At 4% AT that is a **4.16% overcharge** on every per-job `billAmount` — and the MR total on
the same bill is computed by a different path that applies AT once, so **the per-job figures
do not sum to the total printed beneath them.** Every bill, every customer, from day one.

Not theoretical: this is the arithmetic, read from the current code.

### 2. A new agency is seeded with another DISCOM's identity — **O7**, **O8**

`AgencySettings.tsx:146-158` seeds every newly created agency with UGVCL's registration:
`discomState: 'Gujarat'`, `discomStateCode: '24'`, `serviceSacCode`, a circle authority, a
division authority, a CC template. **A customer in another state gets a Gujarat identity and
prints it on their documents.** The stored bad values are being wiped; the code that writes
them is not.

Worst single item for onboarding: it is wrong at the moment of signup, on a tax document,
and looks configured.

### 3. No IGST path — **O9**

CGST/SGST is applied unconditionally. An out-of-state agency is charged the wrong tax on
every invoice. Compounds with O7: the state code that would drive the determination is
seeded, not asked.

### 4. Job numbers are not uniquely allocated — **O2**

The allocator reads a counter and writes a job without a transaction, so two concurrent
users get the same number. Test data already produced collisions (closed as C1); a clean
database with two operators reproduces them. `incrementJobNoCounter` — the function that
looks like the allocator — is dead code (**A2**), which is part of why this is easy to
misread.

### 5. GP lookup can match the wrong transformer — **O1**

Recorded in `AUDIT.md` as the highest-severity item in the original review. A guarantee
lookup matching the wrong unit either grants a free repair that was not owed or denies one
that was.

### 6. `sealType` tests a literal the form never emits — **O23 / F53**

The estimate tests `'B' | 'Bolted' | 'Y'`; the form's select offers `['BL','SL']`. Item 17
(conversion of sealed to bolted, Rs 1,511) has **never fired and cannot fire**. Sealed
transformers are roughly 2 in 100, so this is a small, permanent under-claim.

**Blocked on one domain answer**, not on effort: does `sealType` record the unit AS RECEIVED
or AS DELIVERED? The workflow argues as-received (the field is mandatory to complete external
inspection, which happens on arrival), making the correct test `=== 'SL'`. Guessing wrong
inverts the charge onto 98 of 100 jobs.

### 7. Oil shortage is measured everywhere and priced nowhere — **O17**

`lessOilLtrs` is captured on every external inspection and never becomes money. The
estimate's `Less` row can never be non-zero. Whether it should be is a tender question, but
the current state is that a measured quantity has no price.

---

## Tier 2 — wrong at the first tender rollover

Silent until the second AT exists, then wrong on everything.

### 8. Estimates price from the ACTIVE AT, not the job's own — 15 call sites

`getAtPercentageForCore(activeAtMaster, …)` appears at 15 sites across the estimate, the
bill and the reports. A job carries `atId`; nothing in pricing reads it. After a rollover,
**reprinting an old job's estimate prices it at the new tender's percentage** — the document
changes without the job changing.

This is the item that keeps `ROLLOVER.md` step 1 alive. Fixing it removes a manual step from
every rollover and makes historical documents reproducible.

### 9. AT `startDate` defaults to today — `AtSettings.tsx:65-66`

The create form opens with `startDate = today` and `endDate = today + 1 year`. The file's own
comment at `:76` says *"`startDate` is a tender date the operator types, not a creation
time"* — the intent is documented and the default contradicts it.

Harmless today because **nothing reads the range** except the settings display and a
sort. It stops being harmless the moment rates are keyed to the AT, which is the direction
of travel. Needs a domain answer for what it should default to; blank-and-required is the
option that cannot be silently wrong.

### 10. AT activation is decided in two places that disagree — **O19**

The caller overrides the guard. Which AT is active determines which percentage prices a job,
so a disagreement here is a pricing disagreement.

### 11. An AT's "Closed" status promises an enforcement that does not exist — **O18**

Closing an AT looks like it stops work under it. Nothing enforces that.

---

## Tier 3 — under-claiming, permanently

Money the agency is entitled to and never asks for. None of these produce a wrong number;
they produce a missing line.

### 12. Twenty of fifty-one Schedule-A entries are unreachable — **O22**

No code path resolves them. Each is work the tender prices and the app cannot bill. Groups
B/C/D (valve, tap-changing switch, main tank replacement, overhauling-as-one-line) are
domain questions awaiting answers.

### 13. "Originals missing" coil rates are unreachable — **O21**

`12B` / `13B` — the higher rates for a stripped unit — have no code path, because nothing
records whether the original coils arrived. Needs a field and a domain answer on frequency.

### 14. The Overhauling master has never been checked against the tender — **O30**

No mapping exists from OH item codes to Schedule-A, so nothing has ever compared its rates
to anything. It could carry slips of exactly the kind found in the CRGO 100 kVA column. The
`1057/1256/1452` vs `1052/1248/1446` gap is unexplained.

### 15. Overhauling per-kg lines now block — **O25**, **O27**

Tank and conservator replacement price per kilogram and no field records a weight, so they
refuse rather than invent one. Correct behaviour, but it means those lines cannot be claimed
at all until a weight is captured. O28 establishes that a damaged main tank is a scrap
decision, so the main-tank line may never be needed; the conservator one might be.

---

## Tier 4 — integrity and correctness, no immediate money

### 16. The bill ignores the DISCOM's approved amount — **O29**

`approvedAmount` is captured, stored, and rendered beside the estimate when they differ.
`BillingSystem` contains zero references to it. When an approval differs from an estimate,
the bill claims a third, independently recomputed figure matching neither.

The 8-B shape: the app already knows the answer and does not consult it. Blocked on a tender
question — should the bill follow the approval, or the work?

### 17. `estimateAmount` is stored from `baseTotal` — **O4**

The stored figure understates the document it came from.

### 18. "Save All" writes the screen's resolved view, not stored data — **O13**

Five sections are written from React state, which includes rows and rates that were resolved
from fallbacks rather than stored. Opening the master and saving converts inherited values
into stored ones across every section. The publish path was fixed (`publishPlanFor`); this
path was not.

### 19. `normalizeAmorphousOrWoundCoreData` backfills `fixedRate` from an arbitrary capacity — **O11**

### 20. Three places decide whether a stored section "is the CRGO card" — **A7**

### 21. The job-number read and write test different conditions on the same field — **A6**

### 22. `paymentDeductions` accepts the full payment as a deduction — **O5**

Unvalidated. A typo can zero a payment.

### 23. A sixth path writes document fields, in a file called Reports — **O15**

### 24. Inspection `createdAt` uses the client clock — **A5**; most collections have no `createdAt` at all — **A4**

Creation order is unrecoverable for most collections. Every census this week that wanted to
know "when did this happen" ran into it.

### 25. The MR delete path — **O33**

MR-scoped so a single row cannot be removed; orphans inspections with no cleanup and no count
in the confirmation; **no guard on issued documents**, so an MR with a sent and paid bill can
be deleted, leaving the bill referenced by nothing.

---

## Tier 5 — design decisions, not defects

### 26. The AT-keyed rate model

Rates belong to the tender, not the agency. Confirmed as the right model. Confirmed as
requiring **admin-issued tender keys** — free text has already fragmented (`"AT2026-27"`,
`"2026_27"`, `"2026-27"`, `"AT 26-27"` across six records, at least three of them one
tender). The additive migration route is agreed: add the tender layer, resolve
`agency → tender → Schedule-A`, let the agency layer wither.

Closes or reshapes items 8, 9, and **O10**, and removes the seven-passes problem.

### 27. Cross-account rate changes — **O32**

Reachable by script today; the rules already permit it; only a client-side owner filter
stands in the way. Deliberately not exposed as a button — an admin overwriting rates on
accounts belonging to people who are not in the room is a different power from anything the
app currently offers.

### 28. `public_config/estimate_master` staleness — **O12**

Note this survives the data reset if `public_config` is not wiped with the agencies. **Worth
confirming explicitly** — it currently holds the six mistyped 100 kVA rates, and a fresh
customer would inherit them on signup.

---

## Already fixed — do not re-open

**O14** issuance stamping · **O16** estimate and bill by two models (F57) · **O26** the shared
weight constant · **O31** the five-section write · **O20** S.E. resolved as an agency fact ·
**F44/F46/F47/F52** the coil and flag defects · **F53–F59** this week's consolidation, gating
and diagnostic fixes.

---

## The reset is partial, not total — 2026-08-25

The current AT is live and generating estimates. It, its agency, its divisions, prefixes,
allotments and counters, and every job referencing it, all stay. Only debris goes.

`scripts/reset-classification-console.js` (read-only) sorts the records into keep / candidate
and reports the overlaps. Three things it establishes that decide whether a partial reset is
safe at all:

- **MIXED MRs.** The only delete path in the app is MR-scoped (O33). If a job you are keeping
  shares an MR with one you are removing, the UI cannot separate them - deleting that MR
  takes both. Those MRs must be left alone, or the individual job documents deleted directly,
  which the app cannot do.
- **ORPHANED INSPECTIONS.** Nothing deletes an inspection when its job goes. They are inert -
  no map ever looks up a missing id - but every later census has to recognise them.
- **GUARANTEE HISTORY.** A GP claim matches a transformer against its previous repair. Deleting
  a predecessor silently turns a valid guarantee claim into a normal chargeable repair.

Two things that need no action: allotment consumption is counted live from jobs rather than
stored, so it self-corrects; and `lastJobNumbers` is never rewound, so numbering continues
past the gap and cannot reuse a number.

## The one to check before anything else

**Does the data reset include `public_config`?** If it does not, item 28 means the first real
customer inherits the six mistyped rates on signup, and the correction pass that was
half-finished this week still matters. If it does, that item disappears and so does the
remaining admin pass.
