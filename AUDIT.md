# Data-integrity audit

Running record of defects found while working on estimates, billing and dispatch.
Each entry states what was wrong, the evidence, the real-world exposure, and status.

Diagnostic scripts referenced below live in `scripts/` and are **read-only** unless
explicitly stated. Run them against the dev server with the app loaded and signed in.

---

## Pattern: stored side-records diverge from the printed document

Three instances found in one day (O3, O4, and the `estimateAmount` case below). The
shape is always the same: **the document is rendered by one function, and a "what we
charged" field is recomputed alongside it by different code.** Nothing reconciles the
two, so they drift — silently, and in whichever direction the second computation
happens to be wrong.

| Field | Rendered by | Stored by | Direction |
|---|---|---|---|
| `billAmount` (O3) | `subTotal`/`grandTotal`, single AT | `handleConfirmSendBill`, AT applied twice | **over**states |
| `estimateAmount` (O4) | `getJobFullEstimate(...).finalAmount` | `handleSaveEstimateDates`, from `baseTotal` | **under**states |

Neither has reached a customer-facing document — the printed output is correct in both
cases — but anything reconciling from the stored field reads wrong.

The one field that does NOT drift is `paidAmount` — because it is **entered by hand
from the bank credit** rather than computed. It records what was received, so it is
authoritative by construction. That is what makes MSBT-12 decisive: reality was written
down next to the calculation, and they disagree (O3).

**Rule for any future field recording "what we charged": write it from the same
function that renders the document.** Do not recompute it alongside. If a stored figure
and a printed figure can be derived independently, they will eventually disagree, and
the disagreement will be found by an auditor rather than by us.

---

## Pattern: a rule enforced at one call site, unguarded at the others

The first pattern note is about **a value computed twice**. This one is about **a rule
applied once**. Different shape, same consequence: the codebase agrees with itself in
the case someone tested, and disagrees everywhere else.

Three instances found in one day, **all discovered only because something visibly
broke** — never by the guard being noticed as incomplete:

| | Rule | Enforced at | Unguarded at |
|---|---|---|---|
| **F4** | identify the scrap item | three places, each matching *differently* (name substring, `'1a'`, `'19'`) | — the three simply disagreed |
| **F10** | block on an unresolvable charge | `handleConfirmSendBill` (the write) | `handlePrint`, `handleExportExcel` — an invoice printed 0.00 and went out |
| **F11** | never regenerate a GP job number | `addTransformer`, `duplicateTransformer` | the blank-number effect, the coreType branch, the division branch, `handleAutoFillEmptyJobNos` |

**Working rule.** When a guard is added, enumerate every path that performs the same
operation and guard all of them — or move the operation behind a single function that
carries the guard. **A guard at the site where the bug was reported is not a fix, it is
a narrowing.** The next call site will be found the same way the last one was: by an
operator hitting it in live work.

**The enumeration is what makes it verifiable.** Listing every surviving writer and
showing each is either out of scope or permitted is a check someone else can repeat.
Asserting "the fix is complete" is not. F11's entry below lists all eleven job-number
writers and classifies each; that table is the evidence, not the prose around it.

Prefer the single-function form where the operation is small enough to centralise —
`resolveScrapCharge` (F4) is the example: one resolution point, so a fourth caller
cannot drift. Where the operation is spread through UI event handlers and cannot
reasonably be centralised (F11), the enumeration is the substitute, and it belongs in
the commit that adds the guard.

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

**OBSERVED, not theoretical.** MSBT-12 (MR 1, see C3) stored `billAmount` **6,413**
while the operator recorded **6,680** actually received against `UTR/2026/1`. Because
`paidAmount` is entered by hand from the bank credit, that is a case where reality was
recorded alongside the computed figure — and the two disagree. This is direct evidence
of the divergence, not an inferred risk.

**Exposure:** the *printed* bill is correct (it uses `subTotal`/`grandTotal`, single
AT); only the `billAmount` stored on each job document is wrong. Anything reading
that field for reporting or reconciliation reads high. Not yet fixed — pending a
decision, since it is a bill-calculation change.

---

### O4. Stored `estimateAmount` is built from `baseTotal` — understates the document

`EstimateGenerate.handleSaveEstimateDates` writes
`estimateAmount = Math.round(calculateJobTotal(job) * (1 + atPct/100))`, and
`calculateJobTotal` returns **`est.baseTotal`**, not `finalAmount`. So the stored figure
is the base total with AT applied, missing everything between base and final.

The printed documents — the forwarding letter (`calculateMrEstimateTotal`) and the
single-job estimate sheet — both render `getJobFullEstimate(job).finalAmount`. They are
correct. Only the stored side-record is wrong.

**Observed:** MSBT-12 (MR 1) stored `estimateAmount` **5,661** against a document figure
of **24,301.47**.

**Exposure:** anything reconciling estimates from the stored field reads low — Reports'
fallback, dashboard rollups, any future reconciliation. Nothing customer-facing.
Same class as O3 but the opposite direction and a different cause: O3 applies AT twice
and overstates; this one starts from the wrong total and understates. See the pattern
note at the top of this file.

**Not yet fixed.** The correct fix is to write the stored field from the same function
that renders the document, rather than recomputing it.

### C2. MSBT-12 (MR 1) — submitted estimate routed the approval to the wrong authority

The only estimate actually submitted among the 26 mispriced jobs.
`estimateSentDate` **2026-08-15**.

| | Amount |
|---|---|
| Sent to UGVCL | **24,301.47** |
| Correct | **25,243.05** |
| Circle limit (SE approval power) | **24,609** |

It is also the only job in the set that flips *toward* EXCEEDS — the other 19 verdict
changes all went EXCEEDS → within.

**This is not simply a wrong number.** UGVCL received an estimate presented as **within**
the Superintending Engineer's financial sanction power for a job that in fact
**exceeds** it. The figure determined which authority the approval was routed to, so
the approval was sought from the wrong office.

**Remedy: reissue.** The estimate must be reissued at 25,243.05 and routed for the
higher sanction the correct figure requires. Withdrawal alone is not sufficient —
the original routing decision was made on the wrong basis.

### C3. MSBT-12 (MR 1) — GP job charged AND collected. Remedy: REFUND

**A repair under guarantee was billed and the money was taken.** A GP job carries no
charge: the agency repairs it free, which is what the guarantee means. Nothing in
`EstimateGenerate`, `BillingSystem` or `estimateCalc` filters on `repairType`, so a GP
job is priced exactly like a normal repair.

| | |
|---|---|
| Job | **MSBT-12**, MR 1, 100 kVA CRGO |
| Estimate sent | 2026-08-15 |
| Bill | **BILL/1**, 2026-08-15, `billAmount` **6,413** |
| Payment | **Paid** 2026-08-15, `UTR/2026/1`, `paidAmount` **6,680**, NEFT/RTGS |
| Bill composition | Not mixed — no non-GP jobs on the same bill |
| **Remedy** | **REFUND 6,680** — money was collected, so withdrawal is not available. Single-job bill, so no reissue is required. |

**Refund amount: 6,680.** `paidAmount` is entered **manually by the operator from the
actual bank credit** — it records what was received, not what the code calculated. It
is therefore authoritative, and the only figure here derived from reality rather than
from a formula. `billAmount` 6,413 is a computed side-record and is not the basis for
the refund.

**⚠️ SAME JOB AS C2.** MSBT-12 (MR 1) carries **two** independent defects:
1. **C2** — its estimate was submitted at 24,301.47 when the correct figure is
   25,243.05, routing the approval below the SE's 24,609 limit when it exceeds it.
2. **This entry** — it is a GP job and should never have been estimated or billed at
   all.

These compound: the wrong-authority routing is moot once the job is recognised as GP,
because a GP job produces no estimate to route. Resolve as one action with the division
office, not two.

**Confirmed clean:** the other two GP jobs, **MSBT-6** and **MSBT-112**, carry no
estimate and no bill — `estimateSentDate`, `billNo`, `billSentDate`, `estimateAmount`
and `billAmount` all unset. MSBT-12 is the only GP job ever charged.

**Fix pending:** exclude `repairType === 'GP'` / `isGp` from estimate generation, the
forwarding letter table and TOTAL, and from all billing paths. Oil accounting is
deliberately unaffected — oil is consumed regardless of who pays for the repair.

### A2. `incrementJobNoCounter` is dead code that looks like the allocator

`AgencyContext.tsx:710` defines `incrementJobNoCounter(counterKey, count)` and the
context exposes it. **It has zero call sites anywhere in the app.**

It is not merely unused — it is *misleading*. It wraps a `runTransaction` that reads
`lastJobNumbers`, adds `count`, and writes it back, which is exactly what a correct
allocator would look like. Anyone reading it would reasonably conclude that job numbers
are transactionally allocated. They are not: the number is chosen client-side before
any transaction opens, and the real code only reconciles the counter afterwards (O2).
This function's existence is part of why the allocator was previously believed fixed.

**Cleanup, deliberately not done in the change that found it** — deleting it would have
mixed an unrelated removal into a GP intake fix. Do it as its own change.

When removing it, check first whether the agency-wide counter work (O2) wants to *use*
it rather than delete it: it is close to the shape that work needs, and may be better
repurposed than removed.

### A1. MSBT-112 — blocked pending external inspection (action, not a defect)

Now blocks with *"no external inspection data - quantities cannot be derived"*. This is
the F2 rule working as designed: the job has no External inspection record, so its
quantities cannot be derived and the estimate refuses rather than falling back to
capacity defaults.

**Action needed:** enter MSBT-112's external inspection. It will then estimate normally.
No code change required.

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

### D2. Wound Core falls back to the Amorphous master — all items, not just scrap

`getEstimateMasterForCore` (`AgencyContext.tsx`, WOUND_CORE branch) resolves in this
order: the agency's `estimateMasterWoundCore`, the global default's, then **the
agency's `estimateMasterAmorphous`**, then the global default's Amorphous, and only
then `defaultWoundCoreEstimateData`. It also skips any array a legacy-shape heuristic
rejects (`isLegacy` — names containing "dismental", "washer ring", "hv metal",
"lv metal", i.e. a CRGO array mis-stored as Wound Core).

**Consequence:** an agency with no saved Wound Core array — or one the heuristic
rejects — is priced **entirely from the Amorphous master, for every item**, not just
the scrap charge. Editing an Amorphous rate silently changes Wound Core pricing.

This appears deliberate: `defaultWoundCoreEstimateData` is a deep copy of
`defaultAmorphousEstimateData`, and `EstimateMaster.tsx` offers an explicit "sync Wound
Core with Amorphous" action, so the two are intended to mirror. It is recorded here
because it is invisible at the call site: nothing in a bill or estimate indicates that
a Wound Core job was priced from an array the user edited under a different heading.

**Not changed.** Pre-existing and reviewed. If the two core types ever need to diverge
in rate, the agency must save a Wound Core array first — otherwise the divergence will
be silently ignored.

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

**MEASURED.** `scripts/blast-radius-console.js` sections 1-3, 32 jobs in the agency:

- **26 of 32 jobs mispriced — every one overstated.** Capacity defaults are higher than
  the measured quantities in every observed case. Worst seen: MSBT-6 at **21,028
  submitted vs 8,612 correct**.
- **19 jobs flipped circle-limit verdict, all EXCEEDS → within.** Transformers were
  being flagged as needing Superintending Engineer approval purely because the estimate
  was built from capacity defaults. Those escalations were unnecessary.
- **1 estimate actually submitted** — MSBT-12 (MR 1), and it flips the *other* way,
  within → EXCEEDS. See **C2**: it routed the approval to the wrong authority and needs
  reissuing.

The 25 unsubmitted jobs need no external remedy — they simply reprice correctly now.

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

**MEASURED — confirmed non-issue.** Section 4 of `scripts/blast-radius-console.js`
reports **0 in-guarantee verdicts changed**. Every dispatched job lands on the same
side of the 18-month window under both the buggy and the corrected measurement, so no
GP claim was ever accepted or rejected on the wrong basis. The exposure was real in
principle but never materialised in this data.

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

**MEASURED — exposure real but NEVER MATERIALISED.** Section 5 reports **0 of 6 scrap
estimates sent**. All three forwarding letters covering scrap MRs show
`letterTotalSent` 0 and `anyEstimateSent` false, **including MR 1563**. The 40,586.33
letter shown above was generated on screen but never issued. Nothing to withdraw and
nothing to reissue; the ~22,300 overstatement never left the building.

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


### F10. Unresolvable charge printed as 0.00; saved master shadowed the defaults

Two defects, cause and symptom, found on the printed invoice **BILL/85558**: AMSBT-1
(Amorphous) and MWSBT-1 (Wound Core) each showed **Est. Amount 0.00** while MSBT-9
(CRGO) correctly showed 520.00. The invoice totalled Rs 613.60 and went to the
Executive Engineer; the correct total was about Rs 1,600.

**Symptom — the block existed but was not on the document paths.** The named
block-on-missing rule was wired only into `handleConfirmSendBill` (the Firestore
write). `scrapChargeErrors` rendered a red banner in the editor, but `handlePrint` and
`handleExportExcel` were ungated, so the invoice printed a zero line for a charge that
had no rate rather than refusing to generate.
**Fixed:** `blockIfUnresolvedCharges(action)` now gates print, export and send — all
three paths that produce a document — alerting with the per-job, per-code named error.

**Cause — a partial saved master permanently shadowed the defaults.**
`getEstimateMasterForCore` returned the agency's saved array as-is whenever it was
non-empty. A master persisted before an item existed therefore hid that item forever:
no row on the Estimate Master screen to type a rate into, and no way for the code to
resolve at any rate. Amorphous/Wound Core code `"0"` (the Rs 500 scrap charge) was
absent from the saved arrays and so was unresolvable by construction.
**Fixed:** `withMissingDefaults(saved, defaults)` in `estimateData.ts`, applied to all
twelve return paths of `getEstimateMasterForCore`. Purely additive — saved items keep
their position, name, unit and rates; only codes absent from the saved array are
appended. This fixes every core type at once and removes the dependency on someone
having opened the Estimate Master screen and pressed Save.

*Note:* `EstimateMaster.tsx`'s `normalizeAmorphousOrWoundCoreData` was **not** reused
here, despite doing a similar merge. It also rewrites saved names, units and rates, and
its `isLegacyCrgo` / `isOldPlaceholder` heuristics can replace an entire saved array
with defaults. Acceptable on an editing screen; in a pricing path it would silently
swap entered rates for defaults — the same silent-fallback class as F1 and F2.
Importing it into `AgencyContext` would also have been a circular import.

### F11. GP job numbers regenerated by four unguarded paths

A GP repair **reuses the original job number** from the previous repair — it never draws
a new one from the counter, and the number may carry a completely different prefix from
an earlier AT. Two writers already respected that (`addTransformer`,
`duplicateTransformer`, both gated on `repairType === 'OGP'`). Four others did not.

**Reported symptom:** on a GP row, changing the core type overwrote a manually typed
original job number with an auto-generated one. Earlier the same day: clearing the field
to type the original number refilled it with the next sequential number.

**Every path that writes a job number, after the fix.** This table is the verification —
each writer is either out of scope for GP or explicitly permitted:

| Line | Path | Status for GP |
|---|---|---|
| 275 | blank-job-number effect | guarded — early return on GP |
| 334/336 | `handleCommonChange` division branch | guarded — early return on GP |
| 348/350 | `handleCommonChange` repairType branch | guarded (also currently unreachable — no input uses `name="repairType"`) |
| 365 | `handleRepairTypeSelect` → OGP | permitted — an OGP job must draw a number |
| 375 | `handleRepairTypeSelect` → GP | permitted — keeps a genuine prior link only; now **clears** an auto-generated number |
| 404 | `applyPastJobToRow` | **permitted** — suggestion pick / disambiguation chooser |
| 630 | `handleTransformerChange` coreType branch | guarded — `repairType !== 'GP'` |
| 662 | `addTransformer` | already OGP-only |
| 700 | `duplicateTransformer` | already OGP-only |
| 750 | `handleAutoFillEmptyJobNos` | guarded — refuses on GP; button also hidden |

A GP row's job number is now set **only** by: the operator typing it, selecting a
suggestion, or the disambiguation chooser.

**Also fixed — OGP → GP left a fabricated number.** The switch read
`t.prevJobNo || t.autoFilledFrom || t.jobNo || ''`, so a fresh OGP row fell through to
`t.jobNo` and kept its auto-generated sequential number sitting in "Original Job No".
Saving would have booked a GP job against a number matching no prior repair, and the
duplicate guard would then have recorded it as **legacy** with a fabricated original —
the exact provenance confusion `gpSource` exists to prevent. The `|| t.jobNo`
fallthrough is gone. GP → OGP was already correct and is unchanged.

**Confirmed, not changed:** GP does not consume a counter number. `incrementJobNoCounter`
has no call sites (see A2), and the save transaction's counter work is gated on
`repairType !== 'GP'`, so `hasCounterChange` stays false and the master document is not
written on a GP save. No numbers have been burned.

---

## Recurring theme

Every entry above is one of two shapes:

1. **A silent fallback that makes missing data look like real data** — capacity
   defaults, `|| '3'`, `updatedAt` standing in for a dispatch date, a hardcoded 500.
2. **Identity stored in a mutable field** — scrap identity in `status`, transformer
   identity in a job number that is not uniquely allocated.

New code should fail loudly on missing inputs, and should never key identity to a
field that changes as the unit moves through its lifecycle.
