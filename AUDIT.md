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

### The scope-specific guard: "is anything stored" where it means "is this the one"

**Three instances in this codebase, two of them character-identical in different
collections.** That repetition is the point: it is evidence the shape is *easy to write*,
not that someone was careless twice.

```js
if (!activeAgencyId) setActiveAgencyId(newRef.id);      // addAgency  - F22
if (!activeAtMasterId) setActiveAtMasterId(newRef.id);  // addAtMaster - F20
```

Both read "activate this if nothing is active". Both mean **"activate this if nothing is
active for the scope being worked on"**. A truthy value from a *different* scope
satisfies the check and the activation is skipped — so the thing just created is not
selected, and in `addAgency`'s case the *next* thing created is attached to the wrong
parent.

The failure is quiet in a particular way: the write succeeds, the data is correct against
the wrong parent, and it is read back fine — it simply never appears where the operator
is looking. F22 presented as "AT details disappear after a page refresh", which is three
inferences away from the actual cause.

**The test, applicable by inspection: does the guard read a RAW ID or a DERIVED,
SCOPE-CHECKED OBJECT?**

```js
activeAgencyId, activeAtMasterId     // raw ids - carry NO scope
activeAgency, activeAtMaster         // derived, scope-checked:
                                     //   atMasters.find(a => a.id === activeAtMasterId
                                     //                   && a.agencyId === activeAgencyId)
```

A raw id is just a string. It cannot tell you whether it belongs to the scope you are
working in, so **a guard on a raw id is asking a weaker question than it appears to** —
it tests presence where the author meant relevance. A derived object has already had the
scope check applied in its derivation, so a guard on one is safe by construction.

Both bugs found were guards on raw ids. All three sound guards were on derived objects.
That correspondence is exact, and it turns "audit every guard" into something checkable
by reading a single identifier: **if the guard names an `…Id`, look twice.**

**Working rule.** A guard on a "current X" must name the scope it is comparing within.
`if (!activeAgencyId)` asks about storage; `if (!agencyAts.some(...))` asks about the
agency. When the answer differs between those two questions, the second is almost always
the one intended.

**Audited across the context, the remaining guards are sound** — recorded so the audit is
not repeated:

| Site | Guard | Verdict |
|---|---|---|
| `setActiveAtMasterId` | `if (!activeAgencyId) return` | correct — genuinely asks "is there an agency to key storage against" |
| `addAtMaster` | `if (!activeForThisAgency)` | fixed in F20; scope-explicit |
| `getNextJobNoInfo` | `if (!activeAgency)` | correct — needs the object, not an id |
| `incrementJobNoCounter` | `if (activeAtMaster) … else if (activeAgency)` | correct — both are agency-scoped derivations, not raw ids |

Each verdict follows directly from the raw-id/derived-object test above.

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

**A uniqueness guard is only unique within its query's scope.** `copy-master-sections.js`
refused to act on an ambiguous agency name — and still resolved the wrong document, because
it checked for duplicates within the **owner-scoped** list its query returned. Two agencies
named "suchit" exist under two different accounts. The guard was not weak; its *scope* was
the query rather than the domain, and nothing in the code said so. See **F36**.

The generalisation is worth keeping separate from the "one call site" pattern: this rule WAS
applied at its only call site, and was still wrong. **Ask what population a guard is
comparing against, not just whether it fires.** A check for "is this unique" answers "unique
among what I can see", which is a different question whenever the query is filtered — and
every query in this codebase is filtered by `ownerId`.

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

**A check made for one instance of a change must be carried BACK to the instances made
before it.** The `serverTimestamp()` work happened in two passes. The second (F38, agencies
and ATs) checked `firestore.rules` first and recorded "checked, not assumed" — those
validators do not name `createdAt`, so a Timestamp passes. The first (F23, inspections) was
made earlier and never revisited. `isValidInspection` DOES name it, and requires a number or
a string, so every new inspection was denied for hours (F45).

**The verification existed. It simply was not applied backwards.** That is a distinct
failure from not thinking of the check: the thinking had been done, written down, and
attached to the wrong half of the work. When a later instance of a change turns up a
precondition, **go back and re-run it against every earlier instance** — the earlier ones are
exactly the code that was written before anyone knew to look.

**A field-name sweep returns non-dates, and that is not a defect to fix.** Running the
sweep again later (F41) surfaced `approvalDate` — a date-named field that can hold
`AT 26-27`, because the Bill Date and Appr Date controls on the billing screen are
`type="text"`, not `type="date"`, so an operator can type anything into them. Since F16 a
non-date renders as `-` rather than as garbage, which is the correct outcome. **A date-named
field carrying an identifier is the reverse of the usual problem** and the next person
sweeping will hit it too: do not "fix" it by coercing the value, and do not assume a field
called `*Date` holds one.

The same sweep flags `<input type="date">` values, `.xlsx` filenames and
`new Date().getFullYear()`. A date input REQUIRES `yyyy-mm-dd` and the browser renders it in
the user's locale, so formatting one breaks the control. **The noise is the price of
searching by field rather than by symptom, and it is worth paying** — F41 found two raw
renders that the reported symptom did not name.

**The check that caught F18 was opening the oil account sheet and reading the date.** It
took the user two seconds and no tooling, and it found what a complete, verified,
type-checked sweep had missed entirely.

So: where a change has a visible effect, look at it. Where it does not — a data
migration, a comparator's tie-breaking, an exclusion rule — that absence is itself the
argument for a read-only script that reports what the data now says, which is why this
audit has as many scripts as entries. Lint is a floor, not a finish line.

---

## Pattern: a sound sweep whose evidence was clipped before the judgement

The three notes above are all failures of METHOD - a value standing in for missing data, a
rule applied at one site and not the others, a search shaped so it cannot see the thing it
is looking for. This one is different, and worse for being harder to notice: **the method
was correct, the search reached the site, and the answer was still wrong.**

**What happened (F41).** A sweep for raw ISO dates in printed documents ran two passes and
reported the documents clear. A third report then found `Dated 2026-08-23` on the printed
certificate page - a site in the same file, in a printed document. The field-name pass HAD
surfaced that line. It was printed truncated to 135 characters for readability, and the line
ends twenty characters before the `{billDate}` that made it a hit. The visible fragment read
as a bill-NUMBER sentence, so it was discarded - **and never listed among the rejections**,
so nothing in the report showed that a candidate had been considered and dropped.

Two independent failures, either of which alone would have been survivable:

1. **The evidence was clipped before the judgement.** The search found it; the display lost
   it. No amount of improving the search would have helped, which is why this is not a
   variant of the note above.
2. **The rejection was invisible.** A report listing only what it accepted cannot be
   reviewed for what it wrongly threw away. Someone re-reading it - including the person who
   wrote it - sees a clean result, not a decision.

**Working rules:**

- **Never truncate the output a sweep is judged from.** Print the whole matched line, however
  ugly. The evidence that decides a hit is as likely to sit at column 150 as at column 10,
  and a formatter added for readability is a filter nobody remembers applying.
- **Always list rejected candidates, with the reason.** A rejection that is never printed
  cannot be reviewed. "Found 4, fixed 4" is a weaker claim than "found 31, fixed 4, rejected
  27 for these reasons" - the second can be audited and the first has to be trusted.
- **Report the count the search returned, not only the count that survived triage.** The gap
  between them is where this class of error lives.

**Why it belongs beside the others.** The three method failures produce a wrong answer from a
flawed process, which is at least discoverable by examining the process. This produces a
wrong answer from a sound process, and examining the process finds nothing amiss - the fault
is in a rendering step that feels like presentation rather than reasoning. It is the only one
of the four that would survive a careful review of the method itself.

---

## Note: a page-level max-width can suit forms or tables, never both

**The general finding, reached by trying to answer a width question as a single value and
failing.** Asked to widen Agency Settings, the honest answer turned out not to be a number:
that screen holds single-column forms AND a divisions grid of six prefix inputs plus three
quota columns. Widening the page to fit the grid stretches every text input with it - a
1400px GSTIN field is harder to use than a 672px one, because the eye must travel the full
width to find a fifteen-character value and the label-to-field relationship weakens as the
gap grows. Narrowing it to suit the forms leaves the grid unusable.

**One container cannot serve both, so the question has no single answer** - and reaching for
one produces a compromise width that suits neither. The resolution is structural: split the
page by CONTENT KIND, then width each region for what it holds. Agency Settings now has a
narrow forms region and a wider tables region that breaks out of it.

**This is why four per-screen conventions accumulated** across the app -
`max-w-6xl` / `max-w-[1400px]`, `max-w-7xl`, `w-full max-w-full`, `max-w-2xl` - each one a
reasonable answer to "how wide should THIS screen be" on a screen that holds more than one
kind of content. **Before adding a fifth, ask whether the screen actually wants two widths.**
Where it does, no page-level value is correct and picking one is choosing which half of the
screen to make worse.

The corollary is worth stating too: a screen that is genuinely all forms (a settings dialog)
or genuinely all table (a register) has no such tension, and there a single max-width is the
right tool. The tension is specific to mixed screens, which is most of the substantial ones.

---

## Note: where the "wasted margin" on wide screens actually comes from

Two things create it, and only one was changed.

1. **The screen's own `max-w-*` container.** Estimate Generator and Billing were
   `max-w-6xl` (1152px), now `max-w-[1400px]`. Testing Report uses `max-w-7xl`; Dispatch
   Challan uses `w-full max-w-full`, which is effectively no container. **Three conventions
   exist, not one** - worth knowing before adding a fourth.
2. **The layout's content padding.** `AppLayout.tsx:372` wraps every page in
   `p-2.5 sm:p-4 md:p-6 print:p-0` - **24px per side, 48px total, at `md` and above**. That
   applies to every screen in the app.

**The padding was deliberately NOT changed**, and the reason is proportionality rather than
risk: the request concerned two screens, and this touches all of them - including forms that
read better narrow. Widening a global to satisfy two callers is how a layout stops having
any intent.

**If other screens feel cramped later, look here first.** The instinct will be to add
another per-screen `max-width` override, which grows the set of conventions and leaves the
padding untouched underneath. One change to `:372` would do what several overrides would
approximate.

`print:p-0` is already on that element, so nothing here reaches a printed document.

---

## Pattern: a message whose truth depended on a collection being homogeneous

`buildSingleJobEstimateData` returned `rateErrors: string[]`, and every consumer rendered
ONE message for the whole array. The internal-inspection indicator said **"Rate not
configured - cannot estimate"** whenever it was non-empty.

**That was accurate for every case it ever served** — each entry was a missing RATE: absent
from the agency master and from Schedule-A, fixable in Estimate Master by whoever maintains
rates. The message named the cause correctly because the array only ever held one kind of
cause.

Then a second kind arrived: a measurement the inspector had not entered. The array was still
`string[]`, every consumer still compiled, every test of `.length` still worked — and the
indicator began telling an operator that a **rate** was unconfigured when the rate was fine
and the missing thing was a field on the row in front of them. It sent them to the wrong
screen to fix the wrong thing.

**Nothing was "introduced".** No line changed meaning. The message's truth had always rested
on a property of the collection — homogeneity — that nothing stated, nothing enforced, and
no type expressed. The defect was created by the *absence* of a constraint that had been
holding by accident.

**The tell is a collection whose consumers all reduce it to one summary.** If every reader
says "there are problems, here is what problems mean", they are all asserting that the
collection is uniform. That assertion survives exactly as long as nobody adds a second kind
— and adding one is invisible, because it breaks no signature.

**Working rule.** When a collection is summarised rather than enumerated, **put the kind in
the element, not in the reader.** `{ kind, message }` costs one field and makes each reader
decide what to do with each kind — and a kind added later reaches every reader without any
of them being edited.

**And prefer that to a second parallel array.** Splitting into `rateErrors` and
`inputErrors` would leave every consumer needing to know about both and stay in step, which
is the "rule enforced at one call site" pattern waiting to happen — one reader updated, the
next one not, and no signal either way.

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

**No longer urgent — the tax invoice no longer depends on it (F40).** The invoice's
*Est. Amount* column used to be a duplicate of the bill figure and was pointed at a
**recomputation** (`getJobFullEstimate(...).finalAmount`) rather than at this stored value,
precisely because fixing O4 corrects only future writes and would leave every existing job
printing the understated figure on a document going out today.

**But it stays open, and the reason is narrow:** everything ELSE that reads
`estimateAmount` still gets the understated number. It is stored on the job at estimate-send
time and read by the estimate register, the Reports lifecycle view and any comparison of
estimated against billed that works from stored fields rather than recomputing. Those are
now the only consumers that carry the fault, which makes this smaller than it was — not
resolved.

Note also what the invoice change did NOT do: it did not correct the stored value, so a
future reader comparing `job.estimateAmount` against the invoice's Est. Amount column will
find them disagreeing. That disagreement is this defect, visible from a new angle.

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

### O7. A new agency is seeded with UGVCL's identity — and prints it

**The most serious finding of the setup-gap review, and it is not a fallback problem.**

`AgencySettings.tsx:146-157` **seeds every newly created agency** with a specific
DISCOM's registration details:

| Field | Seeded value |
|---|---|
| `discomName` | `Uttar Gujarat Vij Company Ltd.` |
| `discomGstin` | `24AAACU6551F1ZI` |
| `discomPan` | `AAACU6551F` |
| `discomAddress` | `Sardar Patel Vidyut Bhavan, Race Course, Vadodara - 390007` |
| `circleOfficeName` | `SABARMATI` |
| `serviceSacCode` | `998719` |
| division / prefix | `SABARMATI` / `21 IS` |

Because these are **written to the agency document**, they are truthy — so no `||`
fallback ever fires and nothing signals they were never chosen. They read as deliberate
configuration.

A **second layer** of the same constants sits in render-time fallbacks
(`BillingSystem` 407-434, `EstimateGenerate` 458-460 / 1089, `EditAgencyForm` 42-53,
`SingleJobEstimateReport` 813/1015), including
`atNumber || 'UGVCL/EE-T-1/Trans.Rep/2020-21/01/1052'` — a specific historical UGVCL
order number — so clearing a field re-applies the same identity.

**What a fresh agency prints before anyone edits anything:**

- **Tax invoice** — DISCOM GSTIN `24AAACU6551F1ZI` and PAN `AAACU6551F`. These are a real
  company's tax registration numbers on a tax document issued by a different company.
- **Estimate forwarding letter** — `Uttar Gujarat Vij Company Ltd.`,
  `Superintending Engineer (O & M)`, `Circle Office : SABARMATI`.
- **Estimate sheets** — `DIVISION : SABARMATI`, and an ORDER NO falling back to that
  hardcoded UGVCL order.
- **Job numbers** — prefix `21 IS`, a UGVCL division's scheme.

An agency working with DGVCL, MGVCL or PGVCL would issue documents carrying UGVCL's
identity. **This is the F1/O6 fabricated-value pattern reaching a customer-facing
financial document** — and it defeats the purpose of the multi-DISCOM support the app
otherwise has.

**FIXED — seeding stopped, both layers removed, generation gated.**

1. **No seeding.** `AgencySettings` no longer writes `discomName`, `discomGstin`,
   `discomPan`, `discomAddress` or `circleOfficeName` into a new agency, and the
   `SABARMATI` / `21 IS` division seed is gone. A new agency starts empty.
2. **DISCOM is a required choice at creation** — a select of the four Gujarat DISCOMs
   with nothing pre-selected, storing the **name only**. GSTIN, PAN and address are
   entered by the agency from its own tender paperwork, deliberately **not** pre-filled
   from a built-in table: only UGVCL's is verified, and only because it happened to be
   in this codebase.
   *`discomStateCode` is still set to `24`* — all four DISCOMs are Gujarat entities, so
   it is not agency-specific, and it drives the CGST/SGST vs IGST determination rather
   than appearing on the document.
3. **Second layer removed.** The render-time fallbacks in `BillingSystem`,
   `EstimateGenerate`, `EditAgencyForm` and `SingleJobEstimateReport` no longer
   re-apply the constants, including
   `atNumber || 'UGVCL/EE-T-1/Trans.Rep/2020-21/01/1052'`. Clearing a field now clears it.
4. **Generation blocked, per document, on the fields that document prints** — not one
   agency-wide check. `missingForTaxInvoice` requires name + GSTIN + address;
   `missingForEstimate` requires name + circle office. The dialog names the specific
   missing field. The **delivery challan, oil statement and forwarding letter are
   deliberately NOT gated**: they carry no tax registration, and blocking a dispatch over
   a missing GSTIN would stop physical work for a gap that does not affect the document
   being produced.

**Migration — report only, nothing changed.** `scripts/agency-identity-console.js` lists,
per agency, which of the six fields still exactly equal the seed. **The data cannot
settle whether that is wrong:** a UGVCL agency that never needed to change a value is
indistinguishable from a non-UGVCL agency that never noticed it. So affected agencies are
flagged for confirmation, never cleared automatically.

### O8. `agencyStateCode` was seeded '24' — asserting an unverified registration

Seeded alongside the DISCOM identity (O7), but a different kind of wrong: `discomStateCode`
`24` is true of **every** option in the DISCOM select — all four are Gujarat entities — so
seeding it cannot be incorrect. An agency's **own** registration state is a fact about
that agency, and the app has no way to know it. Seeding `24` asserted Gujarat
registration for every agency created.

**Fixed by derivation rather than by asking.** The GST state code **is** the first two
digits of a GSTIN — it is part of the number, not a separate fact. `stateCodeFromGstin`
derives it, `getAgencyStateCode` uses it everywhere (invoice, letterhead, edit form), and
`EditAgencyForm` shows it **read-only** with "Derived from the agency GSTIN (24…)"
whenever a GSTIN exists, persisting the derived value on save. Two places to be wrong
about one fact become one. Seeding removed from `agencyState` and `agencyStateCode`, and
the `|| 'Gujarat'` / `|| '24'` render fallbacks are gone — the invoice shows `-` rather
than asserting.

**See O9**: this fixes the *data*. It does not fix the tax treatment, which was
originally attributed to it.

### O9. No IGST path exists — out-of-state agencies are charged the wrong tax

**Correcting an earlier conclusion in this trail.** The seeded `agencyStateCode` of `24`
(O8) was described as causing a non-Gujarat agency to "silently get CGST+SGST where IGST
is due". That overstated it, and the distinction matters:

- **The seed made the DATA wrong** — it asserted a registration state nobody had entered.
- **It does not cause the tax treatment**, because **there is no IGST path to bypass.**

`BillingSystem` applies `cgstRate` and `sgstRate` **unconditionally** (defaulting 9/9).
A repo-wide search finds no `igst` anywhere, and **nothing compares agency state to DISCOM
state**. The state codes are display-only: they print on the invoice and drive nothing.

**Consequence:** a non-Gujarat agency is charged the wrong tax on **every** invoice,
*regardless of how correct its data is*. Entering a correct `27…` Maharashtra GSTIN
changes what prints; it does not change the split applied.

**New visibility, as a side effect of O8.** With the code now derived rather than seeded,
an out-of-state agency's invoice will display a state code that **visibly disagrees with
the CGST/SGST split printed beside it** — a discrepancy a DISCOM's accounts department
could reasonably spot. Correct data exposes the gap instead of hiding it. That is an
argument for O8 having been worth doing even though it did not fix this.

**The decision this needs is a product one, not a code one: is a non-Gujarat agency
actually in scope?**

All four DISCOMs are Gujarat entities. An agency registered outside Gujarat repairing
transformers for them is *possible* but may never occur in practice.

- **If it cannot happen** — IGST is correctly absent, and the right fix is to **block
  agency creation with a non-`24` GSTIN**, naming the reason. That is a smaller, more
  honest change than building a tax path nobody will exercise: it refuses the case
  rather than half-supporting it.
- **If it can happen** — IGST support is required, and the intra/inter-state rule should
  be confirmed against the tender before any calculation is written.

**Neither implemented.** Both are tax-calculation decisions. Recorded for the decision,
not pre-empted by it.

### A3. RESOLVED: an unrecorded allotment now blocks

`NewJob.tsx` resolved an unrecorded allotment to `0` and the whole quota check sat inside
`if (allowed > 0)`, so **an agency that never configured allotments had no quota
enforcement at all** - every intake was permitted. The check was silently inert, the
F1/F2 shape applied to a control rather than a value.

**Decided: it blocks.** An allotment that was never recorded is not a quota of zero and
not a quota of infinity - it is missing data, and receiving against it means receiving
against nothing. It raises the same setup-gap dialog as an exhausted allotment, routed to
that AT's Allotments tab.

**A second reading of the same question, found while implementing it.** A job can escape
the quota for a completely different reason: **having no AT at all.** The allotment check
is gated on `activeAtMaster`, and the count queries
`where('atId', '==', activeAtMaster.id)` - so a job saved with `atId: ''` is neither
checked on intake nor counted afterwards. That is now blocked too (F21).

**Note for anyone reading allotment figures:** because the count query filters on
`atId`, AT-less jobs are excluded from it. A "19 of 20 used" figure is 19 genuine
AT-linked jobs - AT-less jobs do not inflate it. The exposure runs the other way: they
consume no quota anywhere, so real work can exceed an allotment without the app noticing.

### O10. Product question: should the estimate master be shared, or per-agency?

**Recorded as an open product question, not a task.** The stated intent is that the estimate
master is COMMON across all agencies - editing one item should affect all of them. The code
stores it per agency and shares it by **broadcast**, not by reference:

- `getEstimateMasterForCore` reads **agency -> global -> built-in default**, so an agency's
  own copy always wins where it exists.
- `saveGlobalDefaultEstimateMaster` (superadmin only) writes `public_config/estimate_master`,
  mirrors to `system_config/estimate_master`, and then **copies all sections into every
  agency document**.
- After that first publish, every agency holds a full local copy, the copy wins, and
  `public_config` is never consulted again for those sections. Any later per-agency save
  diverges that agency silently.

So sharing is a one-time broadcast that decays. Six sections across two agencies now hold
six different things (AUDIT F27), which is that decay observed.

**The alternative** - agencies read `public_config` live and store only genuine overrides -
is real sharing, and is **deliberately not being done now**. It is a data-model change to
what every agency prices from, and doing it while four of six sections hold the wrong
schedule would install the wrong data as the shared baseline. The order has to be: correct
the sections, then decide the model.

**Decision for now: keep the broadcast**, with a guard on the publish path (F29) so it
cannot broadcast fallback-resolved content.

**CLOSED by census.** `public_config` has since been corrected, and a full cross-owner
census (`all-agencies-census-console.js`, run as super admin) found **7 agencies across 3
owners, 1 faulty** — IDEAL ENGINEERING COMPANY, all three sections **EMPTY**, 0 jobs, 0
issued documents.

Empty is the benign case, and it resolves the worry that other owners were carrying the
fault: they are not. Verified against the code, both halves —

1. **An agency with all three sections absent resolves entirely through `public_config`.**
   `getEstimateMasterForCore` tries the agency's section, then the global default, for each
   of CRGO, Amorphous and Wound Core; with all three absent every lookup lands on
   `public_config`, which is now correct. `enrichedAgencies` reaches the same value earlier,
   filling the empty fields from the same document before any component sees them.
2. **Nothing degrades if left alone.** `addAgency` is creation-only and now seeds from
   `public_config` or the shipped defaults, never from an active agency (F30). The only
   other writers are the per-agency saves and the publish fan-out, and both would now write
   the *corrected* content, because the screen resolves from the corrected default. The
   moment IDEAL stores anything it stores something right.

So none of the three options considered — a cross-owner bulk write, the live-`public_config`
data model, or an unscoped super-admin fan-out — is warranted. **The problem the options
were for does not exist in the data.** Worth recording as its own small lesson: the census
was cheaper than any of the fixes and made all three unnecessary.

One honest caveat, not a reason to act: `cachedGlobalDefaultEstimateMaster` is seeded from
`localStorage` at module load, so a user whose browser holds an old cached copy resolves
through it until the fetch lands on that page load. It is per-browser and self-correcting,
and no write happens in that window.

### O19. AT activation is decided in two places that disagree; the caller overrides the guard

`addAtMaster` (`AgencyContext`) deliberately does NOT activate a new AT when one is already
active for that agency — the F20 guard, `atMasters.some(a => a.id === activeAtMasterId &&
a.agencyId === newAt.agencyId)`. `AtSettings.handleAdd` then calls `setActiveAtMasterId`
**unconditionally**.

**Today's behaviour is correct, and correct only by override.** A newly created AT does
become active, which is what a tender rollover needs — but that outcome comes from the
caller ignoring the context's policy, not from the policy.

**The shape: a guard that is dead policy reading as live.** Anyone auditing `addAtMaster`
alone would conclude the app deliberately preserves the current selection on creation. It
does not. And the dangerous direction is the plausible one — someone "fixing" `AtSettings`
to respect the guard would silently reintroduce the failure this was checked for: an
operator creates AT 27-28, nothing switches, and they continue booking against last year's
tender at the wrong percentage, the wrong allotment and the wrong counters.

That is worse than an ordinary duplicated rule, because the two are not merely inconsistent
— **the correct behaviour depends on one of them being ignored.**

**The guard should be removed or aligned, not obeyed.** Aligning means `addAtMaster`
activating unconditionally, matching what every caller wants; removing means deleting the
guard and leaving activation to the caller as an explicit decision. Either is fine. Making
the caller respect it is the one option that is wrong, which is exactly the change a reader
of that function would be most likely to make.

Distinct from the "rule enforced at one call site" pattern: there, a rule was applied
somewhere and not elsewhere. Here it is applied in one place and **deliberately overridden**
in the only place that calls it.

### O18. An AT's "Closed" status promises an enforcement that does not exist

`AtSettings` offers "Mark as Closed" on an AT period. **Nothing enforces anything.** Traced
every consumer: `at.status` is read in exactly three places, all in `AgencyContext`
(`:373`, `:537`, `:547`), and all three do the same thing —

```
const activeAts = agencyAts.filter(at => at.status === 'Active');
const chosen = activeAts.length > 0 ? activeAts[0] : agencyAts[0];
```

It is a **tie-breaker for which AT is auto-selected** when no choice is stored for that
agency. Not a filter. A Closed AT is still listed, still selectable, still chosen when it is
the only one, and jobs can be booked against it exactly as before. Nothing in pricing, job
numbering, allotments, estimates or bills reads it.

**So the word is doing work the code is not.** "Closed" reads as *no new jobs can be booked
against this tender period*. An operator who closes an AT and then books a job under it gets
no warning, because there is nothing to warn about — which is the worst version of this: the
control appears to have worked.

**Two fixes, and they are not equivalent:**

1. **Rename it to describe what it does** — it affects which AT is offered by default and
   nothing else. Something like "Preferred / Not preferred", or a plain "Default for new
   work" toggle. Cheap, honest, and changes no behaviour.
2. **Add the guard the label implies** — block intake against a Closed AT in `NewJob`, the
   way an unrecorded allotment now blocks.

**The choice is a tender question, not a code one:** does a closed tender period actually
prohibit new intake, or is closing it bookkeeping that records the period is over while
stragglers are still booked against it? Only someone who knows how the division treats a
lapsed AT can say. **Not decided here.**

Related in kind to D3 and the `Less: 0.00` row — a control or field that looks operative and
is not — but worse, because a permanently-zero row asserts nothing while this one asserts
a restriction.

### O17. Oil shortage is measured everywhere and priced nowhere; the estimate's "Less" row can never be non-zero

Checked while considering whether the bill and the estimate deduct an oil shortage
differently. **Neither deducts it at all**, so there is no divergence to fix — and the
absence is the finding.

**The bill has no deduction term.** `BillingSystem.subTotal` is the sum of
`calculateJobTotal` over the selected jobs; `cgst`, `sgst` and `grandTotal` derive from it.
`netShortage` is computed (`jobOilDetails`), totalled (`totalNetShortage`) and printed on
the oil account sheet, but never enters the money path.

**The estimate's `lessAmount` is a hardcoded zero on every path.** `const lessAmount = 0.00`
in the itemised branch, `lessAmount: 0` in both fixed-rate branches, and
`finalAmount = amountWithPercentage - lessAmount`. A repository-wide search finds **no
writer anywhere** — nothing in the app can make it non-zero.

**But it prints.** The estimate renders a `Less:` row showing `0.00` on every document that
goes to UGVCL. A permanent zero on a line that looks like a working deduction is the F32
shape once more: a slot that appears functional and has never been connected. It differs
from F32 in that this one cannot be filled by an operator keystroke — there is no field —
so it is inert in a stronger sense, and correspondingly more likely to be assumed working
by whoever next reads the printed form.

**RESOLVED — the code is correct as it stands.** An oil shortage is **not** deducted from
either document, and should not be. It is accounted for on the **oil account sheet**, which
accompanies the bill. The shortage is settled on its own sheet, not against the money, so
the absence of a deduction term in `calculateJobTotal` and the hardcoded `lessAmount = 0`
are both right. This entry stands as the record that the absence was checked and is
deliberate, not an omission.

**What remains is presentational only**, and is deferred rather than fixed — see **D3**.

**Nothing changed.**

### O16. The estimate and the bill compute the same job by two different models

**This is a defect in the app, not in the data.** The estimate and the bill would disagree
for the same job even with a perfect master. The master repair did not cause it; it removed
the thing that was hiding it.

Two functions share the name `calculateJobTotal`, in two files, and they do not compute the
same thing:

| | |
|---|---|
| `EstimateGenerate.calculateJobTotal:819` | `getJobFullEstimate(job).baseTotal` → `buildSingleJobEstimateData` → **branches on core type**; Amorphous / Wound Core take the `SCHEDULE_B` fixed-rate path |
| `BillingSystem.calculateJobTotal:482` | walks `jobMasterData`, summing `qty * rates[kva]`, with hardcoded quantity rules (`1c`→7, `8`/`9A`/`9B`→3, `15`→6, KG rows→14/15.54/45.36). **No core-type branch at all.** |

`BillingSystem` imports no `SCHEDULE_B`, no `findScheduleBEntry`, no
`buildSingleJobEstimateData`, no `classifyCoreType`. There is no fixed-rate path in billing.

**The tender says Amorphous and Wound Core are FIXED RATE (Internal & External)**, and a
comparable issued bill shows a single "Repairing Charge - Fixed Rate" line plus a labour
line — which is what the estimate produces and not what the bill does. On that reading the
bill is the wrong one. Not decided here: it is a tender question.

**Found while checking whether the master repair moves any figure. It does — on bills.**

| | Amorphous / Wound Core repair charge |
|---|---|
| **Estimate** (`SingleJobEstimateReport.tsx:226`) | returns early, prices from the hardcoded `SCHEDULE_B` table. The master is never consulted except for the scrap row. |
| **Bill** (`BillingSystem.calculateJobTotal:481`) | **no core-type branch at all** — walks `jobMasterData` for every core type, summing `qty * rates[kva]` over each row with a rate `> 0`. |

`BillingSystem` does not import `SCHEDULE_B`, `findScheduleBEntry`, `buildSingleJobEstimateData`
or `classifyCoreType`. There is no fixed-rate path in billing.

**Two consequences, the second only now activated.**

1. **The two documents disagree by construction.** Schedule-B is an all-inclusive fixed rate
   per capacity plus a labour charge. The bill instead itemises: at any capacity, master rows
   `2` (labour), `3` (tank per KG), `4` (conservator per KG), `5` (radiator) and `6` (sealing)
   all carry positive rates and would be added to every Amorphous repair, whether or not that
   work was done. An estimate and a bill for the same job can therefore differ, and neither
   is derived from the other.
2. **The placeholder was masking it.** Every rate in the 10-item placeholder was `null` or
   `0`, and `calculateJobTotal` only accumulates where `rate > 0`. So for the three agencies
   holding it, **a repairable Amorphous bill totalled 0** — and the repair, by installing a
   master with real per-capacity rates, turns that 0 into a real itemised sum.

**So the answer to "does the repair change any figure":**

- **CRGO** — no. Same rows, same rates.
- **Scrap** — yes, and it is a fix: blocked or mis-resolved before, Rs 500 flat now, via
  `resolveScrapCharge` on both paths.
- **Amorphous / Wound Core estimate** — no, and for a stronger reason than expected. It is
  not that `resolveRate` fell back because the rates were zero; `resolveRate` is never
  reached. The branch returns before it. The estimate total is independent of the master's
  values whatever they are.
- **Amorphous / Wound Core bill** — **YES.** 0 before, a real sum now.

**This also corrects F32.** That entry said a rate typed into a placeholder row "would have
priced from that moment". True of the **bill**, which walks the master; **not** true of the
estimate, which never reads it. The latent exposure was real but narrower than recorded.

**Nothing changed here.** This is a calculation, and the standing rule is that calculations
are not altered without explicit approval. It needs a decision: should an Amorphous bill be
the Schedule-B fixed rate (matching its estimate), or the itemised walk it does today? Only
someone with the tender can say. Until then, **check any Amorphous or Wound Core bill against
its estimate before sending** — and note that jobs already billed carry a frozen
`job.billAmount`, so an issued bill is not retroactively changed by the repair; it is simply
no longer what the app would now compute.

### O15. A sixth path writes document fields, in a file called Reports

`Reports.tsx:394` — `handleSaveDates`, behind a "Lifecycle Dates" modal — writes
`estimateSentDate`, `estimateRefNo`, `estimateAmount`, `billSentDate`, `billNo`,
`billAmount`, `paymentReceivedDate`, `paymentStatus`, `paymentAmount` and `paymentRefNo`
straight onto the job, optionally to **every job in the MR** (`applyToAllInMr`). It carries
no `issuedByAgencyId`, so F37's five stamped sites are five of six.

**How it was missed, which is the point of recording it separately.** The search that found
the other five asked *"where are documents produced?"* — and the answer was Estimate, Bill,
Challan. This site produces no document. It is a data-entry screen for recording that a
document was issued at some point in the past, and it lives in **Reports**, which nobody
scans when asking where issuing happens. The right question was *"where is `billNo`
written?"* — the field, not the activity. The sweep-shape lesson again: **search for the
data being written, not for the activity you believe writes it.**

**And it is NOT simply a missed stamp — stamping it would be wrong as things stand.** This
path records documents issued *previously*, often by a different agency at a different time.
Writing `issuedByAgencyId: activeAgency.id` here would assert that whichever agency happens
to be active now issued a document it may have had nothing to do with. That is F37's
laundering problem — an inference asserted as a record — arriving at a live write rather
than at a backfill, and it would be harder to spot because the value would look freshly and
legitimately captured.

**So this needs a product decision, not a patch.** The options, none implemented:
- ask for the issuing agency in the modal, defaulting to the job's current one, so the
  operator states it rather than the session implying it;
- stamp it only when the modal is creating a record that did not exist (no prior `billNo`),
  and leave it absent when amending;
- leave it unstamped, and accept that documents recorded through this path are identified by
  the printed copy alone — consistent with the 36 reversed jobs.

Until then, a job whose document fields were entered here is indistinguishable from one
issued before F37: no stamp, meaning "not recorded". That is at least honest, and it is why
this is an open question rather than a defect in F37.

### O14. No document records which agency issued it

A job carries `billNo`, `billRefNo`, `billSentDate`, `billAmount`, `billStatus`,
`estimateSentDate`, `estimateRefNo`, `estimateAmount`, `challanNo` — and **not one field
naming the agency that issued them**. Verified at the write sites, not inferred:
`BillingSystem.tsx:1136-1145` and `EstimateGenerate.tsx:883-891`. There is no `bills` or
`estimates` collection either; documents are rendered on demand from the job plus whichever
agency is **active at print time**.

So the supplier identity of an issued document lived in exactly one place: `job.agencyId`.

**This is the audit's second recurring shape — identity in a mutable field — applied to
document provenance, and it is the most consequential instance found.** Scrap identity in
`status` (F5) was erased by dispatch and recoverable from the inspection record. Here the
field was erased by the bulk move, and there is no side record of the issuing agency at all:
the reconstruction in `reverse-bulk-move.js` is the only in-database evidence, not because
it is the best available but because the alternative never existed.

**Two practical consequences:**

1. **Reprinting cannot tell you what was issued.** The letterhead comes from the current
   session. A reprint today shows the present state, not the document that was sent — so
   the paper or PDF produced at the time is the only authority, and reprinting to "check" is
   a trap that produces a confident wrong answer.
2. **Every document issued from now on has the same gap.** 29 documents are affected today;
   the count grows with use.

**The fix is small and should be made before more documents are issued:** stamp
`issuedByAgencyId` (and ideally the agency name and GSTIN as printed) onto the job in the
same batch that writes `billNo` / `estimateSentDate`. A document's supplier is a fact about
the past and belongs in an immutable field, not in a pointer that later writes can move.

**RESOLVED after the reversal — see F37.** Deliberately not backfilled for the jobs the
reversal touched; the reason is recorded there and is the more important half of the fix.

### O13. "Save All for {agency}" still writes the screen's resolved view, not stored data

**F34 fixed the publish paths and not this one.** `handleConfirmSaveSection` (scope ALL) and
`handleExecuteFullSync` now send stored data for untouched sections. The per-agency
**"Save All for {agency}"** button (`handleSaveAllToCurrentAgency`) still writes component
state for all five sections unconditionally:

```
estimateMasterOverhauling: overhaulingData,   // and the other four
```

**Observed, not theorised.** MEGHA's Overhauling section was empty in Firestore and now
holds the shipped 5-item all-null shell. Nothing wrote it deliberately: the screen resolved
the empty section to the shipped default for display, and one press of "Save All for MEGHA"
persisted that display as stored data. Textbook F27 (c)(1) — a fallback becoming storage
through an ordinary save.

**Harmless in this instance**, which is why it is an open item rather than a fix in flight:
the Overhauling shell is all-null, and OH jobs price from Schedule-A whether the section is
empty or holds the shell. Nothing changed for pricing. But the same button would have
persisted a *misfiled* Wound Core the same way, and that would not have been harmless.

**Not fixed now** because the button is in use during a hand repair, and changing what Save
writes midway would mean the operator's next press stores something other than what they
inspected. The fix is small: route it through `publishPlanFor`, exactly as F34 did for the
publish paths, so untouched sections write back what is already stored.

**Also worth noting:** F34's `editedSections` machinery already exists and this button
ignores it. A rule implemented once and not applied at the second call site — the pattern
this audit opened with.

### O12. `public_config/estimate_master` stays stale — accepted for now, with a stated expiry

**Decision: do not publish.** The four agencies are repaired individually from the account
that owns them; the shared default keeps its old content.

**Why publishing was not the answer, and this is the substantive finding.** Publishing
requires super admin, which is a single hardcoded email
(`AgencyContext.tsx` for the UI, `firestore.rules:16` for the write). But
`saveGlobalDefaultEstimateMaster`'s fan-out iterates the **owner-scoped** agency list —
`query(collection(db,'agencies'), where('ownerId','==',uid))`. So publishing from the admin
account would have written `public_config` plus **only that account's own agencies**. The
four agencies in question belong to a different owner and would have kept their own copies,
which win in `getEstimateMasterForCore`. **The publish would have changed nothing for the
agencies it was meant to fix**, while appearing to succeed.

Granting super admin to the owning account was rejected as disproportionate: it is a
permission change made for a convenience, and super admin also reads `system_config`, which
holds payment-gateway secrets. Correct call — the blast radius of the grant far exceeds the
task.

**Why staleness is tolerable.** `public_config` is read in exactly two places:
1. as a **fallback** in `getEstimateMasterForCore`, reached only when an agency's own
   section is empty or misfiled — after the repair, no agency reaches it;
2. as the **seed** in `addAgency` for a newly created agency.

So no existing agency prices from it, and nothing printed today depends on it.

**The condition under which this stops being acceptable — and it is a single event:**

> **A new agency created before `public_config` is corrected will seed from the stale
> shared default**, and will start life with a CRGO section missing scrap code `"22"` and an
> Amorphous section missing `"0"`. Neither blocks estimates; both block scrap billing, and
> only when a scrap unit reaches the bill — long after creation, with nothing pointing back
> to it.

That is the whole exposure, and it is latent in the F32 sense: dormant until an ordinary
action triggers it. **Correct `public_config` before creating another agency**, or accept
that the next agency needs its sections repaired by hand like these four.

Note that F30 removed the worse version of this — seeding from whichever agency happened to
be active. What remains seeds from a document that is merely incomplete, not misfiled.

### O11. `normalizeAmorphousOrWoundCoreData` backfills `fixedRate` from an arbitrary capacity

`EstimateMaster.tsx`, inside the load-time normaliser: when a stored row's `fixedRate` is
absent, null or zero, it is filled from the default's `fixedRate` — and failing that, from
**the first non-zero per-capacity rate it happens to find**:

```
const nonNull = Object.entries(ratesObj).find(([k, v]) => v !== null && Number(v) > 0);
if (nonNull) fRate = Number(nonNull[1]);
```

For a per-capacity item that installs **one arbitrary capacity's rate as a flat rate for
every capacity**, decided by key iteration order. A 5 kVA rate becomes the rate for a 500
kVA unit, and the row looks properly configured afterwards.

**Inert today, and only by accident of what reads it.** Amorphous and Wound Core repair
charges do not come from the estimate master at all —
`SingleJobEstimateReport.tsx:226` returns early for those core types and prices every line
from the hardcoded `SCHEDULE_B` table. The master is consulted for exactly one thing on
those core types: `resolveScrapCharge` reading the `"0"` row, which is legitimately flat at
Rs 500. So a backfilled `fixedRate` on any other row is currently read by nothing.

**One code change from producing wrong money.** Anything that starts pricing Amorphous or
Wound Core items from the master — a per-item override, a new charge type, a future tender
that itemises what Schedule-B currently bundles — reads a flat rate that was never entered
by anyone and cannot be told apart from one that was.

**Same latent shape as F32's placeholder**, and worth stating as a pair: a plausible value
sitting in a field nothing reads yet. F32's was inert because nobody typed into it; this one
is inert because nobody reads it. Neither is safe; both are one ordinary change away, and
neither can be found by looking for damage.

**Not fixed.** The honest repair is to stop inventing a `fixedRate` and leave it absent —
absent is the truth — but that changes what the master screen displays for every Amorphous
and Wound Core row, and it should not be done in the middle of a hand repair. After.

### A7. Three places decide whether a stored section "is the CRGO card", and they can disagree

**Introduced by the F27 fix, not found by it.** F27 replaced the four-string name blacklist
with a positive identity test — but only in `AgencyContext.getEstimateMasterForCore`. Two
copies of the old blacklist remain in `EstimateMaster.tsx`:

| Site | Test | Decides |
|---|---|---|
| `AgencyContext` (`isLegacy`) | `checkMasterSection(...).holdsCrgoCard` | what the app **prices** from |
| `EstimateMaster.tsx:293` (`isLegacyWc`) | four `itemName` substrings | what the master screen **displays** |
| `EstimateMaster.tsx:84` (`isLegacyCrgo`, inside `normalizeAmorphousOrWoundCoreData`) | the same four substrings | whether a loaded section is **replaced by defaults** |

A CRGO card that does not contain `dismental` / `washer ring` / `hv metal` / `lv metal`
would now be **rejected by the resolver and accepted by the screen** — the screen would show
and offer to save a section the pricing path refuses to use. The reverse is also reachable.

That third site carries a second heuristic besides: `isOldPlaceholder` — ten or fewer items
with every rate null or zero — which is a shape test for the F32 placeholder. It works, and
it is a fourth independent definition of "this section is not what it claims to be".

**Not fixed now, deliberately.** Collapsing these onto `checkMasterSection` changes what the
master screen loads, and doing that midway through a hand repair would mean the operator's
next Save writes something different from what they inspected. **After the repair, not
during.** None of the current sections is affected either way — all three CRGO-card Wound
Core sections contain "Dismentaling", so every test agrees on them today.

This is the "rule enforced at one call site" pattern, in a place this audit created. The
F27 entry claimed to have replaced the blacklist; it replaced one of three copies. Worth
noting as the same shape as the A4 error — a change verified against the site it was made
in, rather than against every site that answers the question.

### A6. The job-number read and write test different conditions on the same field

**A defect in its own right, independent of the seeding fix (F25) that made it harmless
today.** Both functions decide *which document holds the counter*, and they decide it
differently:

| | test |
|---|---|
| `getNextJobNoInfo` (`AgencyContext.tsx`) | `if (activeAtMaster && activeAtMaster.lastJobNumbers)` |
| `incrementJobNoCounter` (`AgencyContext.tsx`) | `if (activeAtMaster)` — the object alone |

The read consults the AT's counter map; the write consults only whether an AT exists. For
an AT with a populated map the two agree, and that is the only reason nothing is currently
broken — F25 removed the one state where an AT could be active with an empty map.

**Why this stays on the OPEN list even though nothing misbehaves.** The tests are not
equivalent, and their agreement is a property of the *data* rather than of the code. A
future change to either one alone re-opens the exact failure F25 closed:

- Make the read test for a **non-empty** object (the obvious-looking fix, and the one
  considered first): job 1 is numbered from the agency (say 47), the increment still writes
  to the AT starting from *its* zero (1), and job 2 is numbered from the AT (2). Duplicate
  job numbers — one job later and quieter than the original bug.
- Make the write test `activeAtMaster.lastJobNumbers` to match: increments go to the agency
  while an AT is active, so the AT's map never becomes non-empty and the handover never
  happens. Two live counter sources indefinitely.

**Neither is fixable at one site.** Any change here has to move both, and has to be checked
against **the first job of a newly created AT** specifically — the only state where the two
tests can disagree. Both functions now carry a comment saying so and pointing here; a
one-way note would be found only by whoever happened to read the right function, which is
never the person about to change the other.

This is the F24 guard-and-rebuild shape in a second place: *two sites individually correct,
safe only in combination, with the dependency invisible from either.* The difference is
that F24's coupling was discovered by breaking it, and this one is recorded before anyone
does.

### A5. Inspection `createdAt` uses the client clock, not the server's

**Narrower than first reported, and worth stating precisely because the first version was
wrong.** Inspections **are** dated: both inspection screens write
`createdAt: Date.now()` on first create only, so the stamp is not overwritten by later
edits. Ordering and dating of inspection records *is* possible.

What remains is that `Date.now()` is the **browser's clock**. It can be wrong, and it can
be set deliberately. `serverTimestamp()` cannot.

**Why this matters more here than elsewhere:** inspection records have been the
evidentiary basis for much of this audit —
- **F5** read `data.condition` from them to restore scrap identity on 26 jobs;
- the **GP flow** reads them to establish what a unit was;
- **stage-order gating** treats their existence as proof an inspection happened.

None of that is undermined by a client clock in normal use, but a record whose
`inspectionDate` and `createdAt` both come from the same untrusted source cannot
corroborate itself. A server stamp is the only part of such a record the operator cannot
choose.

**FIXED — as two changes, formatter first (F23).** Switching to `serverTimestamp()` changes
the stored type from a **number** to a **Firestore Timestamp object**, which would have
broken a reader. See F23 for the consumer census and the order the two changes were made
in. The reason for the order is exactly the F16 lesson: had the writes gone first, the
symptom would have been inspection dates silently turning into dashes on the Job Lifecycle
report — a blank, not an error.

### A4. Creation order is unrecoverable for most collections — no `createdAt`

Only four write sites in the app record a creation timestamp: `jobs`
(`NewJob`, `MrLedger`), `oilTransactions` (`serverTimestamp()`), and `supportTickets`.

**`atMasters` and `agencies` record none.** For those collections the
question *"which was added first"* **cannot be answered at all** — not by a query, not by
a script, not retrospectively. Firestore auto-ids are not chronological in any documented
way, so they cannot substitute.

This surfaced while writing `scripts/find-misattached-at-console.js`, which needs "the
newest AT" to identify a misattached one (F22). It falls back to sorting by `startDate`,
which is the *tender period* start — a business date the operator types, not a creation
time. Two ATs created a month apart can carry the same `startDate`, and one created later
can start earlier. The script says so rather than implying the order is real.

**Consequences beyond that script:**
- No audit trail of when an agency or AT was set up, so "was this configured before or
  after the tender was signed" is unanswerable.
- Any future migration that needs "the earliest record wins" has no basis for it.

**CORRECTION.** An earlier version of this entry claimed `inspections` record no
`createdAt`. **That was wrong** — both `ExternalInspection` and `InternalInspection` write
`createdAt` on first create (guarded by `if (!jobData.inspectionId)`, so an edit does not
overwrite it). Inspections *are* dated; see A5 for the narrower concern that was real.

**This was the third pattern note applied to itself.** The claim came from a *survey by
proxy* — grepping for which collection names appear near a `createdAt`, then reading the
absences as findings — rather than opening each write site and reading what it writes.
That is the same shape as the F16 date sweep: **the method could not see what it was not
looking for.** A grep for collection-name adjacency finds collections mentioned near the
token; it cannot find a write that stamps `createdAt` through a `payload` object built
twenty lines earlier, which is exactly how both inspection screens do it.

The survey-by-proxy signature is worth naming, because it is cheap and it reads as
thorough: *a question about what the code does, answered from a search over how the code
is written.* "Which collections have a `createdAt`" is a question about write sites, and
only reading write sites answers it. The proxy was faster and produced a confident wrong
list — and the confidence came from the search having been exhaustive **against its own
definition**, which is precisely the failure mode the F16 note already describes.

**Not fixed.** Adding `createdAt` to new writes is trivial (`serverTimestamp()`, as
`OilInward` already does), but it is **not retroactive** — existing documents stay
unordered forever, so the gap narrows going forward without ever closing. Worth doing for
that reason alone, but it is a schema addition and wants deciding rather than slipping in.

### A3-original. Open question: are allotment quotas meant to be opt-in?

`NewJob.tsx:1093-1101` resolves an unrecorded allotment to `0`, and the whole quota
check sits inside `if (allowed > 0)`. **An agency that never configures allotments has
no quota enforcement at all** — every intake is permitted.

This may be deliberate (quotas are opt-in per division and core type) or a gap (the
check silently does nothing when the data is missing, the F1/F2 shape). The setup-gap
dialog was **not** applied here, because making it block would change what blocks.

Needs a decision before anything is built on it: is an unset allotment "unlimited", or
"not yet configured, refuse to receive"?

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

### D3. The estimate's `Less: 0.00` row stays on the printed form

`lessAmount` is hardcoded to zero on every path in `buildSingleJobEstimateData` and has no
writer anywhere in the app, so the estimate prints a `Less:` row reading `0.00` on every
document. Since an oil shortage is settled on the oil account sheet and never deducted from
the money (**O17**), that row will remain zero indefinitely.

**Not removed, and the reasoning is the same as the "Type" column heading deferral above:**
estimates carrying this row are already with UGVCL. Changing the shape of the form
mid-tender creates a discrepancy between the documents they hold and the ones they receive
next — a reviewer comparing two estimates would find a row present on one and absent on the
other, and has no way to know that means nothing.

It also sits on the right side of the general rule recorded there: **consistency across
documents in the same envelope outranks consistency with earlier copies of a single
document.** A permanently-zero `Less` row is identical on every estimate in every envelope,
so nothing inside a submission looks inconsistent. Removing it would create exactly the
cross-submission difference the rule is meant to avoid, for no gain in the document's
meaning — a zero deduction and no deduction row say the same thing to a reader.

**Recorded so nobody tidies it later without that conversation.** A field that is always
zero and cannot be set looks like dead code to anyone reading `SingleJobEstimateReport` and
not the tender history. It is not dead; it is issued.

If the row is ever removed, it should be at a tender boundary, together with the heading
changes deferred for the same reason — one form change, once, not several small ones.

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

### F19. Blocking setup gaps named the problem but not the way out

Five blocking conditions caused by missing agency setup showed a message and stopped
there, leaving the operator to work out *where* the fix lives — across Agency Settings,
AT Settings, the Divisions & Prefixes tab, the Allotments tab and the Estimate Master.

**Fixed:** one shared `SetupGapDialog` (route, wording shape and unsaved-work handling in
one place — six alerts each growing their own redirect is the "rule applied once"
pattern). It presents only; **callers keep their own guard, so nothing about what blocks
changed**. Converted:

| Condition | Now routes to |
|---|---|
| Allotment exhausted | Agency Settings → that AT → Allotments tab |
| No agency selected | Agency Settings |
| No AT master / none active | Agency Settings → AT section |
| No prefix for division + core type | Agency Settings → that AT → Divisions & Prefixes |
| Scrap charge code missing | Estimate Master |
| Circle approval limit missing | Estimate Master |

**The prefix message was wrong, not merely unhelpful.** It read *"Invalid Job Number
prefix… Expected prefix starting with `JOB-`"* — but `'JOB'` is the **fallback** returned
by `getNextJobNoInfo` when there is no AT master *or* no prefix for that division and
core type. So the message named the job number, which is the one thing that is not
wrong, and sent the operator hunting through job numbers for a problem in agency
settings. It now diagnoses the actual cause first:

- no AT master → *"No AT / tender period is active. Job numbers cannot be generated
  until one is set up."*
- AT active, no prefix → *"No job number prefix is configured for SABARMATI / CRGO under
  AT 26-27."*

each with its own destination. The generic message survives only for a genuinely
mistyped number against a configured prefix.

**Never auto-navigates.** Where the screen holds unsaved work the primary button asks a
second time, naming the row count, and `NewJob` stashes the intake to `sessionStorage`
before leaving and restores it on return — so fixing setup does not cost the operator
their typing. A failed stash never blocks navigation.

**Not converted, deliberately:** a missing *rate* in the master (too many causes for one
route), and a missing external inspection (a data gap, not setup — a different dialog
shape, since the fix is doing an inspection rather than editing configuration).

### F20. A new AT's Divisions & Allotments panel never appeared

Reported as blocking new agency setup: create an AT, and there is no way to enter its
divisions, prefixes or allotments.

**The panel renders only for the ACTIVE AT** (`AtSettings`:
`activeAtMaster?.id === at.id`). Four things combined to leave a newly created AT
inactive, and the panel therefore unreachable for every AT at once:

**1. The activation guard tested the wrong thing.** `addAtMaster` read
`if (!activeAtMasterId) setActiveAtMasterId(newRef.id)` — activating only when *nothing
at all* was stored. But `activeAtMasterId` is a **bare id** while `activeAtMaster` is
**agency-scoped**:

```js
atMasters.find(a => a.id === activeAtMasterId && a.agencyId === activeAgencyId) || null
```

So an id belonging to **another agency** is truthy at the guard yet resolves to `null` at
the derivation. The guard passed, nothing was activated, and no panel appeared. It asked
*"is anything stored"* when it meant *"is anything active for this agency"*. This is the
same shape as the earlier fix that added the agency check to the derivation but left this
guard reading the raw id.

**2. The source was a legacy global localStorage key.** `getInitialAtId()` fell back to
`activeAtMasterId` (global) when no `activeAtMasterId_${agencyId}` existed — seeding state
with **another agency's AT** on first load, which is what made the guard see a truthy
foreign id. Fixing the guard alone would have left the initial state wrong until a later
effect corrected it, with `activeAtMaster` having already resolved `null` in between.

**3. Adding a *second* AT never activated it either** — by then something was active, so
the guard declined. Only the very first AT of the very first agency was ever activated.

**4. The one route in was invisible.** Clicking an AT card calls `setActiveAtMasterId`,
which opens the panel — but nothing on the card said so, and the card does not look
clickable. An operator who has just created an AT and is looking for where to enter
divisions sees no affordance.

**Fixed — five changes, one concept:**

1. `AtSettings` activates the new AT after `addAtMaster` succeeds; `addAtMaster` now
   returns the new id.
2. The guard tests `atMasters.some(a => a.id === activeAtMasterId && a.agencyId === newAt.agencyId)`.
3. Non-active AT cards show **"Select to configure divisions & allotments"**.
4. The legacy global key is no longer **read, written, or listened to** — removed from
   `getInitialAtId`, from `setActiveAtMasterId`, and from the cross-tab storage listener
   (which would otherwise still let another tab push a foreign AT id into this tab).
   `setActiveAtMasterId` now **does not persist at all** when no agency is active: a
   global-only record cannot be attributed to any agency, and restoring it later means
   guessing. Not persisting beats persisting something unattributable.
5. The remaining unfiltered `fetchedAts.find(...)` branch carries a comment recording why
   it is safe — the agency-scoped branch above it handles the real case, and this one is
   reachable only for an agency with no ATs — so its safety is not left to be re-derived
   by whoever next edits the condition above it.

**⚠️ ONE-TIME BEHAVIOUR CHANGE ON FIRST LOAD AFTER DEPLOY — not a new bug.** Anyone whose
AT selection was stored only under the legacy global key loses that selection once. On
next load the fetch effect picks a valid AT **for their actual agency** (preferring one
with status `Active`). This is deliberate: the global key was the leak vector, and a
selection with no agency attached was never restorable correctly — it was applied to
whichever agency happened to load first. Someone noticing their AT selection reset after
a deploy should find this entry rather than treat it as a regression.

### F21. Jobs could be created with no AT attached

`confirmSaveJob` checked `if (!activeAgency)` but never checked `activeAtMaster`, and
wrote `atId: activeAtMaster ? activeAtMaster.id : ''`. A job saved while no AT was active
- the state the cross-agency AT id leak produced (F20) - carried an empty `atId`, and
three things degraded silently:

1. **The AT percentage fell back to an assumed 4%.** `getAtPercentageForCore(null, …)`
   returns `4` on its first line, and that percentage multiplies **every estimate and
   bill for that job**, with nothing on the document indicating it was a default. The
   capacity-defaults shape (F1/F2), reaching money.
2. **The allotment check could not run** - it is gated on `activeAtMaster`. The job
   escaped quota not because the allotment was unset but because there was no AT to check
   against. See A3.
3. **The job number came from the agency-level fallback sequence**, which may belong to
   no AT at all.

The job was then invisible to every per-AT report, since those query
`where('atId', '==', …)`.

**Fixed:** an active AT is now required at the top of `confirmSaveJob`, **before** the
prefix check. It was previously reachable only by accident - `setupGapForPrefix` raises
"No AT / tender period is active", but only when the *prefix check fails*, so an agency
with a usable agency-level prefix saved AT-less regardless. Checking directly means the
condition is tested for its own sake rather than caught as a side effect of another
failing.

Same `SetupGapDialog`, routed to the AT section, naming what would otherwise be assumed.

**Existing AT-less jobs are not repaired by this** - it prevents new ones.
`scripts/job-at-linkage-console.js` lists them with a `hasAnyDownstream` flag, so a job
with nothing estimated, billed or dispatched against it can be deleted safely, and one
with downstream records is corrected instead.

### F22. A new agency's AT was written against the previous agency

Reported as: **AT details entered for a new agency, including the percentages, disappear
after a page refresh.** They were never attached to that agency.

**Not a write failure.** `addAtMaster` awaits `setDoc`, and its catch rethrows, so
`handleAdd`'s `setShowAddForm(false)` is skipped on error — a rules rejection would keep
the form open, not look like success. `ownerId` is set identically to MEGHA's. The three
`atPercentage` fields are present and `Number()`-converted; `|| 0` can turn a blank into
`0` but cannot drop a field, and a negative value survives (`Number('-2.5') || 0` →
`-2.5`), so the negative-percentage change was not implicated.

**A read/filter failure with a write-time cause.** `addAgency` did not activate the
agency it had just created:

```js
if (!activeAgencyId) setActiveAgencyId(newRef.id);
```

Creating a second agency while MEGHA was active left **MEGHA active**. The AT added next
was therefore written with `agencyId: <MEGHA's id>` — a correct, successful write to the
wrong parent. The fetch reads it (it filters on `ownerId` only), but the display filter
`atMasters.filter(at => at.agencyId === activeAgency?.id)` excludes it from the new
agency's list, and it appears under MEGHA instead. The refresh did not lose it; it was
never there.

**Fixed:**
1. `addAgency` activates the agency it creates, unconditionally, and returns its id.
2. `addAtMaster` **throws a named error** on an empty `agencyId` rather than writing an
   orphan — thrown rather than returned, because a silent refusal is indistinguishable
   from the bug it replaces.
3. `AtSettings` guards `activeAgency` before building the payload instead of
   `agencyId: activeAgency?.id || ''`, and surfaces `err.message` rather than a generic
   "Failed to create AT Master".

See the pattern note on scope-specific guards: this is F20's guard shape in a second
collection.

### F23. Inspection `createdAt` moved to the server clock — formatter taught first

Closes A5. Made deliberately as **two changes in a fixed order**, because doing them in
the other order breaks a reader silently.

**The consumer census, done before touching the writes.** Every read of a `createdAt`
anywhere in the app, classified by *which collection's* `createdAt` it reads — because
only `inspections` was changing type:

| Consumer | Collection | Use | Affected? |
|---|---|---|---|
| `Reports.tsx:170` `formatDDMMYYYY(extInsp.createdAt)` | **inspections** | display | **yes** |
| `Reports.tsx:185` `formatDDMMYYYY(intInsp.createdAt)` | **inspections** | display | **yes** |
| `NewJob.tsx:307` `(b.createdAt \|\| 0) - (a.createdAt \|\| 0)` | jobs | arithmetic sort | no |
| `NewJob.tsx:688` past-jobs sort | jobs | arithmetic sort | no |
| `Dashboard.tsx:70-71` `new Date(a.createdAt).getTime()` | jobs | arithmetic sort | no |
| `Reports.tsx:448-449` date fallback chain | jobs | comparison | no |
| `AdminPanel.tsx:77`, `SupportTickets.tsx:40` `b.createdAt - a.createdAt` | supportTickets | arithmetic sort | no |
| `AdminPanel.tsx:631`, `SupportTickets.tsx:207` | supportTickets | display | no |
| `BillingSystem.tsx:689`, `OilInward.tsx:313`, `DispatchChallan`, `TestingReport`, both inspection screens' MR headers | jobs | display fallback | no |
| `duplicate-jobno-console.js:60,115` | jobs | string sort | no |

**Only two consumers touch an inspection's `createdAt`, and both are display.** Nothing
sorts inspections, nothing computes elapsed time from one, and the GP guarantee window
uses `gpDeliveredDate` / the prior job's delivery date — not an inspection stamp. So the
arithmetic hazard the change was checked against **does not exist here**; the risk was
entirely the two display paths. That is worth recording as a *finding*, not a relief: the
census was the only thing that could establish it, and the plausible-sounding fear (a
silent `NaN` in a sort) turned out to be the wrong worry while the real one was a blank
cell.

**Change 1 — `utils.ts`, `formatDDMMYYYY` accepts Firestore Timestamps.** Handled
*before* the string/number/`Date` paths, accepting both the SDK object (`.toDate()`) and
the plain `{seconds}` shape a raw document read can yield, then recursing. Placed first
because `new Date(timestampObj)` is Invalid Date, which since F16 renders as `-` — the
failure would have been a **silent blanking, not a visible error**. Backwards compatible:
existing numeric stamps still take the old path, so records written before and after this
change both render.

**Change 2 — both inspection screens write `serverTimestamp()`.** Still on first create
only, so an edit never restamps. The stored type changes for new records only; old ones
stay numbers, and the formatter now reads both.

**What is not fixed:** existing inspection records keep their client-clock numbers. As
with A4, the gap narrows going forward without ever closing — there is nothing to migrate
*to*, because the true server time of a past write was never recorded.

**Deliberately left alone: `updatedAt` on inspections.** Still `Date.now()`. The census
found it has **no readers at all** — every `updatedAt` consumer in the app reads the one on
`jobs` (`Dashboard.tsx:299`, `Reports.tsx:202`, `blast-radius-console.js:228`) or on
`userRoles` (`AdminPanel.tsx:551`). Changing an unread field buys nothing, and `createdAt`
is the stamp the audit's evidentiary claims actually rest on.

**A hazard this census exposes for later.** `Dashboard.tsx:299` does
`new Date(j.updatedAt).getTime()` — arithmetic, on a **job**. If `jobs.updatedAt` is ever
moved to `serverTimestamp()`, that produces `NaN`, and a `NaN` in a comparator does not
throw: it makes the sort order arbitrary and silently non-deterministic. Strictly worse
than the dash this fix avoided, because there is no wrong-looking output to notice. Any
future timestamp change on `jobs` must start from the same census, and must fix the
arithmetic readers — not only the display ones.

### F24. Divisions & Prefixes made read-only on the agency form — and the coupling that nearly broke on the way

**The authority, settled from the code rather than from preference.**
`getNextJobNoInfo` (`AgencyContext.tsx:701-704`) reads `activeAtMaster.prefixes` when the
AT has any and `activeAgency.prefixes` **only** when it has none. The AT is the source of
truth; the agency copy is a legacy fallback. That matches the domain — divisions and
prefixes are issued with a tender, allotments arrive against that tender over time — so
both belong to the AT. The agency form now **displays** them and routes to the AT to edit,
instead of being a second editor whose writes the first would overwrite.

Changed: the panel resolves its source the same way `getNextJobNoInfo` does and labels it
(*from AT «number»* / *from agency record — legacy fallback* / *none configured*);
allotments are labelled **per cell**, because they resolve per cell
(`NewJob.tsx:1223-1226`) unlike prefixes which resolve as a whole object; two buttons route
via `SetupGapDialog` on the existing `?section=divisions|allotments|at&atId=` params;
with no AT active there is one button, *Set up an AT period*.

Division **Circle Office** stays editable — it is agency routing data, is not stored on the
AT, and `AtDivisions` has no field for it, so this form is its only editor.

#### The finding: the save-time guard and the save-time rebuild were load-bearing together

Removing the inputs forced two consequential changes, and **doing only the obvious one
would have introduced a silent data deletion.**

1. The save began `if (!validation.isValid) { setActiveTab('divisions'); return; }`. With
   the inputs gone that is a **deadlock** — an agency whose stored prefixes are invalid
   could never save *any* field, including its bank account, and the fault has no editor on
   that screen. So the block had to go.
2. The save then **rebuilt** `prefixes` and `allotments` from `divisions` state, keeping a
   division only `if (d.name.trim() && d.prefixCRGO.trim())`.

Each is defensible alone. Together, (1) is the **only thing that made (2) safe**: a stored
division with a blank CRGO prefix is silently dropped by the rebuild, and the only reason
that had never happened is that validation refused the save first. Remove the guard and
keep the rebuild, and **saving a bank account detail deletes a division from the agency
record** — no warning, no visible failure, and the loss surfaces later as a job numbered
`JOB-1`.

Fixed by removing the rebuild too: `prefixes` and `allotments` are now passed through
verbatim from the stored document. Nothing on the form can change them, so the correct
write is the unchanged value. Counter-key seeding is preserved over the same set as before.

**Neither site said any of this.** The guard read as input validation; the rebuild read as
normal form serialisation. The dependency existed only in the fact that one ran before the
other, and was invisible from either. This is the coupling shape from the Recurring theme
again — *two things individually correct that are only safe in combination* — and it is the
second time this session that the dangerous move was **deleting** a check that looked
redundant rather than adding one.

#### Reachability: is any agency now unable to fix prefixes the app is using?

Traced exhaustively, because if the AT screen can always reach them the migration question
is moot regardless of any count.

| State | Live source | Editable? |
|---|---|---|
| AT active, has prefixes | that AT | **yes** — `AtDivisions` |
| AT active, no prefixes | agency (fallback) | **yes** — `AtDivisions` seeds its editor from `activeAgency.prefixes` (`AtDivisions.tsx:14-16`) and saves to **both** (`:89-91`), which also ends the fallback |
| Several ATs, active one has none | agency (fallback) | **yes** — same path |
| An AT exists but is not active | agency (fallback) | **yes** — clicking its card activates it |
| **No AT at all** | agency | **NO** |

**Exactly one unreachable case: an agency with zero ATs.** `AtDivisions` renders only inside
an active AT's card, so there is no AT screen to reach. Its `agency.prefixes` are live —
`activeAtMaster` is null, so `getNextJobNoInfo` uses them — and after this change nothing
can edit them.

**This makes a migration the wrong answer everywhere.** For an agency with any AT the
fallback repairs itself on the first AT save. For an agency with none there is nothing to
copy *onto*. The remedy in the one stuck case is to create an AT, which is exactly what the
button says.

#### Two hazards on the route this fix now recommends — NOT changed, reported

Both pre-date this change; they matter because the new buttons send people down that path.

1. **Creating an agency's first AT restarts every job-number counter at 1.**
   `AtSettings.handleAdd` writes `lastJobNumbers: {}`, and `getNextJobNoInfo` branches on
   `if (activeAtMaster && activeAtMaster.lastJobNumbers)` — `{}` is **truthy**, so the
   populated `activeAgency.lastJobNumbers` in the `else if` is never consulted. An agency
   that has been numbering jobs off its own counters silently returns to 1. Related to O2
   (job numbers not uniquely allocated) and C1 (three collisions): this is a mechanism that
   *produces* collisions, on the path taken to fix a prefix.
2. **`AtDivisions.tsx:41` seeds a hardcoded division** — `SABARMATI` / `21 IS` — when both
   the AT and the agency have none. An operator arriving with nothing configured finds a
   filled-in division that looks entered. Same family as O7's seeded DISCOM identity, and
   the same reason it is dangerous: it renders plausibly.

### F25. Creating an agency's first AT no longer restarts every job-number counter

Found on the route F24 now recommends — *to fix a prefix, set up an AT* — which made it
urgent rather than theoretical.

**The bug.** `addAtMaster` wrote the new AT with `lastJobNumbers: {}`, and
`getNextJobNoInfo` branches on `activeAtMaster && activeAtMaster.lastJobNumbers`. **`{}` is
truthy**, so the populated `activeAgency.lastJobNumbers` in the `else if` was never reached
and every counter read back as 0. An agency that had been numbering off its own counters
returned to **1** the moment its first AT existed — producing duplicate job numbers
immediately, on the first job. This is a mechanism that *manufactures* the O2/C1 collisions.

**Why seeding rather than fixing the read.** The obvious fix — test the read for a
non-empty object — does not work, because the read and the write test different things
(**A6**). Job 1 would be numbered from the agency (47), the increment would still write to
the AT from *its* zero (1), and job 2 would be numbered from the AT (2): the same collision,
one job later and quieter. Seeding puts read and write on the same document from the first
job, which is also the model already used for `prefixes` — the AT is the authority, the
agency copy is the fallback.

**Narrowed to the agency's FIRST AT.** Once an AT exists every increment goes to it and the
agency map freezes, so copying that frozen map into a *second* AT would start a new tender
from an arbitrary old number. A new tender starts its own series — which is what per-AT
counters are for. The staleness objection to seeding is real and applies only from the
second AT onward, and that is exactly where this does not seed. A caller that supplies its
own non-empty counters is left alone.

**Residual risks, stated rather than buried:**
- The map is copied wholesale, including keys for divisions the new AT may not have.
  Harmless — a counter for a division that does not exist is never read.
- The agency map goes stale by design after seeding, exactly as `prefixes` does. It is read
  again only if the AT is deleted or deactivated, where it would be behind. That hazard
  pre-dates this fix and was **worse** before it: the AT previously started at 1, so the
  divergence was immediate and total.
- Two tabs creating the first AT simultaneously could both seed. They would seed identical
  values.

**This does not close O2.** Job numbers are still not uniquely allocated; one mechanism that
produces collisions is gone.

**Retrospective check added** to `scripts/prefix-authority-console.js` (read-only): an AT
whose counters are empty or behind the agency's on the same key, while the agency's map is
populated and jobs exist. It also lists realised collisions and flags those that **straddle
different ATs** — the signature this bug leaves, as against a collision inside a single AT,
which is O2 and a separate renumbering decision. A gap alone is deliberately *not* reported
as proof: an AT legitimately starting its own series at 1 looks identical on those fields.

### F26. `AtDivisions` no longer seeds a hardcoded division

`AtDivisions.tsx:41` pushed `SABARMATI` / `21 IS` when neither the AT nor the agency had
any divisions. An operator arriving with nothing configured found a division that **looks
entered** — no way to tell a placeholder from a configured value, and saving it writes a
real division and a real job-number prefix for a tender that never had one.

Same family as O7's seeded DISCOM identity, and dangerous for the same reason recorded in
the Recurring theme: it renders plausibly. Removed; the panel starts empty and says so.

The empty state replaces the validation banner rather than sitting beside it — *"At least
one division is required"* reads as a fault when it is the starting position, and an error
shown for a normal state trains the operator to ignore errors.

### F27. Estimate masters misfiled per agency — the pricing was right, the data was wrong, and the screen showed a third thing

**Start with the correction, because it is the finding.** The reported fear was that a
Wound Core job in AARATI would price from CRGO item rates. **It would not.** Both the
resolver (`AgencyContext.getEstimateMasterForCore`) and the master screen's own load path
tested the stored Wound Core section for CRGO-card item names and, on a match, silently
skipped it and fell back to Amorphous. So:

| | state |
|---|---|
| **Pricing** | **correct** — falls back to Amorphous, which is correct Schedule-B |
| **Stored data** | **wrong** — AARATI's Wound Core holds a copy of the CRGO card (32 items, scrap at `"18"`); MEGHA's Amorphous is an empty skeleton with scrap at `"1"` |
| **The screen** | **a third thing** — displays the Amorphous content the fallback produced, not what is stored |

**The heuristic repaired the symptom well enough that nobody could see the cause**, for
however long AARATI has been in this state — which is unknowable, because nothing recorded
it. That is the defect. A silent repair of a data fault is a fault that never gets fixed,
and it consumed the only signal that would have prompted anyone to look.

The scrap-charge blocks are what surfaced it, and they were the code working: four scrap
codes exist across two agencies (`22`, `0`, `18`, `1`) while `resolveScrapCharge` insists on
one per core type. **There are not four codes the resolver tolerates — there are four codes
in the data and one in the rule.** Tolerance would have hidden this permanently, and these
codes print on UGVCL documents.

#### 1. `isLegacy` was a blacklist of four strings — the fabricated-value shape in a new position

The test was `itemName` containing `dismental`, `washer ring`, `hv metal` or `lv metal`.
Not a wrong number this time but **a wrong verdict, produced confidently from an incomplete
test**. A CRGO card that happens not to contain those exact words passes as a valid Wound
Core master, and *then* the job really does price from CRGO item rates. The blacklist is
indistinguishable from a real check right up to the case it does not cover — the same
property that makes a seeded GSTIN or a `|| '3'` coil count dangerous.

Replaced by a **positive identity test** (`lib/estimateMasterHealth.ts`): do this section's
item *codes* belong to the CRGO card or to its own schedule, measured against the shipped
defaults, which are the definition of each schedule. The four signature names are folded in
as one input to the score rather than dropped.

**Safety argument, stated because it is load-bearing:** relative to the blacklist the new
test can only newly *reject* a section (a CRGO card lacking the signature words), never
newly *accept* one. **No job's price changes.** The fallback behaviour is deliberately
untouched — it is what keeps pricing correct while the stored data is wrong.

A Wound Core section that merely *equals Amorphous* is **not** reported. Wound Core's
shipped default IS a clone of Amorphous (`estimateData.ts:121`) and the resolver falls back
Wound Core → Amorphous by design, so "equals Amorphous" cannot distinguish a deliberate
sync from a misfiling. The data does not carry that distinction and the check does not
invent one.

#### 2. Both existing checks ran where nobody could see them

This is the part worth generalising. The fault was *detected* — twice, independently, by
two correct checks — and both wrote their conclusion into a fallback decision and nowhere
else. `getEstimateMasterForCore` returns `EstimateItem[]` and has **no error channel**: it
cannot say "the section you asked for is wrong, so I used another one". The screen's load
path had the same shape.

**A check whose output nobody reads is not a check.** Fixed in three parts:

- **An error channel** — `validateEstimateMaster(agency, coreType)` returns named problems.
  Separated from the pricing path so pricing is unchanged. It reads the **stored** section,
  never the resolved one: the resolved list is the fallback's output and looks healthy by
  construction, which is precisely how this stayed invisible.
- **A loud per-core-type block** — `EstimateGenerate` and `BillingSystem` refuse to print
  or export while a core type on the document prices from a misfiled section, naming the
  section, the core type and what is actually in it, and routing to `/estimate-master`.
  Only a *wrong schedule* blocks; a missing scrap code is reported but already blocks where
  it matters, and stopping correct work over a fault that does not affect it would train
  operators to click through blocks.
- **A per-section health line on the master screen** — the fix for this specific failure.
  It reads the stored section and says what is in it, so the misfiling is visible on the
  screen that owns it rather than only in a fallback nobody observes.

Nothing is auto-repaired. Only someone with the tender can say which schedule belongs in a
section, and a confident silent correction is what produced this state.

#### 3. The sync button's feedback did not describe what it did

`handleSyncWoundCoreWithAmorphous` copies **Amorphous → Wound Core**, one way, replacing
every item in the target section. It is one click, cross-section, destructive — and the
message read *"Wound Core master updated to match your saved Amorphous items"*, which names
neither the section read nor the section replaced and parses equally as a merge or as the
reverse copy.

Fixed in the same pass rather than deferred, because it is the same family as the
"Move ALL My Data To Active Agency" button now being removed: an operation whose
feedback does not describe what it did. (That removal is still pending the orphan-job
count, so it has no entry number yet.) The
message now states the direction, the item counts before and after, that Amorphous is
unchanged, and that nothing is saved yet. The tooltip says the same.

**Not fixed, and the user's to do:** the misfiled masters themselves. The code now makes it
obvious which section is wrong; it does not decide what belongs there.

### F28. "Move ALL My Data To Active Agency" removed — an unscoped irreversible write with feedback that could not describe it

Removed: the button, its "Data Tools" card, `handleMigrateData`, the `migrating` state, and
the Firestore/auth imports it alone used. It had exactly one caller, so leaving the handler
would have left dead code that reads as a feature.

**Its label described a narrow symptom; its action was unscoped.** The card said *"Use this
if your older jobs are not showing up in the current agency"*. The query was
`where('ownerId','==',uid)` over `jobs` with **no agency filter**, updating every job whose
`agencyId` differed from the active agency. It did not rescue stranded jobs — it reassigned
**correctly assigned jobs belonging to other agencies**. It dated from before `agencyId` was
reliably set at creation, which is no longer the case.

**Three defects found while checking it, each independently disqualifying:**

1. **Unscoped and irreversible.** With several agencies it collapses all of them into
   whichever is active, with no undo and no record of what moved.
2. **The batch flush was not awaited.** `if (count === 450) { batch.commit(); ... }` — no
   `await` — and `count` was then reset to `0`, so the trailing `if (count > 0) await
   batch.commit()` could skip the tail. Over 450 jobs it can **partially apply**. This is a
   data-integrity defect inside an irreversible bulk operation and is recorded on its own
   account, not as a footnote to the removal: the pattern outlives the code.
3. **Success was reported from a number it never measured.** The alert printed
   `snapshot.docs.length` — *all* jobs — not the count actually written. So a no-op and a
   full sweep produce the same message, and a partial application produces a confident
   complete one.

Together (2) and (3) are the worst arrangement available: an operation that can partly fail,
reporting success by a figure unrelated to what it wrote. **Not a wrong value this time but
a wrong reassurance** — the same shape as the seeded defaults in the Recurring theme, moved
from data into feedback. It is also the family the sync-button message in F27 belongs to:
an operation whose feedback does not describe what it did.

**Checked before removing, because the removal had to not cost a remedy.** This was the only
thing in the app that could reach a job whose `agencyId` was empty or pointed at a
non-existent agency — such a job is invisible to every agency-scoped view, so no screen can
correct it. `scripts/orphan-jobs-console.js` (read-only) counted that population:
**0 of 44 — nothing stranded.** Nothing was lost by removing it, and no targeted replacement
was built, because building a repair for an empty set is speculative work.

**The live demonstration.** Before removal it had already run: all 44 jobs were reassigned to
AARATI TRANSFORMER, which is what surfaced the attribution shift. That is the hazard
demonstrated, not an argument the button was useful. Recovery is possible only by luck — it
touched **only** `jobs`, so `inspections.agencyId`, `oilTransactions.agencyId`, `atId` and
the job numbers all survive as independent witnesses to the original attribution
(`scripts/reverse-bulk-move.js`, dry-run by default, writes `agencyId` and nothing else). A
version that had also swept the side collections "for consistency" would have destroyed the
evidence needed to undo it.

### F29. Estimate master: rows can be deleted safely, and publishing cannot broadcast a fallback

**Delete was not missing - it was invisible.** `handleDeleteItem` and a per-row trash button
already existed, but the whole column rendered only when `editingSection === sectionKey`. A
master that can gain rows but never lose them accumulates wrong data permanently, and this
one looked exactly like that. The column now renders in both modes, disabled outside edit
mode with the reason in the tooltip.

Two protections it never had:

- **Confirmation naming the row** - item code and description, because "Delete this item?"
  is answerable without knowing what is about to go. It also says the change is unsaved
  until Save, which is the difference between a mistake and a disaster here.
- **A guard on the resolver's scrap code.** Deleting the last row carrying `"22"` (CRGO) or
  `"0"` (Amorphous / Wound Core) does not fail at the click - it fails later, in
  `resolveScrapCharge`, when a scrap bill is produced. Blocked, with a message naming the
  code and what it prices. Allowed when another row already carries the same code: the
  guard is about the code surviving, not about that particular row.

**The health line now separates STORED from SHOWING.** It previously reported only the
stored section - correct for detecting a misfiling, wrong while someone is editing, because
it describes a state the operator is in the middle of leaving. It now shows both when they
differ, and distinguishes the two reasons they can:

- *unsaved edits* - "Nothing is written until you click Save", plus what the section would
  look like after saving, so a pending deletion that removes the scrap code is visible
  **before** the save rather than at bill time;
- *fallback-resolved* - "the stored section holds N item(s); what you see was resolved from
  a fallback section. Saving would write what is shown here into the stored section."

That second case is the one that matters, because it is how the misfiling spread.

**Publish guard.** `handleConfirmSaveSection` (scope ALL) and `handleExecuteFullSync` now
refuse when any section being published is fallback-resolved - stored data absent, or
holding the wrong schedule. Publishing writes the on-screen content into **every** agency
and into `public_config`; publishing a fallback would install the substituted content as
the shared baseline for all of them. That is F27's finding (c)(1) at six times the blast
radius, and the health line already knew the difference - it just was not consulted at the
one moment it mattered most.

The test is deliberately **not** "the screen differs from stored", which is also true of
ordinary unsaved edits - precisely what publishing is for. It is "the stored section could
not have produced what is on screen". The message names each offending section and says the
stored data must be corrected first.

Untouched, as required: `getEstimateMasterForCore`, `resolveScrapCharge`,
`SCRAP_ITEM_CODE_BY_CORE_CLASS`, and every printed layout.

### F30. New agencies no longer inherit another agency's estimate master — the propagator

Three of four agencies held **identical** 32-item CRGO cards in their Wound Core section.
Identical content across agencies is the signature of a copy, not of repeated human error,
and there were two mechanisms.

**Origin, historical and already gone.** Before commit `6282d3f` (18 Aug 2026) there was no
`defaultWoundCoreEstimateData` at all, and `getEstimateMasterForCore`'s Wound Core branch
fell back `estimateMasterWoundCore → estimateMasterCRGO → estimateMaster →
defaultEstimateData`. **Every one of those is the CRGO card.** So a Wound Core section with
nothing stored resolved to the CRGO card, the master screen displayed it in the Wound Core
slot, and any save persisted it there. Not four mistakes — one systematic fallback.

**The propagator, live until now.** `addAgency` seeded a new agency's sections from
`globalDefaultEstimateMaster ?? activeAgency ?? shipped default`. The middle term is
**whichever agency happened to be selected at the moment of creation**. Create an agency
while one holding the CRGO card is active and the new agency inherits it verbatim — which is
why the copies match exactly. Nothing recorded which agency was the template, so the
provenance is unrecoverable: the same class as the seeded DISCOM identity in **O7**, and the
same reason it is bad — a value that looks configured but was inherited from an arbitrary
neighbour.

Fixed: a new agency inherits the **published shared default or the shipped defaults**, never
another agency's data.

**Second bug at the same site: `arr || fallback` is wrong for arrays.** `[]` is truthy in
JavaScript, so an *empty* stored section was used in place of the shipped default rather
than falling through. Everywhere else in this file the test is `arr && arr.length > 0`. Both
occurrences are fixed — `addAgency`, and the `enrichedAgencies` fallback where
`fetchedGlobalMaster?.estimateMasterX || default` had the same shape. A swept check found no
others; the remaining `|| {}` cases are on objects, where the idiom is correct.

#### The finding that corrected a check shipped in F27

While sweeping for the array bug: `enrichedAgencies` (`AgencyContext`) **fills every empty
section with the global or shipped default before the agency object ever reaches a
component.** After enrichment no agency in memory has an empty or missing section.

So `activeAgency.estimateMasterWoundCore` is the **resolved** value, never the stored one —
and the F27 health line, which claimed to read "stored" precisely so it could see past the
fallback, was reading the fallback's output. An empty section would have rendered as
healthy. The scorecard script was right and the in-app panel was wrong, because the script
reads Firestore directly and the panel read the context.

**This is the F27 defect committed a second time, by the fix for it.** The fallback that
hides the fault turned out to have a second layer, one call earlier, and "read the stored
field" was not the same thing as "read what is stored". The lesson generalises past this
file: *when a check exists to see past a fallback, verify which layer its input came from* —
naming a field is not evidence about its provenance.

Fixed by carrying the raw Firestore values alongside as `__storedMasters` and reading those
via `storedSection()`. The enrichment itself is untouched, because pricing reads those
fields and changing it would change prices.

### F31. Overhauling: an empty section is the correct state, and is no longer reported as a gap

There is **no separate Overhauling schedule**. An OH job prices through `resolveRate`
(`SingleJobEstimateReport.tsx:312`), which looks the item up in the master by code and
otherwise falls through to **UGVCL Schedule-A**. The shipped `defaultOverhaulingEstimateData`
is five items with every rate `null` — a rate-**override** shell, not a schedule. With
nothing stored, every OH rate comes from Schedule-A, which is the tender.

So "the Overhauling section is empty" was reporting a non-problem. The `isEmpty` rule was
written for Amorphous and Wound Core, where empty means the schedule is missing, and was
applied to a section where empty is normal. An error shown for a normal state is worse than
no error: it trains the operator to ignore the panel on the one section where it is always
wrong.

The section now reports positively — *"Nothing stored, which is correct. Overhauling holds
optional per-item overrides of UGVCL Schedule-A; with none stored, OH jobs price straight
from Schedule-A."* — and an empty Overhauling section no longer trips the publish guard.

### F32. The "corrupted" Amorphous sections were a former shipped default — inert, but one keystroke from real

**CLOSED, no money impact.** Three agencies (MEGHA, DRISHIV, suchit) held a 10-item
Amorphous section whose descriptions were character-identical across all three. Not three
mistakes and not a corruption: it is the **original `defaultAmorphousEstimateData`** from
commit `1f1e735`, a placeholder that shipped as the default, was seeded into agencies, and
was left behind when the default was replaced with the real 13-item Schedule-B list.

**Identified by a code-only fingerprint, not by text.** The placeholder carries a bare item
code `1d`; the real default uses `1d-1` and `1d-2`. So affected sections are detectable
without relying on description matching, which is what let `public_config` and AARATI be
cleared confidently (12 items, `1d-1`/`1d-2`, 100% own codes) while the other three were
identified.

**The two numbering schemes collide on the same codes:**

| code | placeholder says | Schedule-B says |
|---|---|---|
| `1a` | Repairing of **25 KVA** Transformer (AL) | **10 KVA** Aluminium winding |
| `1b` | Repairing of **63 KVA** | **16 KVA** |
| `1c` | Repairing of **100 KVA** | **25 KVA** |
| `1e` | Repairing of **200 KVA** | **100 KVA** |
| `6` | Labour charge per transformer | Rate for **sealing of uneconomical unit** (Rs 189) |

This is not a one-band shift inside a single scheme — it is two schemes assigning different
meanings to the same codes. The repair is replacement, not relabelling.

**Nothing was ever mispriced.** Verified by dumping every rate in all three sections:
**0 values greater than zero.** `resolveRate` prefers a master rate only when it is `> 0`
and otherwise falls through to UGVCL Schedule-A, so every Amorphous line on every estimate
and bill came from Schedule-A regardless of what these labels said. The placeholder shipped
with `defaultRates` all `null` and four entries at `0.00`, and in a year nobody typed into
it.

#### The finding: it was inert only because nobody typed into it

**The exposure was one keystroke away, for a year — on the BILL, not the estimate.** See
**O16**: the estimate never reads this master for Amorphous, but `calculateJobTotal` does, so
the keystroke below would have moved a bill total and not an estimate total. The original
version of this entry did not distinguish them.

A rate entered against the row labelled
*"Repairing of 25 KVA Transformer (AL)"* would have filled item code `1a` — which
Schedule-B defines as **10 kVA**. A correct-looking entry, in the right-looking row, under
the wrong code, pricing from that moment on and looking right on the printed estimate.

That is the difference between this and every other entry in this audit: the others are
faults that **had** happened, found by their consequences. This one had no consequences to
find. It was discovered only by asking what the section contained, and it would have been
discovered by its consequences the first time someone maintained it — which is the one
moment a master is *supposed* to be edited.

A latent fault of this shape cannot be found by looking for damage. Only by reading the
data and asking whether it means what it says.

#### Related: the scrap item codes were never chosen — they were assigned by row position

Found while working out the repair steps. `handleAddItem` sets
the new item code to `data.length + 1` — **a row's code is its position in the list**. So:

- adding a scrap row to an empty section produces code `"1"` — MEGHA's Wound Core;
- adding one to a 17-item section produces `"18"` — AARATI's Wound Core, and the same `"18"`
  that `SCRAP_ITEM_CODE_BY_CORE_CLASS` records CRGO as having been *moved off* because it
  collides with "Repl. Of Tank".

So the four scrap codes across two agencies (`22`, `0`, `18`, `1`) are not four decisions
that need reconciling. Three of them are **row numbers**. That strengthens the standing rule
not to make the resolver tolerant of what it finds: tolerance would enshrine an artefact of
insertion order as tender data, on documents that go to UGVCL.

Not changed — auto-numbering by position is a defect in its own right and is recorded here
rather than fixed mid-repair.

### F33. New estimate-master rows no longer arrive with a code invented from their position

`handleAddItem` set `itemCode` to `data.length + 1` — **a row's position, presented as its
identity**. Confirmed live: adding to a 13-item Amorphous gave `"14"`, to a 32-item CRGO
gave `"33"`. It is where three of the four scrap codes in this database came from (F32):
`"1"` is row 1 of a then-empty section, `"18"` is row 18 — including the `"18"` that CRGO
was deliberately moved off because it collides with "Repl. Of Tank".

**A blank field asks a question; an auto-filled one asserts an answer** — and here the
answer is wrong by construction, in the field that identifies a priced line on a UGVCL
document. New rows now arrive with an empty code.

**Checked before changing it: nothing depends on a new row having a code immediately.**
`resolveRate` and `resolveScrapCharge` both look codes up with `.find()`, so a blank never
matches; `checkMasterSection` and `withMissingDefaults` filter empty codes out; the table
keys rows by index. A half-entered row affects nothing while it sits there.

**Saving it is the problem, and duplicates are the worse half.** `.find()` returns the
FIRST match, so a second row carrying an existing code is silently unreachable — it renders,
it can be edited, it can be given a rate, and it prices nothing. That is indistinguishable
from a rate that did not take effect, which is the failure mode this audit keeps finding.

So validation sits at the save boundary, not at the keystroke: every entry point that writes
a section — the per-agency save, the publish modal behind it, and the "Save All" button,
which bypasses the first two — refuses while any row has a blank or duplicated code, naming
the rows. Blank and duplicate codes are also marked in the row itself (amber and red), so
the fault is visible where it is created rather than only in an alert at save time.

### F34. Publishing sends stored data, not the screen's normalised view

**The defect.** `handleConfirmSaveSection` and `handleExecuteFullSync` published component
state — `woundCoreData`, `amorphousData`, `crgoData`. That is the **post-normaliser** view:
`normalizeAmorphousOrWoundCoreData` clones in any default row the stored section lacks,
reorders to default order, forces units to `QTY` and backfills `fixedRate` (O11). So every
publish this repair was building toward would have broadcast **rows nobody authored** into
all four agencies *and* into `public_config` — which then seeds every future agency (F30).

Concretely: MEGHA's Wound Core stores 13 rows; the screen shows 14, the extra being a `"0"`
scrap row cloned from the default because storage lacks it. Publishing would have made that
phantom real in four places at once.

**The fix.** A section publishes **what is stored** when the operator has not edited it, and
**what is on screen** when they have — because that is what they chose, normalisation and
all.

The edit test is deliberately *not* "the loaded data differs from storage". That is true of
almost every section almost always, precisely because the load normalises; using it would
classify everything as edited and the distinction would do nothing. `editedSections` is set
only by an actual operator action — a cell edit, add, delete, a reset, the Amorphous → Wound
Core sync — and cleared on load and after a successful publish.

**The dialogs now say which, in rows.** *"Publishing the 13 Wound Core row(s) STORED for
MEGHA - not the 14 shown on screen"*, against *"Publishing your 14 edited row(s), 1 of which
was added automatically and is not in storage: "0""*. The all-sections modal prints one such
line per section, and its existing item counts are relabelled *"Rows currently on screen (not
necessarily what is published)"*. A distinction the operator cannot see is a distinction that
does not exist for them.

**Severity of what was avoided, stated honestly.** For Amorphous and Wound Core the merged
rows price nothing today — those core types take every repair rate from the hardcoded
`SCHEDULE_B` table, and the master supplies only the scrap row. CRGO's normaliser
(`mergeDefaultRates`) only adds absent rate keys as `null`, changing no value. So this was
not a live mispricing. It was the broadcast of unauthored data into the document that seeds
every future agency, which is permanent in a way a wrong rate is not.

### F35. The "not what is stored" band no longer guesses why

The band added in F29 branched on `isEditing` alone and told everyone else *"what you see was
resolved from a fallback section"* — **a confident verdict from a test that never examined
the cause**, inside the panel built to expose exactly that pattern. Since `differs` is true
of nearly every section (the load normalises), it would have gone on asserting "fallback"
about sections that were completely correct — including MEGHA's Wound Core immediately after
its scrap code is fixed.

It now distinguishes three causes and says which:

| cause | test | wording |
|---|---|---|
| **edited** | the operator changed it | "Showing your N edited row(s) - not saved" |
| **fallback** | nothing usable is stored, or the section holds the wrong schedule | "Showing N row(s) from a FALLBACK section" |
| **normalised** | stored is fine; the display merged defaults in | "Showing N row(s) - stored M, the rest filled in for display" |

The normalised case also names the specific rows that are not in storage and warns that
saving would make them real — which is the fact an operator needs before pressing anything,
and the one the original band obscured by asserting something else.

### F36. Two agencies share a name across owners — a repair was verified against the wrong document

Every visible symptom said the copy script had failed on one agency: the scorecard read
Firestore and reported the repaired sections; the Estimate Master screen, after a full
reload, showed the unrepaired ones. Neither "the write did not land" nor "the screen is
stale" was true.

**Two different agencies are named "suchit", under two different accounts.** The four
repaired agencies belong to `utparekh007`; the admin account owns its own `SUCHIT` and
`UPENDRA`. The repair ran signed in as the owner; the screen was being read signed in as the
admin. Both were showing correct data — about different documents.

**Why the script's guard did not catch it.** `pick()` refuses when a name matches more than
one agency. But it searches `agencies`, which comes from
`query(collection(db,'agencies'), where('ownerId','==',uid))`. Within one owner's list
"suchit" is unique, so the guard passed. **The guard was not weak — its scope was the query,
not the domain**, and nothing in the code said which population it was asserting uniqueness
over.

Fixed in both write-capable scripts that resolve by name:
- `SOURCE_AGENCY_ID` / `TARGET_AGENCY_IDS` take precedence, so work can be done by document
  id, which cannot be ambiguous;
- every resolution logs `name  id=…  owner=…`, so the log never identifies a document by
  name alone;
- the visible-agency list prints ids, with an explicit note that another account may own
  agencies with the same names and that this list cannot show them;
- ambiguity messages list each candidate's id and owner rather than just the count.

`fix-public-config-master.js` needed it more than the copy script, not less: it reads **all**
agencies as super admin, so the name space it searches is larger than any single owner's —
a name match there is strictly more ambiguous than the same match made owner-scoped.

**Nothing was wrong with the repair.** The cost was an hour of chasing a cache that did not
exist. The lesson is the diagnostic one: three explanations were on the table and all three
were wrong, because each assumed the two observations described the same object. The check
that settled it printed **document ids** beside names and showed which id the screen was
pointed at — `scripts/verify-agency-masters-console.js`.

### F37. Issued documents now record the agency that issued them

Closes O14. `issuedByAgencyId`, `issuedByAgencyName` and `issuedByAgencyGstin` are written
in the **same batch** as the document field, at **every** issue point.

**Five Firestore write sites, not three**, because each issue point has two paths — a quick
save and a full send dialog — and both write the document field:

| Document | Firestore batch | paired local state |
|---|---|---|
| Estimate — quick save | `EstimateGenerate.tsx:755` | `:783` |
| Estimate — send dialog | `EstimateGenerate.tsx:900` | `:932` |
| Bill — quick save | `BillingSystem.tsx:1023` | `:1053` |
| Bill — send dialog | `BillingSystem.tsx:1153` | `:1192` |
| Challan — dispatch | `DispatchChallan.tsx:401` | `:428` |

Stamping only the dialogs would have left the quick-save paths producing exactly the state
the field exists to prevent. The paired local-state updates carry it too, so the in-memory
job matches what was written — otherwise the operator who just issued a document would see
it, until the next reload, with a document number and no issuing agency.

**Name and GSTIN are stored alongside the id, not just the id.** The id resolves to whatever
the agency record says *now*; a document names a supplier as it read *then*. An agency that
is later renamed, or whose GSTIN is corrected, must not retroactively change what an issued
invoice is recorded as having said.

No rules change needed: `isValidJob` asserts only about fields it names and does not reject
unknown ones — checked rather than assumed.

#### The part that matters more than the field: the 36 reversed jobs were NOT backfilled

Their `agencyId` is now correct **by reconstruction, not by record**. Stamping
`issuedByAgencyId` from it would **launder an inference into an assertion** — a field whose
whole purpose is to say "this is what the document recorded" would, for those 36, say "this
is what four witnesses agreed the document probably recorded", and nothing downstream could
tell the two apart. That is the seeded-value shape exactly: a plausible entry, indistinguish­able from a real one, in the field meant to be authoritative.

**Their absence of the field is itself correct and should be preserved.** It means "issued
before the issuing agency was recorded", which is true, and it is the signal that points a
future reader at the printed document rather than at the database. A backfill would delete
that signal while appearing to improve the data.

The general rule, worth keeping: **when adding a field that asserts a historical fact, do
not populate it for records that predate it.** An empty field says "unknown"; an inferred
one says something false with the same confidence as a true one.

### F38. Agencies and ATs now record a server creation time

Closes the forward half of **A4**. `addAgency` and `addAtMaster` write
`createdAt: serverTimestamp()`.

**It had blocked two separate questions before it was worth fixing**, which is what settled
it: *"which AT is the newest"* while diagnosing a misattached one, and *"which agencies
predate the `public_config` correction"* during the cross-owner census. Both fell back to
proxies — `startDate`, which is a tender date an operator types (two ATs created a month
apart can share one, and a later-created AT can start earlier), and the earliest job under
an agency, which says nothing about an agency with no jobs.

`serverTimestamp()` rather than `Date.now()` for A5's reason: a stamp from the same browser
clock as everything it would corroborate cannot corroborate anything. `formatDDMMYYYY`
already reads Firestore Timestamps (F23), so no reader needed changing — and none existed
anyway, the field having never been written.

**Not added to the local state objects.** `serverTimestamp()` is a sentinel, not a value;
putting it into React state would place a `FieldValue` where a date is expected. Absent
locally until the next fetch is the honest state, and nothing reads it in that window.

No rules change needed: `isValidAgency` and `isValidAtMaster` assert only about fields they
name and do not reject unknown ones — checked, not assumed.

**Not retroactive, and deliberately so.** Existing agencies and ATs stay undated forever;
there is nothing to migrate *to*, because their true creation times were never recorded.
Inferring one would be the F37 mistake — an inference asserted as a record. The gap stops
widening, which is the only thing still available.

`find-misattached-at-console.js` now prints `createdAt` beside `startDate`, showing
`(not recorded - predates F38)` where absent, so a real creation order can be read directly
where one exists and is visibly unavailable where it does not.

### F41. Four raw ISO dates, found by sweeping fields rather than symptoms

Reported symptom: the printed tax invoice showed `2026-08-14` in the Chalan Date column
while Bill Date and Order Date, two columns away on the same document, read `23-08-2026` and
`03-02-2026`.

**The reported site**, `BillingSystem.tsx:2960` — the invoice line-item Date column:
`{job.deliveryDate || job.challanDate || billDate}`, three unformatted values. All three are
ISO: the first two come from the challan's date inputs, and `billDate` is initialised as
`new Date().toISOString().split('T')[0]`.

**Three more the symptom did not name**, all in the Sent Bills / payments views:
`:2068` (`billSentDate` in the register table), `:2225` (`paymentDate` in the payment row),
`:2239` (`billSentDate` on the sent-bill card).

All four now route through `formatDDMMYYYY`, which returns `-` for an absent value, so the
`|| '-'` fallbacks each site carried are subsumed rather than duplicated.

**Why the extra three were found.** Two passes were run: one over JSX expressions that look
date-shaped, and one over the seventeen date FIELD NAMES themselves, excluding lines that
already call the formatter. The second pass is the F18 lesson applied — *a site that never
called the formatter cannot be found by searching for calls to it* — and it is what turned
up `paymentDate`, which the reported symptom had no way to point at.

**A limitation stated rather than assumed away.** Both passes are line-based, so a date
rendered inside a JSX expression split across lines would escape them. The invoice, challan
and estimate table bodies were read directly to cover that, but reading is weaker evidence
than a pattern match, and F18's whole lesson is that a sweep can be complete against its own
definition and still miss the case.

#### CORRECTION — F41's completeness claim was false, and the reason matters

F41 stated that both passes "found `:2960` and nothing else in a printed document". **That
was wrong.** A third report found `Dated 2026-08-23` on the printed CERTIFICATE page
(`BillingSystem.tsx:2799`), a site in the same file, in a printed document, that F41 declared
clear.

**The search reached it. The triage lost it.** The field-name pass DID surface line 2799 —
it is in the output F41 was written from. That output was truncated to 135 characters per
hit for readability, and at 135 characters the line ends twenty characters before
`{billDate}`. What remained looked like a bill-NUMBER sentence, so it was dropped, and not
even listed among the rejections.

**The shape of the error, which is the transferable part:** F41 asserted completeness
*"in a printed document"* when what it had actually established was completeness *within
what the method could see* — and the method's reach had been narrowed after the fact by a
display truncation. **A claim scoped to the tool, stated as though scoped to the domain.**

That is the same defect as the `isLegacy` blacklist (four substrings, verdict stated as "is
this the CRGO card") and the `KNOWN_SCRAP` list (four codes, verdict stated as "is there a
stray scrap row"), now applied to a claim about *coverage* rather than about data. Each was
a confident conclusion from an incomplete test; this one was a confident conclusion about
how complete a test had been.

**Left as a correction rather than an edit.** The original claim is above, wrong, with this
underneath — because the next sweep will be tempted to make the same assertion, and an entry
quietly rewritten to be right teaches nothing.

**Working rule added:** never truncate the output a sweep is triaged from. Print the whole
matched line, however ugly. The evidence that decides a hit is as likely to be at column 150
as at column 10.

**The third pass, done by VALUE ORIGIN rather than by field name or formatter call:** find
every expression that can *produce* an ISO string (`toISOString`, `split('T')[0]`,
`slice(0,10)`), name the variables they flow into, then find every render of those variables
anywhere — prose, attribute or bare. Ten carriers across five files; eleven renders; **one
raw**, `:2799`, now fixed. Every other render of an ISO carrier already calls the formatter,
including `:2997`, which prints the same value in the same `Dated` sentence two hundred lines
below the broken one — the pattern was copied and the formatter added, but the original never
had it.

**Not changed, and correctly so:** thirteen `value=` bindings on date controls (ISO is
required by `<input type="date">`), six `.xlsx` filename stamps, and four
`new Date().getFullYear()` renders. See the note in the F18 pattern entry on why a
field-name sweep returns these, and on `approvalDate` holding a non-date.

### F42. New ATs continue the agency's job-number series instead of restarting it

Closes **O2**'s open question, and the answer came from the domain rather than from
preference: **prefixes belong to the division and the agency, not to the tender period.**
"21 IS" is the same before and after a rollover, so the number after it must continue — a
restart reissues "21 IS-1" for a different physical transformer, which is how **C1**'s
collisions arose. F25 already seeded the FIRST AT of an agency from the agency's counters,
so continuation was established at one boundary and absent at every later one. That
asymmetry was a bug, not a design.

**Seeded from actual job numbers, not from the counters.** `lastJobNumbers` is a *cache* of
a fact that lives in the jobs collection, and it can sit low in ways the cache cannot see:

- the real allocator (`NewJob`'s save transaction) only moves a counter **up to** the
  highest number in that intake — it reconciles, it does not allocate;
- it writes only when an AT or agency document resolved, so any job saved with no active AT
  advanced nothing;
- `incrementJobNoCounter` looks exactly like the allocator and has zero call sites (**A2**).

Seeding from the cache would inherit all three gaps, and the failure would be the precise
one this exists to prevent. So the seed is the **max of both** — every stored counter across
that agency's ATs and its agency record, AND the numeric tail of every job number found for
that agency — which can never be lower than either alone.

**Per counter key, across every AT — not from the most recent one.** An AT created later but
used less would otherwise lower the series.

**Both the `${div}_CRGO` and the bare `${div}` key are seeded from the same maximum.**
`getNextJobNoInfo` reads one and falls back to the other for CRGO only; seeding one would
let CRGO restart independently while every other core type continued — the legacy split
producing a partial failure that looks like a whole success.

#### Unparseable job numbers: report and proceed, never block

A job number with no trailing digits cannot be continued from. Those are **counted, listed
verbatim, and shown to the operator creating the AT** — in the AT panel, not a console log,
because the person creating the AT is the person who needs it. The message states the
consequence in plain terms: the starting number for the named division may be lower than the
highest already issued, **and a duplicate will be refused at save if it occurs.**

That last clause is the point. It tells the operator the failure is *caught* rather than
silent, which is the difference between a warning they can act on later and one they must
act on now. Blocking AT creation instead would stop a time-sensitive rollover over a
historical record nobody can change — the wrong trade: a slightly low seed costs one refused
save, while a block costs the agency all intake.

A failed seed query is caught and warned, never fatal, for the same reason.

### F43. A new AT's percentages are pre-filled from the previous one, visibly

Skipping the AT percentages was the remaining **silent** wrong result on the rollover path:
`getAtPercentageForCore` falls back to `4`, and every estimate under that tender prices at
it while looking correct.

**Not fixed by inheriting the value at write time.** An inherited percentage is *more*
dangerous than the placeholder it replaces: 4% is obviously unset, whereas last year's 8%
looks deliberate. That is the F1 shape — a plausible value indistinguishable from a
configured one — and applying it behind the operator would have made the defect harder to
see, not easier.

Instead the **create form is pre-filled** from the agency's most recent AT, with a panel
above the fields stating where the numbers came from and that they are a starting point
rather than defaults: *"check them against the new tender before creating. A carried-over
percentage prices every estimate under this AT and looks deliberate whether it is or not."*

The values are therefore on screen before submission and are chosen by the act of
submitting. The general rule: **when a default would be indistinguishable from a decision,
put it where the decision is made rather than where the write happens.**

### F44. The estimate master records when it was last edited, and reprints say they are recalculations

Two small changes, both correct regardless of how the per-AT-master question is settled.

**1. `estimateMasterEditedAt` / `estimateMasterEditedBy`.** Every per-agency master save now
stamps them. Without this, *"was this estimate produced before or after the rates changed"*
is **unanswerable** — and that question decides whether a figure on an issued document can
still be reproduced. `updatedAt` on a job is a different fact; the agency record carried no
stamp for its master at all.

`serverTimestamp()`, for A5's reason: a stamp from the same browser clock as the thing it
dates cannot corroborate it. `formatDDMMYYYY` already reads Timestamps (F23).

The name is scoped on purpose — **`estimateMasterEditedAt`, not `updatedAt`.** The agency
record holds a dozen unrelated things, and a generic name would be read as "the agency
changed" and would be wrong the moment someone edits a bank detail. Shown on the master
screen itself, because the question it answers is asked while looking at the master.

**2. The reprint warning.** A reopened estimate or bill that has already been sent now says
so on screen:

> *Already sent — this is a recalculation, not the copy that was issued. Amounts below are
> worked out from the estimate master and AT percentage as they are now. If either changed
> since the estimate was sent, this will differ from the document on file. **The copy on file
> is what was sent.***

This addresses the genuinely misleading half of the problem. A reprint has always been a
recomputation — the master can have been edited since, and the AT percentage follows the AT
currently *selected* rather than the one the job was booked under — and nothing said so, so
a differing reprint read as an error in one document or the other rather than as two
correct answers to different questions. Same class as F37's finding that a reprinted invoice
takes its letterhead from the current session.

**Screen only, `print:hidden`.** A caveat printed onto a document going to UGVCL would be
worse than the ambiguity it describes.

**What this does NOT fix**, and is deliberately left: an estimate for a job booked under one
AT and produced after another became active is still priced at the active AT's percentage.
The warning makes the recomputation visible; it does not make it right. That is the open
question about whether the master should be per-AT at all — which turns on whether UGVCL
reprices by changing item rates or only the percentage, and is being checked against the
tender rather than guessed at here.

### F45. Inspections could not be saved at all — and every Firestore failure was silent

Two defects, one mine and one long-standing. The second is the more important.

**1. The rules reject a Timestamp `createdAt` on an inspection.** `firestore.rules:96`
requires `createdAt` to be `number` or `string`. F23 changed both inspection screens to
`serverTimestamp()`, which resolves to a Firestore `Timestamp` — neither — so
`isValidInspection()` returned false and **every new inspection was denied**.

It looked intermittent rather than broken because `createdAt` is written on FIRST CREATE
only (`if (!jobData.inspectionId)`): edits to existing records carried no `createdAt`, passed
validation, and saved normally. New inspections did not.

**Reverted to `Date.now()`** rather than widening the rule — a rules deploy in the middle of
a save outage is the wrong order of operations, and the property lost is smaller than it
looked: `inspectionDate` is operator-entered anyway, so a server-stamped `createdAt` sits
beside a hand-typed date and corroborates nothing on its own. Widening the rule can be a
deliberate change later.

**How it got in: the check existed and was not carried back.** See the pattern note above —
F38 checked the rules for the same change to agencies and ATs, and recorded that it had. F23
predated that check and never received it.

**Data:** nothing was written and nothing was corrupted. Inspections entered today were lost
unless the form was still open.

#### 2. Every Firestore failure in the app was invisible — this is the wider defect

`handleFirestoreError` logged to the console and **rethrew**. Every caller wraps it in a
`catch`, so the rethrow escaped as an **unhandled rejection**: no message, no state change,
the spinner simply stopped. The screen was indistinguishable from a successful save.

**That was true of every write in the app**, not only inspections. The inspection bug is
merely the first failure common enough to expose it — and an operator who had just typed a
full inspection saw a form that looked saved and navigated away from data that was never
written.

Now it shows a message naming **what failed and, first, that nothing was saved**:

> *Could not update the database.*
> ***NOTHING WAS SAVED. Your entry is still on screen - do not navigate away until it
> saves.***
> *The database refused the write. This usually means a field is in a shape the security
> rules do not accept, or you are signed in as an account without access to this agency.*

Deliberate choices: the **consequence leads**, because "is it safe to leave this screen" is
the only question the operator actually needs answered, and a generic "an error occurred"
does not answer it — an operator who cannot tell will assume the save worked, because it
usually does. Read operations get different wording (*"what you see may be incomplete"*),
since nothing was at risk. Firestore error codes are translated rather than shown;
`permission-denied` tells an operator nothing they can act on. The rethrow is **kept**, so
callers' `finally` blocks still clear their submitting state and any caller wanting to
handle the error itself still can — this adds a floor, it does not take over.

---

## Recurring theme

Every entry above is one of two shapes:

1. **A silent fallback that makes missing data look like real data** — capacity
   defaults, `|| '3'`, `updatedAt` standing in for a dispatch date, a hardcoded 500.
2. **Identity stored in a mutable field** — scrap identity in `status`, transformer
   identity in a job number that is not uniquely allocated.

New code should fail loudly on missing inputs, and should never key identity to a
field that changes as the unit moves through its lifecycle.

**What both shapes share: the wrong output is the plausible-looking one.** Four instances
this session, and none of them looked broken —

| Defect | What was shown | Why nobody caught it |
|---|---|---|
| F1 capacity defaults | a complete, well-formed estimate | 29 of 36 priced from defaults, all overstated |
| O7/O8 seeded DISCOM identity | a filled-in GSTIN and state code | correct-*looking* for one DISCOM, wrong for the rest |
| F17 `\|\| '3'` coil counts | `3` on a printed report | indistinguishable from a measured 3 |
| F23's `NaN` hazard | a sorted list | arbitrary order renders as confidently as a correct one |

**F32 is the same shape, latent rather than realised — and it is the hardest variant.** The
placeholder Amorphous section was a plausible-looking row waiting for someone to trust it:
correct-looking description, correct-looking position, wrong code underneath. It never
produced a wrong number because nobody typed into it, and the moment someone did — the
ordinary act of maintaining a master — it would have priced a 10 kVA item at a 25 kVA
label and looked right on the printed estimate.

Every other entry in this table was found by its damage. This one had none. It follows that
**a survey of what has gone wrong cannot find this class at all**, and the audit habit that
did find it was reading the data and asking whether it means what it says. Where a screen
invites a person to enter a value, the row they are trusting is part of the calculation -
it should be checked with the same suspicion as a fallback, and before anyone relies on it,
not after.

An error that renders as a dash, a blank or a crash is **self-reporting** — the operator
sees it and says so. An error that renders as a plausible number is not: it is indefinitely
survivable, and it reaches a UGVCL document with nothing in its appearance to distinguish
it from a right answer. This is why every one of these was found by tracing a *value's
provenance*, and none by looking at a screen.

The design consequence, and it runs against the instinct to be tidy: **a fallback that
produces a well-formed value is more dangerous than no fallback at all.** `|| '3'` is worse
than a blank; a seeded GSTIN is worse than an empty field; a default AT percentage is worse
than a refusal to price. When the substitute is indistinguishable from the real thing,
prefer the dash, the throw or the block — F23 chose its change order on exactly this
ground, and A5 was worth fixing at all only because a client clock is *plausible* rather
than absent.

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

**F24 is the same shape arriving from the other direction, and worth reading as the
general case.** There the coupling was not between two fixes but between a *guard* and a
*rebuild* in the same function, three lines apart: the validation block was the only thing
that kept the rebuild from silently dropping a division. Removing the guard was correct —
it had become a deadlock — and removing it alone would have been a data-loss bug. Neither
site referenced the other; the dependency lived entirely in the order they ran.

So the working rule generalises past "an invariant maintained elsewhere". **When removing a
guard, do not only ask what it was protecting against — ask what ran after it and assumed
it had passed.** A guard that returns early is a precondition for everything downstream of
it, whether or not anything downstream says so. And the risk concentrates exactly where the
guard has become obviously obsolete: obsolescence is an argument for deleting the *check*,
never evidence about what came to depend on it.
