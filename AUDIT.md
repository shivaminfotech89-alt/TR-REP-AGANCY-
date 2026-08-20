# Data-integrity audit

Running record of defects found while working on estimates, billing and dispatch.
Each entry states what was wrong, the evidence, the real-world exposure, and status.

Diagnostic scripts referenced below live in `scripts/` and are **read-only** unless
explicitly stated. Run them against the dev server with the app loaded and signed in.

---

## OPEN

### O1. GP lookup can match the wrong transformer — highest severity

`NewJob.tsx:261-268` loads `pastJobs` with `where('ownerId', '==', uid)` only — **no
agency filter, no AT filter** — then sorts `createdAt` descending. The lookup at
`NewJob.tsx:1372` is `pastJobs.find(j => j.jobNo.toUpperCase() === val)`, so it takes
the **most recently created** job carrying that number, which need not be the unit on
the bench and need not even be in the same agency.

`applyPastJobToRow` (`NewJob.tsx:340-362`) then overwrites the row's `capacityKva`,
`make`, `serialNo`, `coreType`, `starRating`, `prevJobNo`, `prevAtNo` and
`prevDeliveryDate` from that record. `prevDeliveryDate` is what `calculateGpWarranty`
measures the window from.

**Exposure:** a guarantee claim assessed against another transformer's repair history —
wrong expiry date, wrong in/out-of-warranty verdict, and the row's serial number
silently replaced. Triggers on typing an exact number, not only on picking from the
datalist. Severity depends on the duplicate count — see O2.

### O2. Job numbers are not uniquely allocated

**This corrects an earlier conclusion that the race was fixed because `runTransaction`
was present.** It is not. The transaction at `NewJob.tsx:858` *reconciles a counter*;
it does not *allocate a unique number*. The number is chosen client-side before the
transaction opens, by `getNextJobNoInfo` (`AgencyContext.tsx:663`) reading
`activeAtMaster.lastJobNumbers` from in-memory state. Inside the transaction, lines
957-963 only raise `lastJobNumbers[counterKey]` to the maximum number already used —
nothing checks whether that number is taken.

Four collision paths:

1. **Concurrent intake** — two tabs/users read the same counter, compute the same
   number, both save. No conflict is raised.
2. **Stale context** — `syncCountersState` updates local state only in the saving tab.
3. **Core type / division changed after allocation** — `counterKey` changes, so the
   number is drawn from one counter and reconciled into another; the original counter
   never advances and reissues it.
4. **Different AT master — STRUCTURAL, not a race.** Counters live on
   `activeAtMaster.lastJobNumbers`, but prefixes come from shared division config. Two
   AT masters under one agency have independent counters, so the same
   division + core type produces the same job number under each. Guaranteed to recur
   on every new AT master. Needs a decision about *where counters live*, not a lock.

Not a defect: a GP warranty repair deliberately reuses the original job number
(`NewJob.tsx:890-891, 940`). Same physical unit, second visit. **The test is the
transformer, not the repair type: `serialNo` AND `make` AND `capacityKva` must all
match.** All three collisions found fail that test.

**Diagnostic:** `scripts/duplicate-jobno-console.js` — separates legitimate GP repeats
from true collisions and shows which record the GP lookup would return for each.

**Partly mitigated:** duplicate job numbers are now blocked at save
(`NewJob.tsx`, `confirmSaveJob`), checked across the whole agency and every AT master
under it, allowing reuse only on the same-transformer + GP test above. Also catches the
same number twice within one intake, which nothing previously prevented. This stops new
duplicates; it does not renumber existing ones (see C1) and does not fix the allocator.

#### Making counters agency-wide — scoping (STEP 4)

*Where they live now.* `lastJobNumbers` is a `Record<string, number>` keyed
`"{division}_{CORETYPE}"`, stored on **both** `atMasters/{id}` and `agencies/{id}`.
`getNextJobNoInfo` (`AgencyContext.tsx:693-705`) prefers the AT master's map, falling
back to the agency's only when no AT master is active. Prefixes resolve the other way —
`activeAtMaster.prefixes` **falling back to** `activeAgency.prefixes` — so two AT
masters routinely share a prefix while holding separate counters. That mismatch is the
structural collision.

*Code change — small.* Point every counter read and write at the agency document
unconditionally, dropping the AT-master branch in:
1. `getNextJobNoInfo` (`AgencyContext.tsx:663-708`)
2. `incrementJobNoCounter` (`AgencyContext.tsx:710-737`)
3. the `runTransaction` block in `NewJob.tsx:858-974`, which picks `masterDocRef`
   between `atMasters/{id}` and `agencies/{id}`

plus `syncCountersState`. The key shape is unchanged, so nothing downstream is affected.

*Migration — the real work.* Two options:

- **`max()` across AT masters** — for each key, take the highest value across all AT
  masters of the agency and the agency's own. Simple, but inherits whatever drift the
  counters already carry.
- **Derive from actual jobs — RECOMMENDED.** For every `{division}_{coreType}`, scan
  the agency's jobs, parse the numeric suffix of `jobNo`, take the max. Self-correcting
  regardless of counter state, and it reuses the same parse already in
  `NewJob.tsx:895-903`. One-off script, dry-run first, same pattern as the F5 backfill.

*Preconditions.*

1. **Existing duplicates must be resolved first** — agency-wide counters stop new
   collisions but do not renumber the three in C1.
2. **`atMasters.lastJobNumbers` must be retired, not left in place** — if both stay
   writable, any code path still reading the stale AT copy silently reintroduces the
   split. Delete the field after migration, or freeze it and remove all reads.
3. **BLOCKING QUESTION — confirm the numbering intent against the tender paperwork.**
   If job numbers are *meant* to restart per AT master (which the current design
   implies), agency-wide counters are the wrong fix; the right one is making the
   **prefix** AT-specific, so `MSBT-1` under AT 26-27 is distinguishable from `MSBT-1`
   under the previous AT. This is a documentation question that changes which fix is
   correct. *Awaiting review of a previous tender's paperwork — do not implement until
   answered.*

*Reach of the fix.* Agency-wide counters close **path 4 only**. Paths 1-3 remain,
because the number is still chosen client-side before the transaction opens and the
transaction only reconciles. Closing those requires moving allocation **inside** the
transaction — read the counter, assign `counter + 1`, write the job and the counter in
one atomic operation. Larger change to `NewJob`'s save path; the save-time guard now
catches the resulting duplicate either way, so it can be sequenced after the questions
above are settled.

### C1. Existing job-number collisions needing manual renumbering

Confirmed by `scripts/duplicate-jobno-console.js`: 37 jobs scanned, 3 duplicated
numbers, **0 legitimate GP repeats, 3 true collisions**. Each fails the
same-transformer test (serial + make + capacity), so each is an ambiguous reference to
a physical unit. These predate the save-time guard and are **not** fixed by it — they
need a human decision to renumber.

Doc IDs are recorded because the job number is currently the only handle on these
records, and renumbering removes it.

**⚠️ Read the KEEP / RENUMBER column before touching anything. `MSBT-12` contains a
legitimate pair AND a collision — renumbering the wrong record would destroy a valid
guarantee history.**

#### `MSBT-12` — 3 records, only ONE is the collision

| Doc ID | MR | Serial | Make | kVA | AT | Verdict |
|---|---|---|---|---|---|---|
| `drIm8L5uHbX2OVRdbVeP` | 9344 | `12` | `121` | 100 | none | **KEEP** — original OGP |
| `ScUE3NkHxAKW6T9C9623` | 1 | `12` | `121` | 100 | none, GP | **KEEP** — GP return of the *same* unit (serial, make and capacity all match the record above). This is the legitimate reuse, not a defect. |
| `BxVxraTszbqkpZprmhwp` | 85558 | `312132135` | `DVDVDFV` | 25 | 26-27 | **RENUMBER** — different physical transformer |

#### `MSBT-1` — 2 records, both different units

| Doc ID | MR | Serial | Make | kVA | AT | Verdict |
|---|---|---|---|---|---|---|
| `tKP7KMh4S45h875tWUPE` | 9344 | `xc` | `sdsd` | 100 | none | one of the two must be renumbered |
| `IP4acepDCgDZMoPGM0RM` | 2555 | `HJ` | `63` | 63 | 26-27 | one of the two must be renumbered — **also in F5 group 4, see below** |

#### `101` — 2 records, both different units (agency DRISHIV)

| Doc ID | MR | Serial | Make | kVA | AT | Verdict |
|---|---|---|---|---|---|---|
| `dXMZ8WALx0QpOK6oAM79` | 9344 | `WNP` | `WNP` | 200 | none | one of the two must be renumbered |
| `P9q3SxKkehJVEbGxCmSe` | 34 | `SS` | `SS` | 63 | none | one of the two must be renumbered |

Both MEGHA collisions (`MSBT-12`, `MSBT-1`) are a pre-AT job versus one created under
AT 26-27 — empirical confirmation of O2 path 4. The `101` pair is *not*: both records
are pre-AT within one agency, so it came from one of paths 1-3, which agency-wide
counters would **not** have prevented.

**GP exposure, confirmed:** for `MSBT-12` the lookup returned the 25 kVA `DVDVDFV`
unit, not the 100 kVA transformer. Mitigated by O1's fixes (agency scoping + operator
disambiguation), but the underlying ambiguity remains until renumbering.

**Cross-reference — `IP4acepDCgDZMoPGM0RM` has two open issues:**
1. This entry — shares job number `MSBT-1` with a different transformer.
2. F5 group 4 — its Internal inspection record exists but its `condition` is blank, so
   the scrap backfill could not restore its identity and deliberately skipped it.

Resolve both together: whoever identifies which physical transformer this record is
can settle the renumbering and the Repairable/Scrap determination in one pass.

### O3. Per-job `billAmount` applies AT twice

`BillingSystem.calculateJobTotal` already returns an AT-inclusive figure, then
`handleConfirmSendBill` multiplies by `(1 + atPct/100)` again before GST.

**Exposure:** the *printed* bill is correct (it uses `subTotal`/`grandTotal`, single
AT); only the `billAmount` stored on each job document is inflated. Anything reading
that field for reporting or reconciliation reads high. Not yet fixed — pending a
decision, since it is a bill-calculation change.

---

## DELIBERATE — reviewed and kept, not defects

### D1. The Scrap Delivered MR *list* uses the broad scrap test

`filteredMrNos` (`BillingSystem.tsx`) shows an MR if any job matches the bill type at
*any* stage, and the row's "Delivered Jobs" cell counts from that same broad set — so
an MR whose scrap has not yet been returned still appears, showing "0 of N". This is
**not** the delivered-only rule the bill itself applies.

Intentional. Hiding those MRs would make pending scrap invisible exactly when someone
needs to know it is outstanding. The safeguards sit elsewhere: the *bill* contains only
delivered scrap (`selectedJobsData` and `jobsForBillType` both require
`condition/status Scrap` + `status Dispatched` + `challanNo`), and an MR with nothing
returned opens the "no scrap transformers have been returned yet" modal with the
Proceed button suppressed. Do not "tighten" this to delivered-only without replacing
the visibility it provides.

---

## FIXED

### F1. Estimates priced off capacity defaults, not inspection data

`EstimateGenerate.tsx` queried `inspections` with `where('agencyId', '==', ...)`, but
**no inspection save path has ever written `agencyId`**. Firestore excludes documents
lacking the field, so the query returned zero rows for every job, always. With
`externalData`/`internalData` undefined, every optional-chained read in
`buildSingleJobEstimateData` fell through to a per-capacity default and produced a
plausible-looking estimate with no error flag.

**Exposure:** every CRGO estimate was priced from capacity defaults rather than the
real inspection, and the Clause 4.0 circle-limit check ran against those figures.
Confirmed concrete case: MSBT-15 HV coil billed at the 63 kVA default 47.00 kg instead
of the measured 10.00 kg (`totCoil` 4 × `wtOfCoil` 2.5).

**Fixed:** agency scoping moved in-memory via job IDs. Missing records now push a named
`rateError` and withhold the total instead of defaulting (F2). `agencyId` is now
stamped on new inspection saves, but **nothing filters on it until existing records are
backfilled**.

**Quantified by:** `scripts/blast-radius-console.js`.

### F2. Absent inspection data produced silent, plausible numbers

Capacity fallbacks (63 kVA HV coil 47.00, re-insulation 24.30) applied whether a field
was missing *within* a real inspection or the whole record was absent. `recordErrorIfApplies`
only checked whether the *rate* resolved, never whether the *quantity* was real.

**Fixed:** a wholly missing record now blocks with a named error. The per-field defaults
remain legitimate inside a real inspection.

### F3. CRGO scrap priced at ~4× the correct charge

Scrap was identified by `itemName` substring (`'scrap'`, `'dismental'`) plus
`itemCode === '1a'`. In the CRGO master `'1a'` is "Dismentaling" at Rs 1,603/2,061 by
capacity — the tender's labour charge, not the scrap charge. The correct charge is a
flat Rs 500 regardless of capacity.

**Exposure:** would have billed ~Rs 2,061 + AT per scrap unit instead of Rs 500 + AT.
**Confirmed non-issue in practice: 0 of 6 recovered-scrap jobs had been billed**
(`billNo`, `billSentDate`, `billAmount` all unset on AMKLL-9, KLL-6, AMSBT-1, MSBT-5,
MSBT-9, MWSBT-1). No incorrect bill reached UGVCL.

**Fixed:** resolution by mapped item code only — CRGO `'22'`, Amorphous/Wound Core
`'0'`. Correct figure: 500 × 1.04 (AT 4%) × 1.18 (GST 9+9) = 613.60 → **614**.

### F4. Scrap item code drift across three call sites

The estimate used `'19'` (defined in no master anywhere), the bill used substring
matching, and `Reports.tsx` had its own copy of the substring logic.

**Fixed:** one resolver, `resolveScrapCharge` / `getScrapItemCodeForCore` in
`lib/estimateCalc.ts`, used by the estimate, the bill and Reports. Code `'19'` retired.
Blocks with a named error when the mapped code is absent; never defaults to 500.

### F5. Scrap identity destroyed on dispatch

`job.condition` was **never written to the job document by anything** — it existed only
inside the inspection record's `data`. Scrap identity therefore lived solely in
`job.status === 'Scrap'`, which `handleDispatch` overwrites with `'Dispatched'`.

**Exposure:** a scrap transformer became indistinguishable from a repaired one the
moment it went on a challan. Confirmed: AMSBT-1, MSBT-9, MWSBT-1 (MR 85558) flipped to
"OK" after dispatch; **0 of 32 jobs registered as scrap anywhere in the database**.

**Fixed:** `InternalInspection` now writes `condition` to the job when the decision is
declared. Transitions are asymmetric by design — `unset → Scrap|Repairable` and
`Repairable → Scrap` allowed; `Scrap → Repairable` and clearing never permitted. Scrap
is a terminal determination made with the unit open: discoverable late, not
undiscoverable.

**Backfill: COMPLETE.** `scripts/backfill-condition.js` — **26/26 committed**,
`condition` written and no other field modified. 6 jobs held for manual review
(internal record present but its `condition` is empty), 0 unrecoverable, 0 stage
anomalies. The 6 remain without a `condition` field and will get one when their
internal inspection is next saved, or by decision from the group-4 detail dump.

Six units were recovered as scrap: AMKLL-9, KLL-6 (MR 1563), AMSBT-1, MSBT-9,
MWSBT-1 (MR 85558), MSBT-5 (MR 12). None had been billed (see F3).

**Group 4 overlaps with C1:** `MSBT-1` doc `IP4acepDCgDZMoPGM0RM` (MR 2555, AT 26-27)
is both a manual-review record here *and* one half of a job-number collision. See C1 —
identifying the physical transformer settles both at once.

### F6. Guarantee clock measured from `updatedAt`

`Dashboard.tsx:292` measured the 18-month GP window from `j.dispatchDate` — a field
**nothing has ever written** — falling through to `j.updatedAt`, the last time the
record was touched for any reason.

**Exposure:** the bias is one-way. `updatedAt` only moves forward, so windows were only
ever *extended*. The error is GP work done free that could legitimately have been
charged, not valid claims wrongly rejected. The true stamp survives on every job
(`deliveryDate` / `challanDate`), so correct verdicts are recoverable.

**Fixed:** now reads `deliveryDate || challanDate`, `updatedAt` retained as last resort.
**Quantified by:** section 4 of `scripts/blast-radius-console.js`.

### F7. Scrap transformers estimated as full repairs

`isScrap` was computed correctly in `buildSingleJobEstimateData` but never used as
control flow — only as a scattered per-item modifier, and computed too late to affect
one of the two paths.

- **CRGO** — `isScrap` zeroed *some* itemised lines (bushings, metal parts, coils,
  re-insulation, drying, testing, washer ring, insulating material) but left ~13 others
  charging, including the unconditional Labour Charge `'1a'` at Rs 2,061. The Rs 500
  scrap line was then **appended** to that repair estimate as item 26. KLL-6 (MR 1563)
  printed **6,540.20** against a correct 500 + AT.
- **Amorphous / Wound Core** — the fixed-rate branch returned *before* the scrap line
  was ever reached and never consulted `isScrap` at all, so a scrap unit billed the
  full Schedule-B **repair** rate with no scrap charge whatsoever. AMKLL-9 (MR 1563)
  printed **17,970.00** against a correct 500 + AT.

**Exposure — an estimate is a separate document from a bill.** No scrap job was ever
billed (F3), but estimates carry their own `estimateSentDate`, and a sent estimate is
an approval sought from the Superintending Engineer against a wrong figure.

**The MR 1563 forwarding letter, addressed to the Superintending Engineer:**

| Job | On the letter | Correct | Overstated by |
|---|---|---|---|
| KLL-6 (CRGO) | 6,801.81 | ~520.00 | ~6,281.81 |
| AMKLL-9 (Amorphous) | 16,532.40 | ~460.00 | ~16,072.40 |
| **Letter TOTAL** | **40,586.33** | — | **~22,354 from these two alone** |

**If that letter was sent, it must be withdrawn and reissued.**

The two correct figures differ because the AT percentage is per core type: CRGO **+4%**
(500 × 1.04 = 520.00) and Amorphous **−8%** (500 × 0.92 = 460.00). The same −8% explains
the letter's own numbers — 17,970 × 0.92 = 16,532.40 for AMKLL-9, and 6,540.20 × 1.04 =
6,801.81 for KLL-6, i.e. the estimate document's base total with AT applied. Confirms
the letter and the estimate sheet are the same computation, not two different errors.

**Quantified by:** section 5 of `scripts/blast-radius-console.js` — per scrap job it
reports `estimateSentDate`, `estimateRefNo`, the `sentAmount` actually stored when the
estimate went out, the `correctAmount` now produced, and the difference; then MR-level
forwarding-letter totals (`letterTotalSent` vs `letterTotalCorrect`) so every letter
needing withdrawal is identified, not just MR 1563.

**Fixed:** a scrap job of any core type now short-circuits at the top of
`buildSingleJobEstimateData` into exactly one line — the mapped flat charge (CRGO
`'22'`, Amorphous/Wound Core `'0'`) — then AT, then total. No physical, internal or
labour items, no Schedule-B rate. Blocks with the named error if the code is missing.
All now-unreachable per-item `isScrap` guards and the appended item-26 scrap line were
removed, so nothing implies scrap is still handled on the itemised path.

### F8. Mixed-MR scrap bills unreachable, and prefilled from the repair bill

Three separate causes in `BillingSystem.tsx`, all from treating an MR as one billable
unit after the two bills became independent documents:

1. **`handleSelectMr` forced the tab.** It set `billTypeFilter = 'repairable'` whenever
   an MR had any repairable job, so selecting a mixed MR silently moved the user off
   Scrap Delivered — the scrap bill could not be opened at all. Now a *default*: it
   only switches when the current tab has no jobs for that MR.
2. **`isSent` measured the whole MR.** `filteredMrNos` and `unsentBillCount` treated an
   MR as sent if *any* job carried bill data. Since sending the repair bill stamps only
   repairable jobs, the MR then vanished from the generator entirely, leaving the scrap
   bill unraisable. Now computed per bill type via `isBillSentForType`.
3. **Prefill crossed bill types.** `savedJobWithBill` / `savedJobWithDate` searched all
   MR jobs, so a mixed MR's scrap bill prefilled with the repair bill's number and
   date. Now scoped to the current type; approval no./date stay MR-wide (AT-level).

Also removed: `masterData`, which read the CRGO master only and fed nothing but a
`subTotal` dependency — so the total failed to recompute when the Amorphous, Wound Core
or Overhauling master changed. Pricing already resolves per job via
`getEstimateMasterForCore`; the dependency is now `activeAgency` + `activeAtMaster`.

### F9. Earlier fixes (same class: identity or state in a field that moves)

- `inspectionStage.ts` referenced status strings no code ever sets
  (`'Ready for Testing'`, `'Testing Completed'`) instead of the real
  `'Tested - Ready for Dispatch'`.
- `InternalInspection`'s initial fetch pulled both inspection types unfiltered while
  the post-save refetch filtered correctly, so External records satisfied Internal
  completeness checks.
- Blank inspection records marked jobs complete (MR 85558).
- Saved `0` / blank values silently reloaded as `'3'` / `'4'` on HV/LV counts, and as
  the standard-table value for oil capacity.

---

## Recurring theme

Every entry above is one of two shapes:

1. **A silent fallback that makes missing data look like real data** — capacity
   defaults, `|| '3'`, `updatedAt` standing in for a dispatch date, a hardcoded 500.
2. **Identity stored in a mutable field** — scrap identity in `status`, transformer
   identity in a job number that is not uniquely allocated.

New code should fail loudly on missing inputs, and should never key identity to a
field that changes as the unit moves through its lifecycle.
