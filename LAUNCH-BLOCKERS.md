# What is still wrong on a clean database

Every record in the app today is test data and is being wiped before launch. This file lists
what remains **in the code** — the defects a real customer meets on an empty database.

Ranked by when it bites, not by how interesting it is. Nothing here is started.

Full detail for each is in `AUDIT.md` under the item number.

---

## Tier 1 — wrong on the first real job

These do not need a rollover, a second agency, or an unusual case. A first customer meets
them in their first week.

### 1. Out-of-state agencies are taxed CGST+SGST against their own GSTIN — **O9**

**A wrong tax treatment on a printed document, and the document carries the evidence.**

There is no GSTIN validation anywhere (`firestore.rules:107` checks type and length only), so
a non-Gujarat agency onboards without obstacle. Nothing compares the agency's state to the
DISCOM's: `getAgencyStateCode` is read only for display and gating, `cgstPercent` /
`sgstPercent` are applied unconditionally at eight sites, and `igst` appears nowhere in `src/`.

So the invoice prints *Supplier State Code 27*, *Buyer State Code 24* — an inter-state supply
on its face — and charges intra-state tax on the same page.

Bites only an out-of-state customer, but on their first invoice, and it cannot be fixed by a
later deploy: the paper is out. The workaround anyone would find — setting cgst 0 / sgst 18 —
produces right amounts under wrong labels, which looks solved and is not.

**INTERIM SHIPPED — a non-24 GSTIN is now refused** at the creation form, at the save in
`EditAgencyForm`, and in `missingForTaxInvoice`, with a message naming what is refused, why,
and asking the prospect to make contact (**D6**). That makes an already-encoded scope
decision honest and fails at signup rather than at a division office. **O9 itself stays open
and unbuilt.**

**And IGST is not a tax feature — it is a stamped-document feature.** A reprint of an
intra-state invoice must stay intra-state, and nothing records which treatment was applied.
That is the same missing capability as O29, and it is now filed as its own pattern note:
the app recomputes documents rather than reproducing them. Price IGST as part of that
change, not on its own.

### 2. `billAmount` applied the AT percentage twice — **O3** — ✅ FIXED

Left in place because its ranking history is instructive. Reported twice as narrower than it
was: first as a rows-do-not-sum discrepancy that did not exist, then as stored-only when it
also affected the **Excel export headed TAX INVOICE**. Fixed at all five sites, with the
pre-AT column back-derived so the file satisfies its own arithmetic.

### 3. A new agency is seeded with another DISCOM's identity — **O7**, **O8** — ✅ LARGELY FIXED

`AgencySettings.tsx:146-158` seeds every newly created agency with UGVCL's registration:
`discomState: 'Gujarat'`, `discomStateCode: '24'`, `serviceSacCode`, a circle authority, a
division authority, a CC template. **A customer in another state gets a Gujarat identity and
prints it on their documents.** The stored bad values are being wiped; the code that writes
them is not.

Worst single item for onboarding: it is wrong at the moment of signup, on a tax document,
and looks configured.

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

### 12a. Schedule-A sr 7, tap changing switch, is unreachable from any screen — **MEDIUM** — G118

The internal inspection sheet has **no tap-changer field**. Its twenty-three stored fields are `condition,
damB, damR, damY, dc, hvCoilLimb, hvSeConductor, inPnt, inspectedBy, inspectionDate, insula, lvCoilB, lvCoilR,
lvCoilY, totCoil, totWt, totWtLv, totWtLvReIns, tstTrn, wasring, windingType, wtOfCoil, wtOfCoilLv` — none of
them is a tap changer (`totCoil` is a coil count). Nothing records the observation, so nothing can price it.
Same class as `12A-a1` and the "originals missing" rates (item 13, **O21**): a priced row the app cannot reach.

**Why it is LOW rather than a gap in the set — clause 21.0 narrows it sharply.** The clause says a tapping
switch on an old **25, 63 or 100 kVA** unit is **discarded**, the transformer made fixed-ratio at normal tap, and
the damaged switch deposited to UGVCL's Divisional store. It is not replaced. Switches at **200 and 500 kVA are
essential and shall not be discarded**. So sr 7 is only ever claimable at capacities the clause does not
discard — in practice 50, 75, 200 and 500 kVA.

Measured against 257 live jobs:

| capacity | jobs | band | schedule | clause 21.0 |
|---|---|---|---|---|
| 5 | 2 | B5 | pays 0 | — |
| 10 | 64 | B10_16 | pays 0 | — |
| 16 | 32 | B10_16 | pays 0 | — |
| 25 | 48 | B25 | pays 0 | discard |
| 63 | 67 | B50_63_75 | **pays 3435** | **discard** |
| 100 | 30 | B100 | **pays 4008** | **discard** |
| 200 | 14 | B_ABOVE_100 | **pays 5153** | essential |

```
band pays 0                                        146 of 257
band pays BUT clause 21.0 says discard (25/63/100)  97
genuinely claimable                                 14   all at 200 kVA
```

**⚠⚠ RAISED FROM LOW TO MEDIUM, 2026-10-10, AND THE CORRECTION IS TO THE OWNER'S OWN REASONING.** It was
filed LOW on "200/500 are rare for these agencies" - stated as fact, and it is a guess. Measured: **200 kVA is
14 of 257 jobs, 5.4%**, and there is **not a single 50, 75 or 500 kVA job in the database**. So the exposure is
one capacity band, present in real volume.

**And clause 21.0 points the other way for that band.** It says switches at 200 and 500 kVA are *"essential and
shall not be discarded"* - so **replacement is the expected route there**, not the exception. sr 7 is genuinely
claimable at 200 kVA, and at Rs 5,153 a unit that is **up to Rs 72,142 across the 14 live jobs that the app
cannot record at all**.

The correction came from the measurement, not from the reasoning: the figures were produced to support parking
this and instead argued for raising it.

**⚠ AND THE CLAUSE AND THE SCHEDULE DISAGREE ABOUT 63 AND 100 kVA, WHICH NOBODY HAS NOTICED.** Clause 21.0 names
both as discarded; Schedule-A pays Rs 3,435 and Rs 4,008 for them. 97 live jobs sit in that overlap. The note in
`1819AT.md` under clause 21.0 reads *"matches Schedule-A item 7, which pays 0 for bands B1–B3 and pays only from
50/63/75 KVA upward"* — **which is true about the bands and silent about the contradiction**: it treats the 0s
below 25 as the whole story and does not observe that two of the three discarded capacities are paid ones. Either
the schedule prices a switch the clause says is thrown away, or the clause's list is about something narrower
than the rate row. **Not resolvable from either document alone.**

**Open to the operator:** has any 200 kVA unit come in needing a tapping switch? If yes, this is a field plus a
rate lookup and stops being low. If no, it stays parked — but parked with the figures above rather than on an
assumption about rarity.

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

### 25a. Nothing in this repo renders a screen, so a claim about a template can only be a source assertion — **MEDIUM** — G121

**Promoted out of "deferred, never argued" on 2026-10-10.** It had been flagged across G106, G107, G108, G110,
G111 and G112 as something that would be useful; it is on this list now because it has twice been the reason a
check could not be written as a check.

**The two instances, which are the justification:**

| | what could not be verified by execution | what was written instead |
|---|---|---|
| **G121** | that `{isScrapJob ? 'SCRAP' : 'REPAIRABLE'}` does not hold a bare reference to the imported function — truthy always, so **every forwarding letter would print SCRAP** | a source assertion scanning for `isScrapJob` used as a value. `tsc` returns **0 errors** on the bug, proved by reintroducing it |
| **G68** | that the estimate-master grid shows the inherited figure in the cell an operator reads | recorded in that entry's own words: *"the grid was not rendered in a browser. The census reads the functions the grid calls and the rows it seeds, not pixels."* |

**⚠ THE PATTERN THIS SITS UNDER IS THE FIRST ONE IN `AUDIT.md`** — a check that reads a description of the
behaviour rather than executing it. Nine checks in that file have failed that way, two of them *in the same
change* as G121: a ban on `<option value="OH"` that matched a different select, and a ban on an expression that
matched the comment explaining why the expression was replaced. A source assertion is not merely weaker; it
fails in a direction that reads as a pass.

**Most of the machinery already exists.** `print-check` launches real Chrome over DevTools on Node's built-in
WebSocket, builds with Vite and serves the output — `findChrome`, `launch`, `serve`, `evaluate` in
`scripts/print-check/lib/chrome.mjs`. **A screen harness is that machinery with a different entry point, not new
infrastructure.** There is no jsdom, happy-dom, testing-library or vitest in the tree, and adding one would be a
second rendering story beside the one that works.

**What it would and would not reach**, measured when the question was first asked (G112):

- **Would:** the MR edit dialog, the Divisions panel, the intake form, the estimate-master grid, and any
  template whose contents are currently asserted from source.
- **Would not, usefully:** the Excel exports. `XLSX.writeFile` hands a file to the browser, so asserting a cell
  means lifting the row builder out of its component first — the same extraction done for the add-unit gate in
  G112 and for the coil predicate in G114.

**Cost and status.** `print-check` is ~8s per document and is deliberately **not a gate** (G60): it needs
Chrome, a service-account key and a minute. A screen harness inherits all three, so **it would stay on demand** —
which means it would not have caught the G121 trap at commit time either. That is an argument about what it is
for, not against building it: its value is making a template's contents assertable at all, not making them
assertable for free.

**Why MEDIUM and not higher:** no live defect is known to be hiding behind it today. Both instances were caught
— one by the owner reading the diff, one by its own entry admitting the gap. **The risk is the next one, where
nobody is reading.**

### 25b. A fully paid bill on a job that belongs to no tender — **HIGH** — G124

`MSBT-12`, document `ScUE3NkHxAKW6T9C9623`, MEGHA, MR 1, SABARMATI, 100 kVA CRGO, `repairType: GP`,
`status: Dispatched`, created 2026-08-11 — **and `atId` is absent.**

It is not a draft. It has been through the whole cycle:

```
estimateAmount      5661          estimateRefNo   UGVCL/EE-T-1/TRANS-REP/1
estimateStatus      Sent          estimateSentDate 2026-08-15
billNo              BILL/1        billStatus      Sent      billSentDate 2026-08-15
billTotalMrAmount   6680
paidAmount          6680          paymentDate     2026-08-15  paymentStatus Paid
paymentRefNo        UTR/2026/1    approvedAmount  5661
```

**⚠⚠ IT SITS OUTSIDE EVERY PER-TENDER TOTAL IN THE APP, BY CONSTRUCTION.** Every count, query and scope in the
codebase resolves a tender by document id:

- the three allotment count sites query `where('atId', '==', …)` — a job with no `atId` matches none of them;
- `matchesAtScope` returns `false` for an empty `atId` unless "all tenders" is on, so it is absent from the
  register, the billing screen, the estimate screen and the dispatch screen while any tender is selected;
- `atResolutionForJob` returns `source: 'no-at'`, so it has no AT percentage and no schedule.

So **Rs 6,680 has been invoiced and paid against work that no tender total includes.** It is not that the figure
is wrong; it is that the figure is nowhere. Any reconciliation of a tender's billed value against this
database will be short by it, and nothing in the app reports the discrepancy because nothing can see the job.

**⚠ AND IT IS GP, WHICH MAKES THE AMOUNT ITSELF A QUESTION.** A GP job is guarantee rework at no cost — it
draws no allotment precisely because "the quota already paid for it" — yet this one carries
`estimateAmount: 5661`, `approvedAmount: 5661` and `paidAmount: 6680`. Either the GP classification is wrong or
the billing is. **That is a second fault on the same record and it is the owner's to resolve**; recording it
here rather than guessing which half is right.

**Why HIGH rather than the tier this sits in.** The three other atId-less jobs (`MSBT-12`/MR 9344,
`MSBT-1`/MR 9344, both MEGHA) carry **no money at all** — they are the historical shape O2 describes and are
harmless. This one is the only atId-less job in the database with a bill or a payment, and the only one where
the missing reference has already produced an issued document.

**Not fixable from the data.** Which tender this job belonged to is not recoverable from the job: MEGHA holds
two (`AT 26-27` and `UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1819`), the estimate reference
`UGVCL/EE-T-1/TRANS-REP/1` names neither unambiguously, and stamping one would decide an AT percentage and a
schedule for an estimate that has already been approved at 5,661. **The operator has to say which tender MR 1
was issued under.** No script ships for it, because a script would have to choose.

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
