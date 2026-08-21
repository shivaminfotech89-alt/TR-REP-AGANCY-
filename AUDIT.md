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

### The inverse failure: one filter, two concerns sharing a data source

The same shape runs the other way. Excluding a job class from one concern silently
excludes it from **every** concern reading the same variable — including ones the change
was explicitly told not to touch.

**Near-miss, caught by re-reading rather than by a test.** The GP billing exclusion
(F14) was specified with "oil accounting UNCHANGED — oil is consumed regardless of who
pays for the repair." The first pass added `!isGpJob(j)` to `selectedJobsData`, which
looked exactly right. But `jobOilDetails` mapped that same variable, so GP transformers
vanished from the oil account sheet too — the one thing the instruction had ruled out.
Nothing failed; the sheet simply had fewer rows and smaller totals.

Fixed by splitting the source: `selectedJobsWithGp` for oil, `selectedJobsData` for
money, each commented with which concern it serves and the oil memo carrying an explicit
"do not switch this to selectedJobsData".

**Working rule.** Before narrowing a shared variable, list every consumer of it and
decide the answer for each. A variable read by more than one concern is not a filter
point — it is a data source, and narrowing it changes every reader at once. If two
concerns need different subsets, they need different variables, named for the concern
rather than for the filter.

**Note what did not catch this**: not the type checker, not lint, not the reviewer who
wrote the constraint into the instruction. Only re-reading the consumers. That is the
argument for the enumeration habit above being a written step rather than a mental one.

---

## Pattern: a sweep defined by "every call to X" cannot find where X was never called

F16 replaced every date-formatting call site in the app and verified the result:
`toLocaleDateString` count zero, local `formatDate` definitions zero. The sweep was
complete against its own definition — and the printed oil account sheet still showed
`2026-08-11`.

**The search shape determined the blind spot.** Searching for *calls to a formatter*
finds only places that already call one. It cannot, by construction, find a raw ISO
string rendered straight into JSX — the exact defect being fixed. F18 found **20 such
sites**, 8 of them on documents that go to UGVCL.

**Working rule.** When centralising a rule, search for the *inputs the rule should
apply to*, not for existing calls to it. Ask "what values of this kind exist?" before
"where is the function called?". For dates that meant grepping for identifiers matching
`/date/i` rendered inside JSX and template literals, then classifying each as formatted
or raw — a much noisier search that finds the cases the clean one cannot.

**And verify against the symptom, not the metric.** "Zero `toLocaleDateString` calls
remain" was true and reassuring and did not mean dates were formatted. A completion
check that measures the *fix* rather than the *outcome* will confirm work that is not
done.

This generalises well past dates. Several fixes this session were signed off on
`npm run lint` passing or a grep returning empty — **neither of which observes any
behaviour**. A type checker confirms the code compiles; a grep confirms a string is
absent. Both are necessary and neither is evidence that the screen shows the right
thing. The distinction:

| Confirms the fix | Confirms the outcome |
|---|---|
| `tsc --noEmit` passes | the printed sheet shows `11-08-2026` |
| grep for the old pattern is empty | the MR list opens with the newest MR on top |
| the guard exists in the code | saving with a bad value is actually refused |

**The check that caught F18 was opening the oil account sheet and reading the date.** It
took the user two seconds and no tooling, and it found what a complete, verified,
type-checked sweep had missed entirely.

So: where a change has a visible effect, look at it. Where it does not — a data
migration, a comparator's tie-breaking, an exclusion rule — that absence is itself the
argument for a read-only script that reports what the data now says, which is why this
audit has as many scripts as entries. Lint is a floor, not a finish line.

---

## Terminology hazard: "Type" means four different things

A column headed **Type** appears on five screens and means something different on
almost every one. This matters when reading an old screenshot, or when an operator says
"the Type column" in a bug report — neither is unambiguous.

| Where | "Type" column shows | Field |
|---|---|---|
| Estimate forwarding letter (`EstimateGenerate`) | **core type** — CRGO / Amorphous / Wound Core / OH | `coreType` |
| Printed testing report (`TestingReport`) | **repair type** — GP / OGP | `repairType` |
| Delivery challan tables (`DispatchChallan`) | **condition** — Repairable / Scrap | `status` / `condition` |
| Oil statement (`BillingSystem`) | **transaction type** — not a job attribute at all | oil transaction |
| Inspection screens | core type — but correctly labelled **"Type / Core"** | `coreType` |

**Partly resolved.** The DispatchChallan tables were renamed **"Condition"** when the
Core Type and GP/OGP columns were added — the name now matches the underlying field and
the vocabulary used in `InternalInspection` (`condition: 'Repairable' | 'Scrap'`) and
throughout this audit. The inspection screens were already explicit with "Type / Core".

**DELIBERATELY DEFERRED — not an outstanding tidy-up.** The estimate letter and the
printed testing report both say plain "Type" for two different things, and both keep
that heading.

These documents are already with UGVCL in their current form. Changing a printed column
heading mid-tender creates a discrepancy between what the division holds on file and
what it receives next — a reviewer comparing two estimates from the same agency would
see the schedule apparently change shape between them. That cost is real and immediate;
the ambiguity is a readability cost borne internally by people who can be told. Renaming
is a decision for a tender boundary, not a code cleanup, and should be taken with the
division rather than unilaterally.

Record this as settled. Anyone finding the inconsistent headings later should not
"fix" them without that conversation.

#### Why the date-format change went the other way — a deliberate divergence

The printed testing report's date separator **was** changed (`dd.mm.yyyy` → `dd-mm-yyyy`,
F16), even though it too is a document already issued to UGVCL. That is not
inconsistent with the deferral above; the two cases differ in kind:

- **A column heading is a label**, read once to understand what the column contains. A
  reviewer who sees "Type" on one estimate and "Core Type" on the next learns nothing
  false — they simply read the new label. The cost of changing it is a visible
  discrepancy between documents on file; the benefit is small.
- **A date separator is part of a value.** One document in an envelope using `.` while
  every other uses `-` invites a reader to wonder whether the difference *means*
  something — whether it denotes a different kind of date, or a different source. An
  unexplained formatting difference inside a set of documents submitted together is
  worse than a difference from previously issued copies of one of them.

**The general rule:** consistency across documents in the same envelope outranks
consistency with earlier copies of a single document. Labels can differ between
submissions; values should not differ between documents in one submission.

**Related inconsistency, not yet fixed.** The fallback when `repairType` is unset differs
by file: `TestingReport` prints `{job.repairType || 'GP'}` while `EstimateGenerate` and
`SingleJobEstimateReport` print `|| 'OGP'`. A job with no `repairType` therefore appears
as **GP on the testing report and OGP on the estimate**. Given GP now determines whether
a job is billable at all (F14), a default that varies by document is worth settling —
`OGP` is the safer default, since it fails toward "chargeable, review it" rather than
silently marking a job free of cost.

**Is it reachable?** Section 8 of `scripts/blast-radius-console.js` counts jobs with
`repairType` unset, null or empty. For each it also gathers the evidence for what the
job really is — the companion `isGp` boolean, GP provenance (`prevJobNo`,
`prevDeliveryDate`, `gpSource`, which only a GP intake sets), and the `repairType` of
its MR siblings, since an MR is issued for one type. Reported as `likelyType`, explicitly
labelled evidence rather than a determination: the field decides billability, so a human
confirms it against the MR paperwork before anything is written.

**MEASURED: 0 jobs have `repairType` unset.** The divergence was never reachable in this
data — no job has ever displayed as GP on one document and OGP on another.

**Fixed anyway, DEFENSIVELY not correctively.** `TestingReport`'s two `|| 'GP'`
fallbacks are now `|| 'OGP'`, matching `EstimateGenerate` and `SingleJobEstimateReport`.
Nothing displayed differently before or after; the change removes a trap rather than
repairing damage. The printed-report site carries a comment saying so, so it is not
later "corrected" back on the assumption that GP was the intended default.

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

### O5. `paymentDeductions` accepts the full payment as a "deduction" — unvalidated

**Not the same class as O3/O4.** Those are code computing a stored figure wrongly. This
field is **not** defaulted from `paidAmount` or from any computed source: it initialises
to `'0'` (`handleOpenPaidModal`), is typed by hand into an input labelled "TDS /
Deduction Amount (₹)", and is written as `Number(paymentDeductions) || 0`. The value is
operator-entered.

**But it is accepted without any check**, and MSBT-12 shows why that matters:
`paidAmount` **6,680**, `billTotalMrAmount` **6,680**, `paymentDeductions` **6,680** —
all three identical. A deduction is a portion *withheld* from a payment; it cannot equal
the whole payment. Taken literally the net realised is **zero**, which contradicts the
bank credit against `UTR/2026/1` that we know was received. So the deduction figure is
wrong data, not a wrong calculation.

**How it likely happened:** "Amount Received" arrives pre-filled with the MR grand total
(6,680) while "TDS / Deduction" sits directly beneath it, empty, styled identically. The
same figure entered twice is an easy slip, and nothing pushes back.

**Consequences beyond the one record:**
- Payment reporting is understated. `totalDeductions` sums the field across paid bills
  and the Excel export writes it as "TDS / Deductions (INR)", so a full-amount deduction
  reports the collection as entirely withheld.
- The Payments list shows "TDS/Ded: ₹6,680" beside a ₹6,680 receipt, which reads as a
  reconciled zero.

**Does it change the C3 refund?** No. The refund is **6,680**, the amount actually
received per the bank credit. If the deduction were genuine, nothing would have been
received and there would be nothing to refund — which is itself proof the field is wrong.

**Fixed — two checks in `handleConfirmPaid`, deliberately of different strengths:**

1. **BLOCK** when `deductions >= paidAmount` (or either is negative). Names both figures
   in the message and states that a deduction is the portion withheld, not the payment
   itself. This is impossible data, so it is refused outright.
2. **WARN, do not block**, when the deduction is an implausible *share* of the gross.
   The blocking rule only catches the impossible case; a figure that is merely **wrong**
   — 6,680 where 2% TDS on 6,680 is ~134 — is individually "valid" and would pass. The
   warning computes the implied rate against `paidAmount + deductions`, and if it is not
   within 0.15pp of a usual TDS rate (1/2/5/10%) and exceeds 12%, it shows what each
   usual rate *would* be and asks for confirmation. Suggesting the likely intent is more
   useful than only refusing the impossible one, and the operator can still proceed —
   an unusual deduction is not necessarily an error.

**⚠️ MSBT-12's stored value is wrong data and still needs correcting — REPORT ONLY, not
changed.** The guard prevents recurrence; it does not repair the existing record.

**What the correct value should be — cannot be determined from the system.** The three
possibilities, in order of likelihood:

- **`0`** — nothing was withheld, and the figure was the payment amount typed twice into
  the adjacent field. Most likely, given all three stored figures are identical.
- **A genuine TDS amount** — at the usual rates on a 6,680 gross that is ~67 (1%),
  ~134 (2%), ~334 (5%) or ~668 (10%).
- Something else entirely, if the division applied a specific retention.

**Only the bank credit against `UTR/2026/1` settles it.** If the credit was 6,680 the
deduction was 0; if it was less, the difference is the true deduction and `paidAmount`
is also wrong. Check the payment advice before changing anything — and note this
interacts with the C3 refund figure: if the credit turns out to be less than 6,680, the
refund is the credited amount, not 6,680.

### O6. A missing oil-transaction date printed the bill date instead — FIXED

`BillingSystem.tsx:2935`, in the printed oil statement:

```
{tx.date ? new Date(tx.date).toLocaleDateString() : billDate}
```

A transaction with no date rendered **the bill's own date** — a value with no
relationship to the transaction, on a financial document, indistinguishable from a real
one. A reader has no way to tell a genuine same-day transaction from a fabricated
substitute.

**Same class as the capacity defaults (F1/F2) and the `updatedAt` dispatch date (F6):
missing data made to look like real data.** The pattern is that the fallback is
*plausible*, which is exactly what makes it dangerous — an obviously wrong value would
have been caught.

**Fixed** as part of the date centralisation: the cell now renders `formatDDMMYYYY(tx.date)`,
which returns `-`. Kept as an OPEN entry rather than moved to FIXED because **the
historical exposure has not been measured** — any oil statement already printed while a
transaction lacked a date carries the bill date in its place, and nothing in the document
marks it. If oil statements have been issued, that is worth checking before they are
relied on for reconciliation.

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

**MEASURED.** `scripts/blast-radius-console.js` sections 1-3. Latest full run, **36 jobs**
in the agency (up from 32 at first measurement as intake continued):

- **29 of 36 jobs mispriced — every one overstated.** Capacity defaults are higher than
  the measured quantities in every observed case. Worst seen: MSBT-6 at **21,028
  submitted vs 8,612 correct**.
- **20 jobs flipped circle-limit verdict, all but one EXCEEDS → within.** Transformers were
  being flagged as needing Superintending Engineer approval purely because the estimate
  was built from capacity defaults. Those escalations were unnecessary.
- **1 estimate actually submitted** — MSBT-12 (MR 1), and it flips the *other* way,
  within → EXCEEDS. See **C2**: it routed the approval to the wrong authority and needs
  reissuing.

The unsubmitted jobs need no external remedy — they simply reprice correctly now. The
proportion is stable as the dataset grows (26/32 then 29/36, ~81% either way), which is
consistent with the cause being structural rather than particular to a few records.

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

**⚠️ F12 DEPENDS ON THIS ENTRY.** The GP suggestion filter excludes scrap candidates via
`condition === 'Scrap'`, which exists on job documents only because of the fix and
backfill below. Reverting this, or adding a job-creation path that does not set
`condition`, silently degrades that filter to a no-op. See F12.

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
- **Stage-order gating enforced** — Received → External → Internal → Testing →
  Dispatched. Internal inspection cannot be skipped: the Inspect/Edit button is
  disabled until External is complete, and the save paths in `InternalInspection` and
  `TestingReport` guard the write as well as the UI. The Scrap rule was corrected at the
  same time (Scrap no longer auto-counts as externally done).

  **⚠️ NOW LOAD-BEARING OUTSIDE INSPECTION.** F12 relies on this: it assumes any
  dispatched job has passed through the path that sets `condition`. Relaxing the
  ordering — allowing dispatch without internal inspection, for any reason — lets jobs
  reach the GP suggestion list with `condition` unset, where they read as non-scrap by
  default. See F12.


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

### F12. GP suggestions listed undelivered and scrapped transformers

`suggestGpJobs` filtered only on the job-number substring, so every job in the
agency-scoped `pastJobs` was offered as a GP candidate regardless of its state. A unit
still in repair, testing or awaiting dispatch has not been delivered and cannot return
under guarantee; a scrapped unit was returned to the division rather than repaired, so
there is no repair to guarantee. Linking to either applies the wrong transformer's make,
serial, kVA and `prevDeliveryDate` to a warranty row — see O1 for why
`prevDeliveryDate` in particular matters.

**Fixed:** two filters ahead of the existing substring match — `status === 'Dispatched'`
and not scrap. Ordering, field set, the limit of 8 and the matching rule are unchanged.

**⚠️ DEPENDENCY — F12, F5 and the stage-order gating (F9) are only correct in
combination. Do not treat any of the three as independently removable.**

`status === 'Dispatched'` does **not** exclude scrap on its own. A scrapped transformer
*is* dispatched — that is how it returns to the division — so it carries
`status: 'Dispatched'` and survives the status filter. It is identifiable **only** by
`condition === 'Scrap'`.

And `condition` was never written to any job document until F5 (see F5: scrap identity
lived solely in `status`, which dispatch overwrote). **Before F5's backfill, this filter
would have silently excluded nothing** — every scrap job would have read as an ordinary
delivered repair and been offered as a GP candidate.

Concretely: the six jobs F5 restored — AMKLL-9, KLL-6 (MR 1563), AMSBT-1, MSBT-9,
MWSBT-1 (MR 85558), MSBT-5 (MR 12) — are all `status: 'Dispatched'` with a challan.
Every one would appear in the GP suggestion list under a status-only filter.

Consequences to preserve:
- Removing the `condition === 'Scrap'` test because "the status test already covers
  it" reinstates the bug. It does not cover it.
- Reverting F5, or any future path that writes a job without setting `condition`,
  silently degrades this filter back to no-op for those jobs.
- Any new job created outside `InternalInspection`'s save path will lack `condition`
  and be treated here as non-scrap by default.
- **Relaxing the stage-order gating (F9) breaks this filter.** What guarantees a
  dispatched job has a `condition` at all is that internal inspection cannot be
  skipped — that is the only path that sets it. `NewJob` deliberately creates jobs
  without `condition`, since the scrap decision has not been made at intake. So the
  filter's correctness rests on stage ordering, not on anything visible in
  `suggestGpJobs` itself. Allow dispatch without internal inspection and those jobs
  arrive here indistinguishable from repaired ones.

### F13. Every printed estimate asserted "OGP" regardless of the job's real type

The TYPE column in both of `EstimateGenerate.tsx`'s job-row tables — the forwarding
letter and the matrix view — was a literal `<td className="...">OGP</td>`. Not a
fallback, not a defaulted read: a hardcoded string at two sites. Nothing on that column
ever consulted `repairType`.

**Fixed:** both now render `{job.repairType || 'OGP'}`, matching what
`SingleJobEstimateReport` already did at its own two sites.

**Why this matters beyond the wrong label — it is why MSBT-12 went unnoticed.** MSBT-12
(MR 1) was a GP job estimated, billed and paid for guarantee work (C3). The one document
that would have shown a reviewer it was a guarantee repair — the estimate sent to UGVCL
— stated the opposite. The paperwork actively asserted the wrong thing rather than
merely omitting it, so no amount of care in reading it would have caught the error.

**⚠️ EVIDENTIARY CONSEQUENCE — printed estimates cannot be used to determine repair
type.** Every estimate produced before this fix shows "OGP" in the TYPE column whether
the job was OGP or GP. When reconstructing whether a historical job was a guarantee
repair, the printed estimate is not evidence: use `repairType` / `isGp` on the job
document. This applies to any estimate already issued to or held by UGVCL.

### F14. GP jobs were estimated and billed like ordinary repairs

A GP repair within the guarantee period is **free of cost** — the agency redoes the work
at its own expense. Nothing in `EstimateGenerate.tsx`, `BillingSystem.tsx` or
`estimateCalc.ts` filtered on `repairType`: the word did not appear in those files at
all except as a display label. A GP job was therefore fully itemised, included in the
forwarding letter and its TOTAL, billed, taxed and totalled.

**Realised:** MSBT-12 (MR 1) — estimated, billed `BILL/1`, and **paid Rs 6,680** for
guarantee work. See C3 for the refund, and F13 for why the paperwork concealed it.

**Fixed:** one shared `isGpJob(job)` in `lib/estimateCalc.ts`, keyed on
`repairType === 'GP' || isGp === true` — deliberately **not** on `gpSource`, which
postdates the existing GP population and would have left every pre-existing GP job
billable. Applied at:

- **Estimate** — `selectedJobsData` (no estimate sheet, no letter line), plus a new
  `estimableJobs(mr)` behind `calculateMrEstimateTotal` and `mrHasExceededCircleLimit`,
  so GP is out of the TOTAL and the circle-limit check as well as the table.
- **Billing** — `selectedJobsData`, `jobsForBillType`, `selectedMrPendingCount`,
  `handleGenerateClick`, `filteredMrNos`'s `hasMatchingType`, and `handleSelectMr`'s
  auto-select counts. An MR of only GP jobs no longer appears in the generator at all.

**Would it have stopped MSBT-12? Yes, at three independent points:** no estimate could
be produced or totalled; MR 1 would not have appeared in the Bill Generator, so `BILL/1`
could not have been raised; and `handleRecordPayment` writes to `jobsForBillType(mr)`,
which would have been empty, so the payment stamp had nothing to write to. The failure
would also have been *visible* — the MR row reading "3 of 3 jobs are GP - not billable"
rather than silently skipping.

**Oil accounting deliberately unaffected** — see the near-miss recorded under the second
pattern note. GP transformers still appear on the oil sheet with capacity, received and
shortage.

### F15. Switching GP → OGP carried GP provenance onto the OGP job

`handleRepairTypeSelect` changed only `repairType` and the job numbers. Everything else
survived the switch in both directions — and switching **GP → OGP** carried the entire
GP provenance set onto jobs that are not guarantee repairs:

`gpSource` (as `'linked'`), `gpPriorJobId`, `prevJobNo`, `prevAtNo`, `prevDeliveryDate`,
`autoFilledFrom`.

**Exposure — false provenance.** An ordinary OGP repair could be saved looking like a
guarantee job: linked to a prior repair it has no relationship to, with a delivery date
the guarantee window would be measured from. `gpSource: 'linked'` exists precisely to
record *"this was matched against system data"*, so a wrong value there is worse than a
missing one — it asserts a verification that never happened. Anything reading provenance
later (a disputed claim, a reconciliation) would be misled.

Also carried, and wrong for a different reason: **`mrNo`**. The division issues separate
MR numbers for GP and OGP work — they are different documents — so jobs could be saved
against an MR never issued for them. Plus `dateOfIssue`, `division`, `make`, `serialNo`,
`capacityKva`, `coreType`, `starRating` and `gpReason`.

**Fixed:** switching repair type in either direction now resets the entire intake —
`commonData` replaced wholesale and `transformers` reduced to one blank row via
`blankTransformerRow()`, which sets every provenance field explicitly rather than
leaving it undefined by omission. Stale UI state (suggestion list, disambiguation
chooser, past-job picker, notices) is cleared too. A confirmation appears first if
anything has been entered.

The confirmation's dirty-check deliberately ignores `jobNo` for OGP, since it is
auto-generated rather than typed — counting it would fire the dialog on every switch,
and a dialog that always appears is one operators learn to dismiss unread.

**MEASURED: 0 affected jobs.** Section 7 of `scripts/blast-radius-console.js` reports no
OGP job carrying any GP provenance field. **The leak was closed before it produced bad
data** — confirmed non-issue, no remediation needed.

The check is worth keeping in the script: any future path that writes a job without
clearing provenance would show up there.

**Original action, now discharged.** Any OGP job saved through
this path would have retained the fields above. An OGP job with `gpSource`, `prevJobNo` or
`prevDeliveryDate` set did not acquire them legitimately: on an OGP intake there is no
path that sets them except this leak. Section 7 of `scripts/blast-radius-console.js`
lists them. The fields should be cleared on any job found, but **check first whether the
job was mis-typed rather than mis-provenanced** — a genuine GP job saved as OGP is a
different problem from an OGP job with stray fields, and only someone who knows the
transformer can tell them apart.

### F16. Four date formatters, three of them wrong — one locale-dependent

Date display was implemented four separate ways across ~90 call sites:

| Implementation | Sites | Produced |
|---|---|---|
| `formatDDMMYYYY` (`lib/utils.ts`) | ~75 | `dd-mm-yyyy` — correct |
| `formatDate` local to `TestingReport` | 1 | `dd.mm.yyyy` — **dot separated** |
| bare `toLocaleDateString()` | 12 | **whatever the browser locale says** |
| `toLocaleDateString('en-GB')` | 2 | `dd/mm/yyyy` — slashes |

**The bare `toLocaleDateString()` sites are the serious ones.** With no locale argument
the output follows the operator's machine: `03/08/2026` on an `en-IN` browser,
`08/03/2026` on `en-US` — the same stored value, rendered as two different dates, with
nothing on screen indicating which reading applies. Affected sites included **licence
expiry** (AdminPanel) and **AT validity period** (AtSettings), where reading the month as
the day is materially wrong.

Missing-value behaviour diverged too: `-` (shared), `''` (TestingReport — an empty cell
reading as "no data"), `Invalid Date`, or a throw on null.

**This is the "rule applied once" pattern**: one rule, four implementations, three
already drifted before anyone looked.

**Fixed:** every site now calls `formatDDMMYYYY`. Local implementations deleted; zero
`toLocaleDateString` calls remain anywhere. Storage is untouched — Firestore keeps ISO
`yyyy-mm-dd`, which sorts correctly as a string — and `<input type="date">` fields
(25 of them) were never involved, since they bind raw ISO state and never passed through
a formatter.

**Also tightened:** `formatDDMMYYYY` previously returned the raw input unchanged when the
value could not be parsed, to avoid printing "Invalid Date". Tracing showed that branch
is reachable *only* for genuine garbage — `dd-mm-yyyy` and `yyyy-mm-dd` are caught by
regex, and anything `Date` can parse (including readable forms like `15 Aug 2026`)
succeeds — so the raw return could only ever surface unusable data looking like a date.
It now returns `-`, giving the function one contract: **a value that cannot be rendered
as a date renders as `-`**.

### F17. Four comparators that looked correct and scattered undated rows

Four "newest first" sorts shared this shape — Sent Bills and Paid Bills
(`BillingSystem`), Sent Estimates and Approvals (`EstimateGenerate`):

```js
if (a.billSentDate && b.billSentDate) {
  return b.billSentDate.localeCompare(a.billSentDate);   // correct, when both have one
}
return b.mrNo.localeCompare(a.mrNo, undefined, { numeric: true });   // whenever EITHER is missing
```

The guard requires **both** dates. When only one side has one, it falls through and the
pair is compared by **MR number** — an unrelated key. So an undated row does not sink to
the bottom; it lands wherever its MR number happens to place it, **scattered through a
list the operator is reading as chronological**. An operator scanning for the most recent
bill can have an undated row sitting above it.

Worse, the comparator is **not transitive**: a dated row and an undated row compare by MR
number while two dated rows compare by date, so the resulting order can depend on the
input sequence. Two renders of the same data can differ.

**This is the pattern-note shape again** — the code agrees with itself in the case
someone tested (both dates present) and disagrees wherever the data is incomplete. It is
not a cosmetic sorting bug.

**Fixed:** one shared `byDateDesc(getDate, tieBreak?)` in `lib/utils.ts`. Undated rows
sink **by construction, in either direction** — the missing-key comparison happens before
the direction is applied, so flipping to ascending cannot float them to the top. The
per-screen tiebreak is preserved via the optional second argument. Its doc comment
carries the broken shape above as the worked example.

**Applied to, and other sorting fixed in the same pass:**

- The four comparators above.
- **MR list screens now sort by MR date descending**, MR number descending as tiebreak —
  Billing, Estimate, Testing, and both inspection screens. They previously sorted by MR
  number **ascending**, so the oldest MR appeared first. Sorting by number would not have
  fixed it: **MR numbers are not chronological** in this data — MR 9344 predates MR 1563,
  and MR 1 sits among five-digit numbers — so number-descending would present an order
  that is not newest-first at all. Number is the tiebreak only.
- **DispatchChallan's Dispatched table** sorted by job number while its Pending table
  sorted by test date; now `deliveryDate || challanDate` descending, job number as
  tiebreak.
- **Reports' Excel export** sorted **oldest first**; now newest first, undated last.
- **`MrLedger`** used `new Date(x || 0)`, making a missing date epoch 1970 — which sorts
  last only *by accident*, and would sort **first** if the direction were ever flipped.
  Replaced with `byDateDesc`: correct by construction rather than by coincidence.
- **In-place sorts converted to copies — but only where the array's origin is not
  visible from the sort site.** Converted: the `useMemo` returns in `BillingSystem` (×2),
  `EstimateGenerate` (×2) and `MrLedger`. There the safety depends on the memo returning
  a fresh array, which the sort site cannot see; change the memo later and the counts
  above the table corrupt silently.

  **Deliberately NOT converted, and this is not an oversight:** four sorts operating on
  an array created on the immediately adjacent line — `AdminPanel:77`,
  `SupportTickets:40`, `OilInward:189`, `NewJob:304`, all of the form
  `const list = snap.docs.map(...); list.sort(...)`. The hazard being guarded against is
  **invisibility of origin**, not mutation as such. Where the origin is one line above,
  a defensive copy adds noise and — worse — dilutes the signal in the three places where
  the copy is load-bearing. If every sort is copied, the copy stops meaning anything.

  Do not "complete" this conversion. The inconsistency is the point: a `[...list]` in
  this codebase means *"the origin of this array is not local, do not assume it is
  disposable."*

**Left deliberately:** within-MR job lists still sort by job number. Every job in an MR
shares its MR date, so date order there would be arbitrary; job number is the meaningful
sequence. DispatchChallan's Pending list and its user-facing sort toggle are unchanged.

### F18. Twenty dates rendered as raw ISO, never having called a formatter

Reported symptom: the printed oil account sheet showed `MR NO: 85558 | Date: 2026-08-18`
and `Insp. Date: 2026-08-18` — ISO, not `dd-mm-yyyy`, **after** F16 had centralised every
formatter call site and verified zero remained. See the pattern note above for why the
sweep could not have found these.

**20 sites across 6 files**, of which **8 are on documents that reach UGVCL**:

| File | Printed | On-screen / Excel |
|---|---|---|
| `BillingSystem` | oil-sheet MR date + insp. date, invoice Bill Date + Order Date, settlement line, forwarding-letter body, oil "Up to" heading | MR-row "Sent:", 2 Excel headers |
| `SingleJobEstimateReport` | `Dt.:` order date on both layouts | — |
| `InternalInspection` | `INT. INSP DATE` on the printed report | — |
| `OilInward` | — | MR date column, summary MR date, "up to" caption, 3 export/subtotal headers |
| `EstimateGenerate` | — | Dispatched date, Approval date |
| `AtAllotments` | — | allotment record date, confirmation date |

`Reports.tsx` was **clean** — every `cycle.*` date is formatted at construction. An
initial reading of mine listed `cycle.paymentDate` as raw; it does not exist, the field
is `paymentReceivedDate` and is already formatted. Corrected before any change was made.

**Excel headers were included deliberately.** An exported spreadsheet is read outside the
app, and `Bill Date: 2026-08-11` carries the same ambiguity — worse, Excel may reinterpret
an ISO string as a date and re-render it in the opening machine's locale. The *filename*
(`Oil_Ledger_..._Upto_2026-08-11.xlsx`) is deliberately left ISO: filenames sort usefully
that way and are not read as a document.

**Root cause — the same helper, three times.** `getMrDate` was duplicated
character-for-character between `OilInward` and `BillingSystem`, with a **third**
near-copy (`selectedMrDate`) sharing the fallback chain but differing in one respect:

**it fell back to the BILL DATE instead of `'-'`.** So an MR with no recorded date
printed the date its bill happened to be raised, on the oil statement, indistinguishable
from a real MR date — the same fabricated-value shape as O6, one level up.

**Fixed:** one `getMrDateIso(mrNo, jobs, transactions)` in `lib/utils.ts`, returning raw
ISO or `'-'`. All three copies replaced. It **returns ISO on purpose** — it feeds
comparisons, filters and form state as well as display, so formatting happens at the
render site only, and `formatDDMMYYYY` passes `'-'` through unchanged.

**Two downstream consumers needed guarding** once `selectedMrDate` could be `'-'`:
- `effectiveOilUptoDate` read `selectedMrDate || billDate` — and `'-'` is **truthy**, so
  it would have returned the dash. Now an explicit `!== '-'` check. Its `billDate`
  fallback is kept: that value is a *filter bound* for the oil balance, not a claim about
  the MR.
- `mrOilTxList` matched undated transactions by `tDateStr === selectedMrDate`, which
  would have matched against the `'-'` sentinel. Guarded.

---

## Recurring theme

Every entry above is one of two shapes:

1. **A silent fallback that makes missing data look like real data** — capacity
   defaults, `|| '3'`, `updatedAt` standing in for a dispatch date, a hardcoded 500.
2. **Identity stored in a mutable field** — scrap identity in `status`, transformer
   identity in a job number that is not uniquely allocated.

New code should fail loudly on missing inputs, and should never key identity to a
field that changes as the unit moves through its lifecycle.

**Several of today's fixes are only correct in combination, and the couplings are not
visible from any one call site.** F12's scrap exclusion works only because F5 restored
`condition` to job documents, and only because the stage-order gating (F9) guarantees
every dispatched job passed through the one path that sets it. Reading `suggestGpJobs`
alone shows none of that — the filter looks self-contained and each half looks
individually redundant.

This is the failure mode to watch for during cleanup: a check that appears superfluous
in isolation is often the visible half of an invariant maintained somewhere else.
Before removing one, find what establishes the data it depends on. Where a coupling
exists, note it **on both sides** — a one-way note is only found by whoever happens to
read the right entry, which is never the person about to break it.
