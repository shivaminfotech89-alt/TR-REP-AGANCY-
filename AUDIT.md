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

## Reference: where an estimate's numbers come from, in precedence order

One authoritative answer, so this does not have to be re-traced. **Every figure on a CRGO or
OH estimate is either the agency's, the tender's, or absent-and-blocking. No step invents a
rate.**

### A. Which list is consulted — `getEstimateMasterForCore(agency, coreType)`

1. `agency.estimateMasterCRGO` (or `…Amorphous` / `…WoundCore` / `…Overhauling`) if non-empty
2. `public_config.estimateMaster<Section>` if non-empty
3. `agency.estimateMaster` — legacy CRGO field — if non-empty
4. `public_config.estimateMaster` if non-empty
5. the shipped `defaultEstimateData`

`withMissingDefaults` then **appends** any shipped-default item whose code the chosen list
lacks, so the list can be a mixture of sources.

### B. The rate for one line — `resolveRate(code, scheduleValue)`

1. `masterList.find(itemCode === code)?.rates[kva]` — **used only if `> 0`**
2. `SCHEDULE_A.find(sr === …)?.rates[bandForKva(kva)]` — **used only if `> 0`**
3. otherwise **`null`**

### C. What a `null` rate does — `recordErrorIfApplies`

- Line **applies** → a `missing-rate` error that BLOCKS the estimate and names the item
- Line does **not** apply → contributes 0; the blank rate cell is harmless

### The band above 100 kVA cannot express a per-capacity rate

`bandForKva` maps **200, 315 and 500 to one band**, `B_ABOVE_100`. Schedule-A holds a single
number there, so those three capacities are priced identically for every item.

Of 51 Schedule-A entries, 34 use `flat()` (one rate at every capacity) and 17 are banded.
**Eleven of the seventeen differ between `B100` and `B_ABOVE_100`** — 1c, 1d, 1e, 1f, 2b, 3,
7, 10, 11A, 11B, 20, 21 — so the band boundary is real and carries genuine tender data.
What it cannot carry is a difference *within* the band.

**Consequence: a capacity the tender never priced is still priced.** 315 kVA resolves to
`B_ABOVE_100` and gets 200 kVA's number for every item. There is no null to fall through and
nothing blocks. If the tender prices 200 and 500 differently, or omits 315, the schedule as
modelled cannot say so — the number returned is structurally indistinguishable from a real
one.

That is a **model** limitation rather than a missing value: no amount of data entry into
`SCHEDULE_A` as typed can express it, because the band has one slot.

### Ownership: once a master holds a rate, Schedule-A stops being reachable for it

Step B tries the agency master first and only falls to Schedule-A when the master's value is
absent or zero. So **the more complete an agency's master, the less of the tender is
consulted** — and for any item the master prices, a change to Schedule-A in code no longer
reaches that agency at all.

**That is the correct trade for a product sold per agency**: each agency owns its rates and
can edit them without a deployment, which is the whole point of having a master. But it must
be stated, because it inverts an assumption people carry: updating the schedule in code is
NOT how a tender rate change reaches agencies once their masters are populated.

**A new tender schedule therefore requires:** updating the published default
(`public_config/estimate_master`), then each agency reloading from it. Two deliberate steps
by a person, not one deployment. Recorded in ROLLOVER.md as part of what happens when a
tender changes.

### Two properties worth remembering

**A zero in the master means "not set", not "free".** Both steps test `> 0`, so entering 0
does not price something at zero — it falls through to Schedule-A.

**A master with no rate for a capacity is the NORMAL case, not a gap.** `bandForKva` maps
200/315/500 to `B_ABOVE_100`, which Schedule-A populates for every item (34 of 62 via
`flat()`, the rest explicitly). An agency that has never entered a 200 kVA rate is priced
from the tender, correctly. This is emphatically NOT the fabricated-quantity pattern: that
invents a **quantity** with no source, whereas this takes a **rate** from the tender
document itself.

### Amorphous and CRGO Wound Core do not use any of the above

They return early and take one fixed rate plus a labour line from the hardcoded `SCHEDULE_B`
table, keyed on capacity and winding material. The estimate master is consulted for exactly
one thing on those core types: the scrap row.

---

## Terminology hazard: "18" means three different things

Alongside the "Type" hazard below, and the same shape as the two agencies named **suchit**
and the shared `localhost:3000` origin: **an identifier that looks specific and is not.**

| where | "18" means |
|---|---|
| the app's estimate master | **Repl. Of Tank** - and nothing prices it |
| UGVCL Schedule-A `18a` | Tank replacement charge, Rs 54/kg |
| UGVCL Schedule-A `18b` | **Conservator** tank replacement, Rs 54/kg - a different tank |
| AARATI's Wound Core section | a **scrap** charge, sitting at code 18 (removed - F27) |

Two of those are near-misses rather than clean collisions, which is worse: `18a` and `18b`
are both tanks at the same rate, so pairing the wrong one produces a plausible number for
the wrong item. The app pairs master `'4'` with `18b` and prices conservator tanks; main
tank replacement has no line and no capture at all.

The scrap "18" is the instructive one. It was not chosen - `handleAddItem` numbered a new
row by its POSITION in the list, so appending a scrap row to a 17-item section produced
"18" (F32). An identifier generated by list length will collide with a meaningful one
eventually, and nothing marks which is which.

**Working rule.** Before pairing two codes across systems, check the DESCRIPTIONS, not the
numbers. `SCHEDULE_ITEM_MAP` now records both sides of every pairing for exactly this
reason: the master's numbering runs one ahead of the schedule's at 20 and 21, aligns at 17,
and diverges entirely at 4 - none of which is visible from the numbers.

---

## Pattern: never assert what you cannot derive — and derive what you can

Two rules that look like one, and are not.

**The useful question about an unreachable rate is not "does this work occur" — it is "does
the app already know which variant applies".** Two findings a day apart looked identical and
were not:

| | data available? | cost |
|---|---|---|
| **S.E.** (O20) | **no** — nothing in the app or the transcribed schedule records it | needed a fact from the agency; would need a FIELD if it ever varies |
| **8-B**, 22 KV bushing (F48) | **yes** — `kv` is captured, required on save, and in scope three lines from where it was ignored | one ternary |

Same symptom — a schedule entry no code path reaches — and very different problems. The
comment on the 8-B site even explained the omission: *"the job data model has no
voltage-class field"*. True, and irrelevant: the field is on the **inspection** record.
Whoever wrote it looked at one object, found nothing, and stopped one object short. **Ask
where the data would live, not whether the object you happen to be holding has it.**

**And "block rather than guess" is not always the safer default.** This audit removed a long
series of confident wrong numbers, which makes blocking feel like the safe direction in
every case. It is not.

- Where the value **cannot** be derived — the S.E. axis, a coil weight nobody measured, a
  missing KV rating — blocking is right. Anything else asserts a fact nobody established.
- Where the value **can** be derived — a 22 KV job with `kv` recorded and the rate in the
  tender — blocking is its own kind of wrong. It refuses work the contract covers, and it is
  the same overconfidence in the opposite direction: asserting *"this cannot be priced"*
  when it demonstrably can.

**A wrong block produces nothing and halts the work. A wrong branch produces a number on a
document that someone can see and challenge.** The second is recoverable; the first stops an
agency mid-tender.

**So the rule is not "prefer blocking".** It is **never assert what you cannot derive — and
derive what you can.** Blocking is the correct response to absent information, not a
general-purpose safety posture.

---

## Pattern: a check can only see what its model anticipated, and reports confidently outside it

Three instances in this audit, and the third is the clearest because the code was RIGHT.

**One - the AT-number variant check compared exact strings.** It normalised by stripping
non-alphanumerics and grouping, which cannot see that `"AT2026-27"` and `"2026_27"` are one
tender: the `AT` prefix survives and the year widths differ. It reported "no tender is spelled
two ways" across six records spelling one tender at least three ways (F59). **A comparison
built to detect mistyping could not tolerate the mistyping.**

**Two - a Schedule-A sweep's output was truncated before the judgement.** The search found
the evidence; the triage lost it, and a completeness claim was made on the clipped view (F41).

**Three - the counter checker knew only "delta must be 1".** `reserveJobNos` writes the bare
`<div>` key alongside `<div>_CRGO` and reads the MAX of the pair. On an AT missing its bare
key, the reservation CREATES it - so the diff read absent as `0`, reported `0 -> 11` as a
jump of eleven, and printed a warning **at the exact moment the code was working correctly**.

**The common shape: a model that admits one kind of change, meeting a second kind.** Exact
equality meeting a typo. A full result set meeting a display limit. Increment meeting
creation. In each case the check did not fail - it answered a narrower question than the one
being asked, and the answer was reported as though it were the wider one.

**A diagnostic that flags a failure while the code works is worse than no diagnostic.** It
costs the investigation that follows, and it spends the credibility the next real warning
needs. The third instance cost a full trace through `reserveJobNos` to establish that nothing
was wrong.

**What to do about it, concretely:** when a check reports a fault, confirm the fault
independently before acting on it - and when a check reports success, ask which question it
answered. That is the same discipline as the note below on `tsc`, arrived at from the
opposite direction: there, silence was mistaken for coverage; here, noise was mistaken for a
defect.

---

## Pattern: a green check was cited as evidence without establishing what it covered

**This is the most consequential process finding in the audit, and it is not about types.**

`npm run lint` is `tsc --noEmit`. It was reported clean after nearly every change in this
session and cited as the verification for work that had no other. **`@types/react` was not
installed.** `node_modules/@types/` held `express`, `node` and `babel__*` and nothing for
React, so `useContext` resolved to `any`, `useAgency()` returned `any`, and every destructure
from it was unchecked - along with props, state and refs.

Proven rather than inferred: `const t: string = useAgency();` produced **no error**, while
`const n: number = 'string';` in the same file did. The checker was working. It was working
on materially less than the word "clean" implied.

**The lesson is not "install the types".** It is that a tool's output was quoted as evidence
across an entire session and nobody - including the person quoting it - established its scope
first. A green check answers a question. Which question it answers is a fact about the
configuration, and that fact went unexamined because the answer was the one being hoped for.

**What it hid, concretely.** `getNextJobNoInfo` was renamed to `predictNextJobNo`; tsc
reported clean; `MrLedger.tsx:101` was still destructuring the old name and `:230` still
calling it, so adding a transformer to an existing MR would have thrown at runtime. That
break was found by GREP, not by the compiler, and only because the rename prompted a search.
Following it turned up a second job-number allocator on a screen the O2 trace never reached.

**A cast defeats the checker at exactly the point someone reached for it.** The subscription
fields (O34) are read as `(agency as any).subscriptionStatus`. Even after the types were
installed, those reads stay unchecked - the cast was written to silence a complaint and it
still silences it. `as any` is not a local shortcut; it is a permanent hole at the point of
greatest doubt.

**Installing the types surfaced 40 errors**, 36 of which were properties read or written that
the interfaces never declared - including `cgstPercent` and `sgstPercent`, the GST rates,
read at fourteen sites each. Four were real mismatches, one of them a broken contract inside
F56 that had been there since it was written.

**What "zero errors" means now, stated exactly, because the same trap is available again:**
after the fix, the reservation work of F60-F62 reports no type errors on its first real
check. **The shapes are right. The logic is untested.** That path has still never executed;
a counter check against live data remains the only thing that will say whether it reserves
one number or two. A type checker cannot tell the difference, and reporting its silence as
if it could is the error this note exists to prevent repeating.

---

## Pattern: the app RECOMPUTES documents rather than REPRODUCING them

Two items that look unrelated share one root, and the root is what makes both expensive.

**O29 - the bill ignores the DISCOM's approved amount.** `approvedAmount` is captured,
stored, and displayed beside the estimate when they differ. `BillingSystem` never reads it,
so the bill claims a third independently recomputed figure.

**O9 item 5 - IGST is not a tax feature, it is a STAMPED-DOCUMENT feature.** Adding an IGST
path is not mainly about a third rate and a different column. It is that a reprint of an
intra-state invoice must stay intra-state, and nothing records which treatment was applied.
Change the basis and every historical reprint silently changes with it.

**The shared root: no document pins its own figures.** A bill stores `billAmount` as a side
record, and every screen, print and export recomputes from the CURRENT master, the CURRENT
AT percentage and the CURRENT tax rates. `BillingSystem:2984` says so in as many words about
the EST. AMOUNT column: *"an invoice reprinted after a rate change shows a different figure
from the estimate that actually went out. THE PRINTED ESTIMATE ON FILE IS THE AUTHORITY."*
That is a workaround written into a comment, not a property of the system.

**What follows from it, and why each of these is dear on its own but cheap together:**

- an approved figure cannot be honoured, because nothing pins a figure at approval (O29)
- a tax treatment cannot be changed safely, because nothing pins the treatment at send (O9)
- historical estimates reprice at every rollover, because nothing pins the AT percentage
  (the 15 active-AT call sites)
- `estimateAmount` and `billAmount` exist as stored side-records that no document reads,
  and drift from the documents they name (O3, O4)

**The capability that closes all four is one thing: STAMP THE DOCUMENT AT ISSUE.** Write the
line items, the rates, the AT percentage and the tax treatment onto the job when the estimate
is sent and when the bill is sent, and reprint from that. A reprint then reproduces a
document instead of recalculating one.

**It is not a small change** - it is a storage-shape change and a migration for jobs already
issued. But it should be priced as ONE change that closes four items, not four changes. Each
of those items, attacked alone, ends up re-implementing a piece of it.

**Do not confuse this with the export pattern above.** That one says: prefer taking the
rendered output over rebuilding it, WITHIN a single production of a document. This one says:
prefer reproducing an ISSUED document over recomputing it, ACROSS time. Same instinct,
different axis - one is about who computes, the other about when.

---

## Pattern: an export that serialises the page cannot disagree with it; one that rebuilds always can

**Three Word exports in this codebase could not have been wrong. Two Excel exports were.**
The difference is not the file format - it is whether the exporter TAKES the rendered output
or REBUILDS it.

`lib/wordExport.ts` is handed `document.getElementById('printable-…-container').innerHTML`
by all three of its callers - the bill, the estimate and the challan. It serialises whatever
the page already rendered. There is no arithmetic in that path, so a Word export cannot show
a figure the printed page does not. It is correct by construction, and stays correct through
every future change to how the page computes.

Both Excel exports rebuilt the table from the data instead, and both diverged:

- **F54** - the ESTIMATE export called the item-pricing function with no inspection data at
  all, so every optional item was charged on every job, while the totals rows underneath came
  from the real builder. The sheet did not reconcile against itself.
- **O3** - the BILL export multiplied by the AT percentage a second time, because
  `calculateJobTotal` already includes it. Every money figure in a file headed TAX INVOICE
  was 4% high at a 4% AT, while the printed invoice was right.

**THE RULE: prefer taking the rendered output over rebuilding it.** A serialising exporter
inherits every fix the page ever receives. A rebuilding exporter is a second implementation
of the same calculation and needs exactly the treatment F55 and F57 gave the other two - one
source of the figure, or it drifts.

**Where rebuilding is unavoidable** - Excel wants cells and formulas, not a screenshot of a
table - then it is a second implementation and must be recognised as one: same builder, same
inputs, no local arithmetic. The bill export now calls `calculateJobTotal` and applies only
the tax; it back-derives the pre-AT column rather than computing it, so the file satisfies
its own arithmetic.

**And the corollary, which is why this pattern is filed here rather than as a one-off:
ANYTHING PRODUCING A FIGURE FOR A CUSTOMER HAS THREE PATHS - SCREEN, PRINT, EXPORT - AND A
TRACE THAT STARTS FROM THE STORED FIELD OR THE RENDERED PAGE REACHES NEITHER THE EXPORT NOR
ITS ARITHMETIC.** O3 was investigated twice and reported as stored-only both times, because
the investigation went outward from `job.billAmount` and inward from the print path. The
export sits in neither direction: it recomputes independently and writes to a file. That is
the second time an Excel export has been the path outside both traces.

---

## Pattern: a comparison against a literal the producing code never emits

Three instances this session, and they are the same defect:

| consumer tests | producer emits | result |
|---|---|---|
| `lvCoilR !== 'DMG'` | `'DAM'` / `'OK'` / `'RI'` | guard always true — fabricated weights fired (F44) |
| `sealType === 'B' \|\| 'Bolted' \|\| 'Y'` | `'BL'` / `'SL'` | always false — item 17 never charged (F53) |
| `windingType.startsWith('CU')` | `'AL'` / `'CU'` — but blank fell to `'Aluminium'` | blank priced as aluminium, Rs 194/kg out (F52) |
| `externalData.kv === '22'` | free text: `'22 KV'`, `'22kv'`, `' 22 '` | would have priced 22 KV at the 11 KV rate (F48) |

**Why this class hides so well.** It type-checks — both sides are `string`. It runs — no
exception, no warning. And critically, **the branch it wrongly selects is a real one**, so
what comes out is a plausible number rather than a blank or a crash. There is no missing-data
symptom to notice. `undefined !== 'DMG'` is `true`; `'SL' === 'B'` is `false`; either way some
branch executes and produces a figure that looks like every other figure on the sheet.

Two of the four were found only because a downstream total looked wrong to a human. One was
found by reading. That ratio is the point: this class does not report itself.

**The tell.** Any `===` / `!==` / `.startsWith()` against a string literal where the value
originates in **form state, a `<select>`, or another module**. When producer and consumer sit
in different files, nothing keeps them in step — not the compiler, not the tests, not the UI.
A shared union type would; string does not.

**Why `undefined` makes it worse.** Negative tests (`x !== 'N'`) treat an unset field as
passing, so a field that was never filled in behaves like an affirmative. Positive tests
(`x === 'Y'`) cannot do this — a value nobody chose can never be an affirmative. This is the
same reasoning already recorded at F46; it generalises to every field of this shape.

**The durable fix** is not to correct each literal. It is to make the producer and the
consumer share one declaration: a union type plus a parse function per field, so an
unrecognised value is a compile error at the producer and a `null` at the consumer.
`classifyWindingMaterial` in SingleJobEstimateReport.tsx is the first instance of that shape.
See the sweep results at O23.

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

> ### DATA RESET, 2026-08-25
> All records existing at this date are test data and are being wiped before launch,
> agencies included. Items that were purely about those records are closed in place, marked
> **NOT APPLICABLE**, and say so at the top of the entry: C1, C2, C3, O24, A1, and the
> stored half of O8.
>
> **Closing a record does not close its cause.** Where a data item existed because of a code
> defect, the banner names the code item that survives - C1 points at O2, O8 points at O7.
> A clean database with a real customer re-creates every one of those unless the code
> changes. The ranked list of what remains is in `LAUNCH-BLOCKERS.md`.



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

> **CLOSED — NOT APPLICABLE.** Every record named here is test data and is being wiped
> before launch. The renumbering never needs doing.
>
> **The code defect is NOT closed with it.** O2 (job numbers are not uniquely allocated)
> is what produced these collisions and is untouched, so a clean database will produce
> them again. Read O2, not this.


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

### O3. The AT percentage applied twice — in the bill Excel export, and in four stored fields

> **FIXED. Recorded in full because it was reported wrongly TWICE before it was reported
> correctly, and both errors are more instructive than the defect.**

`BillingSystem.calculateJobTotal` returns an **AT-inclusive** figure. Five callers multiplied
by the AT percentage again:

    // four write sites - handleSaveBillDates x2, handleConfirmSendBill x2
    const totalJobTaxedAmt = Math.round((baseAmt * (1 + atPct / 100)) * (1 + (cgst + sgst) / 100));

    // and the Excel export
    const grandAmt = baseAmt * (1 + atPct / 100);

**The variable name caused it.** `calculateJobTotal` returned an AT-inclusive figure into a
variable called `baseAmt`, and the comment above its return said it "keeps returning a pre-AT
figure" - which described `est.baseTotal`, not the return value. Every caller that read the
name or the comment multiplied again. Renamed to `atInclusiveAmt` at all five sites and the
comment corrected, because leaving the name would invite the same edit back.

**WHAT IT AFFECTED.** The printed invoice was always correct - it recomputes per-job from
`calculateJobTotal` and sums those same values, so rows and total agreed. The damage was:

- the **Excel export headed "TAX INVOICE / REPAIR BILL"** - TOTAL AMOUNT, SUB TOTAL, CGST,
  SGST, GRAND TOTAL and the oil deduction derived from them, all 4% high at a 4% AT. Its
  BASE COST column additionally printed the AT-inclusive figure under a heading that says
  base, so the file did not satisfy `BASE COST x (1 + AT%) = TOTAL AMOUNT`. Now back-derived.
- the stored `job.billAmount`, whose only consumer is the `Reports` cycle view and its export.
  `billTotalMrAmount` on the same job was always correct, so the two stored fields disagreed.

**FIRST WRONG REPORT: "the per-job figures do not sum to the MR total on the same bill."**
False. `subTotal` is literally `selectedJobsData.reduce((acc, job) => acc + calculateJobTotal(job), 0)`
- the same function that prints each row - so they sum exactly, by construction. The claim was
asserted from reading the WRITE path and never checked against the RENDER path. The operator
had run bills and seen no discrepancy, which was correct evidence that the claim was wrong.

**SECOND WRONG REPORT: "stored-only, no document changes."** Also false, and it is the more
useful error. The reconciliation traced outward from `job.billAmount` and inward from the
print path - and the Excel export is in neither direction. It recomputes independently and
writes to a file, so it appears in no consumer list and no render tree. It was found only
when a `grep` for the renamed variable turned up a fifth site nobody had asked about.

**The generalisation is a pattern note above:** an export that serialises the rendered page
cannot disagree with it; one that rebuilds always can. Screen, print and export are three
paths, and a trace from the stored field or the rendered page reaches only two.

**Original entry, kept for the observed evidence it cites:**

#### (superseded heading) Per-job `billAmount` applies AT twice

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

> **CLOSED — NOT APPLICABLE.** MSBT-12 is test data and is being wiped. There is no
> approval to re-route and no division office to correct.
>
> Kept as a worked example: it is the clearest record of how a wrong estimate total
> silently changes WHICH AUTHORITY approves a job, which is a consequence of a pricing
> error that no pricing test would catch.


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

> **CLOSED — NOT APPLICABLE, and the code defect IS fixed.** MSBT-12 is test data and is
> being wiped; no money changed hands and no refund is owed.
>
> The underlying defect is fixed in code: `jobsForBillType` filters `isGpJob` before any
> branch (`BillingSystem.tsx:238`), and `EstimateGenerate` filters it at `:217`, `:532`.
> A GP job can no longer be estimated or billed. The three-figure discrepancy recorded
> below is likewise moot — the document it describes will not exist.


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

---

**THREE FIGURES, AND THE APP CAN NO LONGER PRODUCE ANY OF THEM.** Recorded because the
discrepancy is now permanent, not because it changes the remedy.

| figure | where it lives | how it was produced |
|---|---|---|
| **6,680** | `paidAmount` | typed by the operator from the bank credit — authoritative, and the refund basis |
| **6,413** | `billAmount` | computed at send time by `BillingSystem.calculateJobTotal`'s itemised branch |
| a fourth number | whatever the screen shows today | recomputed live, by the consolidated builder |

**Why the third differs.** Bills are not stored as line items - `billAmount` is a computed
side-record and every screen recomputes from current data. F57 replaced the itemised branch
of `calculateJobTotal` with `getJobFullEstimate`, so a reprint now prices from real
inspection data instead of from `unit`-label quantities. The stored 6,413 is untouched; the
screen simply no longer agrees with it.

**Why THIS job specifically.** It was billed on 2026-08-15, before `jobsForBillType` filtered
`isGpJob`. A GP job cannot reach `calculateJobTotal` today, so **this bill could not be
produced by the current app at all** - not with different numbers, not at all. It is the one
issued document in that account whose figures are unreproducible, and the reason is that the
code path that made it has been deleted.

**Note the interaction with F57's safety argument.** F57 concluded that consolidating changed
no issued bill, partly because GP jobs never reach that function. True today; MSBT-12 predates
the filter. The conclusion still holds - stored `billAmount` is never rewritten - but the
reasoning had a gap, and this is where it shows.

**What to do with it: nothing, but write it down.** The refund stands at 6,680 for the reason
already given - it is the only figure derived from reality rather than a formula. The risk is
not financial, it is diagnostic: someone opening BILL/1 in six months finds three numbers and
no explanation, and reasonably concludes the billing is broken. It is not. It is one document
from a code path that no longer runs, and this paragraph is the explanation they will be
looking for.

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

> **PARTIALLY CLOSED.** The agencies carrying the wrong seeded value are test data and are
> being wiped, so nothing stored needs correcting.
>
> **THE SEEDING CODE IS UNCHANGED** (`AgencySettings.tsx:146-158`), so the first real
> customer is seeded exactly the same way. See O7, which is the live half.


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

> **REFRAMED AND UPGRADED, 2026-08-25.** Both open questions were verified and both hold, so
> this is not a missing feature - it is **a wrong tax treatment on an issued invoice, against
> evidence the same document carries.**
>
> **1. A non-Gujarat GSTIN can be entered without obstacle.** There is no GSTIN validation
> anywhere: `firestore.rules:107` checks only `is string && size() <= 100` - no format, no
> length, no state prefix - and `stateCodeFromGstin` simply reads the first two digits of
> whatever is there. So an out-of-state agency onboards fully.
>
> **2. Nothing compares the agency's state to the DISCOM's.** `getAgencyStateCode` is read in
> exactly three places, all display or gating: the invoice's supplier block
> (`BillingSystem:2892`), the letterhead (`LetterheadHeader:110`), and the malformed-GSTIN
> check (`jobDisplay:126`). `cgstPercent` / `sgstPercent` are read unconditionally at eight
> sites. The string `igst` appears nowhere in `src/`.
>
> **The consequence is self-contradicting paperwork.** A Maharashtra agency working for a
> Gujarat DISCOM produces an invoice printing *Supplier State Code 27* and *Buyer State Code
> 24* - an inter-state supply on its face - and then charges CGST+SGST on the same page. The
> app holds the GSTIN proving the treatment is wrong and prints it beside the wrong treatment.
>
> **Also reframed: the DISCOM side is not the exposure.** `DISCOM_OPTIONS` in
> `AgencySettings.tsx:11` offers four entities, all Gujarat, and the select is required - so
> an out-of-state DISCOM cannot be represented at all. That is an onboarding wall, not a tax
> gap. The IGST case is an out-of-state **AGENCY**, which the app supports completely except
> for the tax.
>
> **A partial workaround exists and is worse than none.** `cgstPercent` / `sgstPercent` are
> agency-configurable, so an out-of-state agency could set 0 and 18. The amounts would then be
> right and the invoice would still be invalid, because the columns are labelled CGST and
> SGST. Anyone who found this workaround would believe the problem solved.


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

### O21. The "originals missing" coil rates are unreachable — no code path resolves 12B or 13B

Schedule-A prices coil replacement twice over, on whether the transformer arrived with its
original windings:

| | present (12A / 13A) | **originals missing** (12B / 13B) | difference |
|---|---|---|---|
| HV Aluminium, w/o S.E. | 163 | **219** | +56/kg |
| HV Copper, w/o S.E. | 357 | **519** | +162/kg |
| LV Aluminium, w/o S.E. | 149 | **205** | +56/kg |
| LV Copper, w/o S.E. | 314 | **491** | +177/kg |

**The gap runs across BOTH windings and compounds on one job.** 13B prices LV
missing-originals at 205 against 149 — the same +56/kg as HV — and Copper is larger still
(+177/kg LV, +162/kg HV). A transformer arriving stripped is normally stripped of both, so
a single job under-claims on the HV line and the LV line together.

**Eight of the sixteen entries are dead.** `SingleJobEstimateReport` resolves `12A-b` and
`13A-b` and nothing else; no code path can reach a `B` variant. A transformer arriving
already stripped is priced as though its original conductor were present — an undercharge of
56/kg on Aluminium and up to 177/kg on Copper.

**Why the tender splits them, which decides where it is observed.** When the originals are
present the old winding is reclaimable material and offsets the agency's cost; when they are
missing the agency supplies everything. So the question is not "are the coils damaged" — it
is **"did this unit arrive with its conductor"**, a fact about what was received, not about
what the inspection found.

**That places it at EXTERNAL inspection, not internal**, and nothing currently records it.
The internal screen captures coil *state* (`OK`/`RI`/`DAM`) and weights, all of which
presume coils exist to assess. A unit with no coils has nothing for those fields to describe,
so the internal form cannot express the case even implicitly.

**Is it knowable at external inspection?** Usually yes, and this is the part worth checking
with the operator rather than assuming. A stripped unit is normally evident on receipt —
open or missing top cover, no leads, drastically low weight — and the receiving agency has
an obvious commercial interest in recording it at intake, because it is the difference
between reclaimable material and material they must buy. Where it is *not* evident until the
tank is opened, the observation belongs on the internal form instead, and the honest design
records where it was established rather than assuming a stage.

**Shape if it is ever built** (not built, and deliberately so until frequency is known):

- one field, external inspection, alongside the other receipt observations — *"original
  windings present"* Y/N, with the same affirmative-only treatment as F46 so an unset value
  never silently selects the higher rate;
- the estimate picks the `A` or `B` variant from it, on **both** windings, exactly as the
  agency's S.E. fact selects the with/without axis (O20) and `windingType` selects the
  material axis. Three independent axes, one already an input, one an agency constant, one
  unrecorded;
- **it must not default.** Selecting `B` by accident overcharges by up to 177/kg; selecting
  `A` by accident undercharges by the same. Neither is a safe resting state, which argues for
  blocking rather than defaulting when a coil line applies and the field is unanswered.

**Not built.** Whether this happens often enough to be worth a field is a question about the
work, not the code — and a field that is almost always the same answer will be clicked past,
which is how `inPnt`'s default came to charge every uninspected job (F46).

### O22. Twenty of fifty-one Schedule-A entries are unreachable — the full list

Swept while the schedule was in view, so these are found once rather than one at a time over
the next year. Of 51 entries, **31 are reachable** from `SingleJobEstimateReport` and **20
are not**. Four groups, and they are not the same kind of problem:

**A. Variant axes the app never selects — 14 entries.** All of `12A`/`12B`/`13A`/`13B`
except the two now in use. These are the Copper, with-S.E. and originals-missing
permutations. Covered by **O20** (S.E. is an agency constant, would become an input) and
**O21** (originals-missing is unrecorded). Copper is *deliberately* unreachable: the code
blocks rather than guessing when `windingType` says Copper, which is correct — a blocked
estimate is better than a wrong one.

**B. Items with no capture at all — 4 entries.**

| sr | | |
|---|---|---|
| `4i` | Replacement of valve (gun metal brass), 3/4" | no field |
| `4ii` | Replacement of valve (gun metal brass), 1 1/4" | no field |
| `7` | Replacement of tap changing switch | no field |
| `8-B` | Replacement of HT bushing porcelain, **22 KV** | see below |

`8-B` is the interesting one: `8-A` (11 KV) IS reachable, so the app prices HT bushing
replacement only at 11 KV. The external form captures `kv`, so the input **already exists** —
nothing consumes it to choose the variant. That is the smallest of these to close and the
most likely to be occurring silently, since a 22 KV unit would be priced at the 11 KV rate.

**C. Duplicated or superseded — 1 entry.** `18a` "Tank replacement charge (per kg)" against
`18b` which is reachable. Which is correct is a tender question, not a code one.

**D. Whole-job alternatives — 1 entry.** `21` Overhauling of transformer. The app prices OH
through the itemised path plus the Overhauling master section rather than as this single
line. Whether that matches the tender's intent is worth confirming — an overhaul billed
itemised and an overhaul billed at `21` are different claims for the same work.

**None of these is a defect on its own.** An unreachable schedule entry is only a problem if
the case it prices actually occurs — which is a question about the work, not the code. The
value of the list is that the question can now be asked once per group instead of discovered
one job at a time.

**Method note:** the first sweep reported 26 unreachable and was wrong. It matched
`scheduleRate('X')` literally and so missed `scheduleRate(isCopper ? '14-i' : '14-ii')` —
six entries mis-reported as dead, including both re-insulation rates that F46 had just wired
up. Corrected by parsing the whole argument expression. The same shape as the F41 truncation:
a sweep complete against its own pattern, wrong about the domain.

### O20. "S.E." is undefined in this codebase, and the choice is now an agency fact

Sixteen Schedule-A entries split on it — `12A`, `12B`, `13A`, `13B`, each Copper/Aluminium
x with/without — and the rate difference is Rs 50/kg on Aluminium, Rs 50/kg on Copper.

**Nothing in the app defines what it means.** The transcribed schedule carries only the
label *"with S.E."* / *"without S.E."*. There is no field, no selector and no stored value on
either inspection screen, and no comment anywhere states it. The likeliest reading in
transformer winding is **Super Enamelled** conductor — a coating grade on the winding wire —
but that is domain inference, not something this codebase or the transcribed schedule
confirms, and it should be checked against the tender text before anyone relies on it.

**It is now an AGENCY FACT, not a derived one.** The operator confirmed these agencies do
not use S.E. conductor, so both windings take the without-S.E. variant (F47). That is a
statement about how this business works, recorded in code because there is nowhere else to
record it — not a rule read off the tender, and not something the app can check.

**If an agency ever does use S.E. conductor, this becomes an INPUT rather than a constant.**
The shape already exists: `isCopper` selects the material axis from `internalData.windingType`
and blocks rather than guesses where it cannot tell. An S.E. flag would work the same way and
feed both windings from one observation. Until then, hardcoding is honest — the alternative
is a field nobody can answer.

**What made the old value hard to see:** it was defended on the ground that it matched
estimates already issued to and accepted by UGVCL. That is consistency with prior output,
not evidence about the tender. **A figure appearing on an accepted document means the
customer did not object, not that it was right** — and where the same code produced every
one of those documents, agreement between them is not corroboration.

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

> **CLOSED — NOT APPLICABLE.** MSBT-112 is test data and is being wiped.


Now blocks with *"no external inspection data - quantities cannot be derived"*. This is
the F2 rule working as designed: the job has no External inspection record, so its
quantities cannot be derived and the estimate refuses rather than falling back to
capacity defaults.

**Action needed:** enter MSBT-112's external inspection. It will then estimate normally.
No code change required.

---

### O23. String-literal comparison sweep — 513 sites, 2 live defects, 1 dead engine

Run in response to the pattern note above. Method: every `===` / `!==` / `.startsWith()` /
`.includes()` against a string literal on a dotted path in `src/`, then a per-field diff of
the literals a CONSUMER tests against the literals any PRODUCER emits.

    513   raw comparisons, 60 distinct trailing field names
     30   fields where a consumer literal is never emitted by any producer
      4   survived hand-checking (the other 26 were scan artefacts - typed unions
          declared in the same file, values produced by code rather than forms,
          or a producer my crude `field: 'X'` regex could not see)

**Live, and priced money:**

- **`sealType`** — F53. `SingleJobEstimateReport.tsx:611` and `EstimateGenerate.tsx:278` test
  `'B' | 'Bolted' | 'Y'`. The form's select offers `['BL','SL']` and defaults to `'BL'`
  (`ExternalInspection.tsx:1386,172,203`). None of the three tested values is producible, so
  `stbIsBolted` is **always false** and item 17 "Sealed to Bolted" has printed qty `N`, amount
  0, on every estimate ever issued.
  **NOT YET FIXED, and must not be fixed by guessing.** The correct test depends on a domain
  fact nobody has stated: does `sealType` record the transformer AS RECEIVED or AS DELIVERED?
  Schedule-A sr 17 pays for *converting a sealed transformer into a bolted one*, so if the
  field is as-received the test is `=== 'SL'` — the exact opposite of what the variable name
  `stbIsBolted` assumes. Correcting the literal without settling this would swap a charge that
  never fires for one that fires on the wrong population. Needs an operator answer and an
  exposure count (how many jobs carry `'SL'`).

- **`lvCoilR/Y/B !== 'DMG'`** — `EstimateGenerate.tsx:326`. The unfixed twin of F44. The form
  emits `'DAM'`/`'OK'`/`'RI'`, so the guard is always true and the per-capacity fabricated
  weights (24.30 / 15.54 / 35.00 / 12.00) still fire in this file — the same constants deleted
  from SingleJobEstimateReport under F47 as having no origin in the tender.

**Benign, but the same shape:** `data.repairType === 'OH'` at `AllotmentWidget.tsx:33` and
`NewJob.tsx:1262`. `'OH'` is a **coreType** value; `repairType` is only ever `'OGP'` or `'GP'`.
Both clauses are dead, and both sit beside a correct clause that does the work.

**The larger thing the sweep turned up.** `EstimateGenerate.calculateJobItemDetails` is a
SECOND estimate engine, ~330 lines, still carrying the pre-F46 shape at eleven sites:
`x !== 'N' && x !== '0'` — "anything that is not N" — where `'0'` is a literal the form has
never emitted and `undefined` matches neither exclusion. It has two callers:

- `EstimateGenerate.tsx:1957` — the on-screen/printed multi-job grid. Passes inspection data.
- `EstimateGenerate.tsx:705` — the **Excel export**. Calls it with **no external or internal
  data at all**, so every flag reads `undefined`, every negative test passes, and the exported
  spreadsheet charges every optional item on every job regardless of what was inspected.

Every fix recorded as F46, F47 and F52 was applied to `buildSingleJobEstimateData` only. This
engine did not receive any of them. Whether it should be repaired or deleted in favour of the
single builder is a decision, not a bug fix, and is not taken here.

**Verdict on "systematic fix or three more one-offs":** the count says one-offs for the two
live defects (they need domain answers, not a refactor), and a separate decision on the second
engine, which is where the real divergence lives. The systematic fix — shared union types with
a parse function per field — is worth doing for the fields the estimate reads, and worthless
for the other 26 candidates, which were never at risk.

---

### O24. Nobody can tell whether an inflated spreadsheet was ever sent anywhere

> **CLOSED — NOT APPLICABLE, and the code defect IS fixed.** Every sheet that could have
> been exported came from test data being wiped before launch, so nothing wrong is in
> anyone's hands and the agencies do not need asking.
>
> The defect itself was fixed in F54: the export's item rows now come from the same
> builder as its totals, so a sheet cannot disagree with itself again.


The Excel export shipped item rows derived from **no inspection data at all** (F54). The
fix is in. The exposure is not, and cannot be closed from the code.

**Nothing records that the export was used.** No analytics, no `logEvent`, no audit
collection, no `exports` document - the codebase contains no telemetry of any kind. There
is no query that answers "how many were produced" or "for which MRs".

**And the button is prominent.** Not behind a menu, a role, or a flag: one of four in the
MR action bar, beside Print and Download Word, visible the moment an MR is selected, on a
screen operators use routinely. The filename it writes - `Estimate_Report_MR_<mr>.xlsx` -
is the shape of a file meant to be sent.

**The specific risk.** An exported sheet showing 32,000 where the estimate says 10,000
**looks like a legitimate itemised estimate**. Every row is a real master item at a real
rate; the arithmetic within each row is correct; there is no blank, no error, no marker.
Nothing in the document invites the question. If any of these reached a division office
they read as an inflated claim - and the agency could not explain the discrepancy, because
it did not know one existed.

The one clue is internal and nobody had reason to look for it: **the sheet never reconciled
against itself.** Its totals rows were always computed by `buildSingleJobEstimateData` from
real inspection data, so the item column sums to more than the GRAND TOTAL printed beneath
it. A division office querying the line items against the total would have sounded like an
arithmetic complaint, not a software fault.

**Only the agencies can answer this**, and the question has to be put in two parts, because
the second is the one they will not think to volunteer:

1. Have you ever used **Export Excel** on the estimate screen?
2. Where did those files go - sent to a division office, used for reconciliation, or kept
   locally?

`scripts/excel-export-delta-console.js` (read-only) reproduces the old item-row sum from
live data for three jobs per agency, so the size of the discrepancy can be quoted when
asking. It does not depend on the deleted code: a dataless call reduces to a fixed table of
quantities times the agency's master rates.

---

### O25. Overhauling per-kg quantities are invented, and were moved rather than fixed

The new OH branch in `buildSingleJobEstimateData` (F55) carries this across verbatim from
the deleted engine:

    if (unit === 'KG') qty = (kva === '10' || kva === '16') ? 14 : kva === '25' ? 15.54 : 45.36;

Two master rows are priced per kilogram - '3' tank replacement and '4' conservator tank
replacement - and **no field anywhere records a tank weight**. So the old engine supplied
one, banded by capacity, with no origin in the tender. It is the F47 shape exactly: numbers
that produce a plausible line where the honest answer is that the measurement was never
taken. 45.36 kg is applied to every capacity from 63 upward, which cannot be right for both
a 63 KVA and a 500 KVA tank.

**Carried, not endorsed.** A consolidation that silently reprices overhauling jobs is not a
consolidation - the deletion had to change no figure, so the numbers moved with the logic.
Fixing them is a separate, visible decision, and it is the same decision F47 already took
for the CRGO coil constants: delete them and block on the missing measurement.

Note this is the same gap as O22's tank-replacement entry, reached from the other side.
There the tender prices main-tank replacement at Rs 54/kg and nothing captures a weight, so
no line is produced at all. Here a line IS produced, from a weight nobody measured.

**Before deciding, someone needs to say how often an overhauling job replaces a tank.** If
it is rare, blocking costs almost nothing. If it is routine, a weight field is needed on
the inspection before the line can be priced honestly.

---

### O26. One weight constant serving unrelated items — three copies, four rows

`(kva === '10' || kva === '16') ? 14 : kva === '25' ? 15.54 : 45.36` appears verbatim in
THREE files:

    src/components/SingleJobEstimateReport.tsx:500   OH branch (ported under F55)
    src/components/BillingSystem.tsx:574             job-total function
    src/components/Reports.tsx:148                   job-total function

Each applies it to every master row whose `unit` is `'KG'`. In the shipped masters that is
four rows: **Tank replacement (`3`)** and **Conservator tank replacement (`4`)**, in the
Amorphous master and again in the Overhauling master.

**So at 63 kVA and above, 45.36 kg is simultaneously the weight of a main tank and the
weight of a conservator tank.** Those are not comparable objects - a conservator is a small
drum mounted on top of a tank an order of magnitude larger. The number cannot be right for
both, and is almost certainly right for neither.

**This is a different defect from a constant with no source, and the difference matters.**
F47 dealt with invented numbers - someone needed a figure, had none, and wrote one. This is
a figure REUSED across items that have nothing to do with each other, which means the second
author knew a constant was already there and reached for it instead of for a measurement.
A wrong number that is copied is harder to find than a wrong number that is written, because
each new site looks like it is following an established convention.

**Scope, stated exactly** (an earlier draft of this entry said seven items including the
radiator; both were wrong and the record should not carry them):

- **Four rows, not seven.** Only `unit: 'KG'` rows are reached. Live agency masters could
  add more - a census would settle it - but the shipped masters have four.
- **The radiator is NOT among them.** `Complete Radiator replacement` is `unit: 'QTY'`, so
  it takes the QTY branch. In the estimate builder, CRGO item `21` is
  `Number(externalData?.damRadNo)` x `scheduleRate('20')`, emitted as `unit: 'NO'` - a count
  times a per-unit rate, with no weight constant anywhere in its path. It is correct and out
  of scope. Its only fault is in the OH branch, where it charges qty 1 regardless of
  `damRadNo`, which is a gating fault, not a weight fault.

**A related fault in the same two functions**, recorded here because it is the same root
cause - quantity inferred from a `unit` LABEL instead of read from a measurement. The CRGO
coil rows are `unit: 'QTY'` in the master while being priced per kilogram by the builder, so
`BillingSystem` and `Reports` give them **qty = 1**: a 47 kg HV coil contributes
1 x Rs 163 = Rs 163 to those totals instead of Rs 7,661.

**Also noted, not fixed:** those two functions read `item.rates[kva]`, where the master's
`B_ABOVE_100` is one slot shared by 200, 315 and 500 kVA. Radiator replacement at 500 kVA is
Rs 2,630.06 against the 200 kVA figure of Rs 1,971.69, so a 500 kVA radiator under-prices by
**Rs 658.37 per radiator** there. That is the band-model limitation already on record, not
this entry's problem - but if 500 kVA radiator work ever occurs, the band model needs
revisiting rather than a local patch.

`BillingSystem` and `Reports` are two further estimate engines of the shape deleted in F55,
neither of which reads any inspection data. What their totals feed has not yet been traced.

---

### O27. The conservator tank line: a real defect that has never produced a wrong document

**The defect.** `damCtTank` is an integer COUNT of damaged conservator tanks -
`renderIntegerField`, `Math.round`, default `'0'`, printed as a bare number. Estimate item
`4` prices at Schedule-A `18b`, **Rs 54 PER KILOGRAM**. Two code paths get it wrong in
opposite directions:

- `buildSingleJobEstimateData` (CRGO) uses the count directly as a weight:
  `qty: ctQty, unit: 'KG'`. A flagged conservator bills **1 x 54 = Rs 54**, where a real one
  weighs tens of kilograms. An under-charge of roughly two orders of magnitude.
- The OH branch and the two job-total functions ignore the count and substitute the O26
  constant: **45.36 x 54 = Rs 2,449** of weight nobody measured.

**It has produced no wrong document.** Census across both agencies: **0 jobs with
`damCtTank` > 0**. Nothing has ever been flagged, so nothing has ever been claimed on this
line. The defect is real; the exposure is nil.

**Which is why nothing was built.** A weight-capture popup was designed and withdrawn. Adding
a field, a modal and a stored value to serve a line nobody claims would be adding a
maintained surface for no work - the same instinct that produced the constants in the first
place. `scripts/conservator-line-census-console.js` (read-only) re-answers this at any time.

**WHAT TO DO IF ONE IS EVER FLAGGED.** The count must not be multiplied by a weight
constant, and must not be used AS a weight. A real weight is needed. Until a field exists to
hold one, the line must **block with a named error** rather than price - so the first
conservator ever flagged refuses to produce an estimate instead of silently claiming either
Rs 54 or Rs 2,449 of fiction. That block is the whole fix; the field only becomes worth
building when a second one is flagged.

### O28. Tank damage is a scrap decision, not a priced line

A damaged main tank means the transformer is **declared scrap** - it does not work properly
and replacing a tank is not viable. So there is nothing to price and nothing to capture, and
the OH tank section proposed during O26/O27 was withdrawn before it was built.

**The routing already exists.** `condition === 'Scrap'` on the internal inspection
(`InternalInspection.tsx:418, 537-562`) sets `status: 'Scrap'` and `condition: 'Scrap'`, and
the estimate short-circuits to the single inspection-and-dismantling line.

**What does NOT exist is the reason.** External inspection has no main-tank damage field at
all - `clnDrtyTank` is a Y/N flag for CLEANING a dirty tank, and `damCtTank` is the
conservator count. And the printed internal sheet asserts a single hardcoded reason for
every scrap job on it:

    NOTE : JOB NO 14 & 22 FOUND HEAVILY DAMAGED WITH CORE & LT, HENCE PROPOSED FOR SCRAP ONLY

A tank-damaged unit is declared scrap and then printed as core-and-LT damaged. That is a
document asserting something nobody derived, which is the recurring theme of this audit -
but it is a change to a printed sheet and has not been proposed.

---

### O29. The DISCOM's approved amount is captured, displayed, and never read by the bill

**The app already knows the answer and does not consult it.** This is the 8-B shape (F48),
where the HV bushing priced every transformer at the 11 KV rate while `externalData.kv` sat
three lines below the assumption. Naming the category matters: the fix is wiring, not new
capability.

**What exists.** `approvedAmount` is a real field on the job, written at
`EstimateGenerate.tsx:685` and `:701`. It has its own input (`:2474`), defaults to the
estimate total but is freely editable (`:664`), and the Approved Estimates table renders the
divergence explicitly when the two differ (`:2247`):

    Rs 1,84,200            <- approvedAmount
    Est: Rs 1,92,650       <- shown only when it differs

Someone built UI specifically for the case where UGVCL approves a figure other than the one
submitted. The app expresses that case fully.

**What does not exist.** `BillingSystem` contains **zero** references to `approvedAmount`. It
also deliberately ignores the stored `estimateAmount`, recomputing instead (see the note at
`:2976`). So when an approval differs from an estimate, the bill claims a THIRD figure -
independently recomputed from today's master - matching neither the approval nor the
estimate. Nothing on the invoice indicates this.

**Why this is now structural rather than incidental.** Before F57 the bill and the estimate
were two engines drifting, and a mismatch could be blamed on that. After F57 they agree by
construction, so any difference from the approved figure is no longer noise - it is the app
declining to claim what the DISCOM authorised.

**THE QUESTION, and it is a tender question, not a code one:** should the bill follow the
approved amount when one is recorded? The instinct on the operator side is yes - the DISCOM
approved a figure and the claim should match it - but that needs confirming with the
agencies, because the alternative reading is defensible: the approval authorises the work,
and the bill claims what the work actually came to.

Three outcomes:

- *UGVCL never approves a revised figure* -> `approvedAmount` is decorative, and the entry
  closes as documentation.
- *They do, and the bill follows the approval* -> `calculateJobTotal` should return
  `approvedAmount` when present and fall back to the computed total otherwise. Bills issued
  to date have then been claiming un-approved figures.
- *They do, and the bill follows the work* -> the field stays a record of what the DISCOM
  said, and the invoice should probably show it beside the claim so the difference is
  visible rather than silent.

**Worth asking alongside it:** has a bill ever been queried or short-paid for not matching an
approval? `paymentDeductions` exists on the payment record, which is where that would show.

---

### O30. The Overhauling master has never been checked against the tender

Left untouched during the typo correction, and the reason matters: **those rows were never
validly checked, not checked and found correct.**

`scripts/override-vs-schedule-console.js` scanned the Overhauling section using
`SCHEDULE_ITEM_MAP`, which pairs **CRGO** master codes with Schedule-A sr values. The
overhauling master reuses the same short codes for entirely different items, so the scan
compared unrelated things and reported the mismatches as overrides:

    OH '3' Tank replacement per kg (54)        vs sr '3' Inside painting of tank (156)
    OH '5' Complete radiator replacement       vs sr '5' Oil level gauge glass (46)
    OH '6' Sealing of uneconomical unit (189)  vs sr '6' Breather (309)

Every one of those "overrides" was the script comparing a radiator to a gauge glass. This is
the terminology hazard already recorded - **an item code means different things in different
sections**, the same collision that put the scrap charge under four codes - reproduced by the
tool written to find data errors. The script now scans CRGO only and says why in place, so
the OH scan is not re-added as an oversight.

**Which leaves the Overhauling master genuinely unaudited.** No mapping exists from its item
codes to the tender, so nothing has ever compared its stored rates against anything. It could
carry slips of exactly the kind found in the CRGO 100 kVA column and nobody would know.

**One discrepancy is visible without a map and is unexplained.** The OH radiator rates sit
close to, but not equal to, Schedule-A sr '20':

    OH master:      1057    1256    1452
    Schedule-A 20:  1052    1248    1446

Five, eight and six rupees apart. Too close to be independent rates and too far to be equal -
the shape of a transcription slip, or of a different tender revision, or of a deliberate
overhauling premium. Which of those it is cannot be settled by inspection.

**What this needs is an Overhauling-to-Schedule map**, the same shape as `SCHEDULE_ITEM_MAP`
but for the OH section's five rows. That is a small piece of data and a domain question per
row - and it is the only thing that would make the OH master checkable at all. Not built,
because guessing the pairings is how the CRGO false positives were produced in the first
place.

---

### O31. A five-section write to fix eight cells in one section, confirmed by a dialog that counted the wrong thing

The hazard the fan-out was built with, firing on its first real use.

**What happened.** Eight mistyped cells, all in CRGO, were corrected on one agency and
applied to three others with "Apply to my agencies". `buildSectionPayload()` returns ALL
FIVE sections from the source, and `updateDoc` replaces each array wholesale - so
`estimateMasterOverhauling` and `estimateMasterCircleLimits` on the targets were overwritten
with the source's, to fix eight cells that had nothing to do with either.

**The confirmation dialog did not say so, and could not.** `countOverridesForApply` iterates
the INCOMING items and looks each up in the target by item code. A row present in the target
and absent from the payload is never visited, so it is never counted. The dialog reports
**cells whose value changes**; it is blind to **rows that disappear**. For a section where
the source is thinner than the target, the entire loss is silent.

That is the same defect shape this audit keeps finding, in the safety mechanism itself: the
count is real, the arithmetic is right, and it measures something narrower than what the
reader takes it to mean.

**Two guards that should have caught it did not:**

- `blockPublishIfFallbackResolved` **exempts `CIRCLE_LIMITS` entirely**
  (`.filter(sec => sec !== 'CIRCLE_LIMITS')`) and treats an empty Overhauling as normal -
  correctly, since empty Overhauling IS the normal state. But "empty is normal" and "safe to
  broadcast" are different claims. If the source stored nothing, `publishPlanFor` sends the
  SCREEN content, which for an empty stored section is the resolved shipped shell - written
  to every target as though it were data.
- The dialog's per-section breakdown lists only sections with counted differences, so a
  section being replaced wholesale with zero cell-level differences appears nowhere at all.

**Whether anything was actually lost cannot be determined after the fact.** `updateDoc`
replaced the arrays and the app keeps no history. `scripts/overhauling-after-fanout-console.js`
narrows it - if every agency now holds an identical section equal to the shipped shell, the
fallback was written as data; if agencies still differ, those were not overwritten - but the
prior value is not recoverable either way. **The absence of a before-snapshot is the finding**,
not a gap in the investigation.

**What the fix needs to be**, when it is made:

1. The count must report rows ADDED and REMOVED per section, not only cells changed.
2. The dialog must name every section the write will touch, including ones with no
   differences - "this will also replace Overhauling (5 rows) and Circle Limits (5 rows)" is
   the sentence that was missing.
3. Better still, the action should send only the sections the user edited. Fixing CRGO
   should write CRGO. The five-section payload exists because it was modelled on the admin
   publish, which has its own reasons for being wholesale.

Recorded as an open item rather than fixed, because the fix changes what the action does and
that wants deciding rather than assuming.

---

### O32. Changing a rate on another account's agencies: reachable, not exposed, and a product decision

**There is no route in the app**, and correcting six mistyped cells across seven agencies on
two accounts therefore took seven manual passes. Worth recording precisely what stands in the
way, because it is less than it looks.

**The permission already exists.** `firestore.rules:256` allows an agency update when
`existing().ownerId == request.auth.uid || isSuperAdmin() || ...` - the super admin may write
any agency document. Reads too: `allow get, list` includes `isSuperAdmin()`, and
`AdminPanel.tsx:65` already calls `getDocs(collection(db, 'agencies'))` unfiltered, so every
agency on every account is already enumerable by that account.

**Only a client-side filter stands in the way.** `AgencyContext` loads
`where('ownerId','==',uid)`, so every rate-writing path in the UI operates on a list that
structurally cannot contain another user's agency - including
`applyEstimateMasterToOwnAgencies`, which additionally filters its targets against that
owned set. Nothing joins the admin's existing permission to the admin's existing list.

**So it is reachable by console script today**, and one already exists in that shape:
`scripts/seed-agencies-from-public-config.js` is write-capable, ships `MODE = 'dry-run'`, and
writes agency sections; `scripts/all-agencies-census-console.js` already reads across owners
successfully. Exposing it in the UI would be a small change.

**NOT A TASK, and the reason is not technical.** An admin overwriting rates on accounts
belonging to people who are not in the room is a materially different power from anything the
app currently offers. Everything built this session assumed the actor owns what they are
changing - the override count in "Apply to my agencies" exists so an operator can see what
their own decision destroys. Pointed across accounts, that same dialog would be reporting
what it destroys **for someone else**, to a person with no way to ask them.

For a once-a-tender operation, a deliberate script with a dry run may be the right level of
friction rather than a button. A button invites use; a script requires intent, leaves the
diff on screen before it writes, and cannot be pressed by accident. That is a reasonable
place for this power to live, and moving it needs a decision about the product rather than a
fix to a defect.

---

### O33. The MR delete path: MR-scoped, orphans inspections, and no guard on issued documents

`MrLedger.handleDeleteEntireMr` (`:411`) is the only real deletion in the app -
`deleteDoc` is imported in `AdminPanel.tsx` and `MrLedger.tsx` and never called in either.
It does this and nothing else:

    const batch = writeBatch(db);
    for (const j of deleteConfirmMr.jobs) batch.delete(doc(db, 'jobs', j.id));
    await batch.commit();

Three gaps, worst last.

**1. IT IS MR-SCOPED.** There is no way to delete one transformer. Deleting an MR deletes
every job on it, so a scratch record sharing an MR with real work takes the real work with
it. The operator's intent ("remove this test row") has no expression in the UI.

**2. IT ORPHANS INSPECTIONS, SILENTLY AND UNCOUNTED.** `inspections` is the only collection
storing a `jobId`, and nothing deletes them. Both inspection screens and `TestingReport`
write there, so a deleted job leaves its external and internal records behind, keyed to a
document id that no longer resolves. `oilTransactions` keys on `mrNo` rather than `jobId`
and is stranded by a different route.

The confirmation says *"This will permanently delete all N transformer record(s) associated
with this MR"* - it names the jobs and not the inspections, and gives no count of what it
leaves. That is the O31 shape again: a dialog describing part of what a write does.

An orphan is not immediately dangerous - the maps that index inspections by `jobId` simply
never look the orphan up, and Firestore does not reuse document ids. The cost is the one
this audit keeps meeting: **a stored record asserting a relationship that no longer holds**,
which every later census has to recognise and explain.

**3. NO GUARD ON ISSUED DOCUMENTS - and this is the one that matters.** The batch deletes
regardless of `billNo`, `estimateSentDate`, `paymentStatus` or `issuedByAgencyId`. An MR
whose bill has been sent and paid can be deleted in two clicks, leaving the bill referenced
by nothing.

**C3's refund depends on exactly those records surviving.** MSBT-12 / MR 1 carries BILL/1,
`paidAmount` 6,680, and a refund owed to the division. Deleting that MR would remove the
only evidence of what was billed, to whom, and by which agency - `issuedByAgencyId` was
added in O14 precisely so an issued document's supplier could not be lost, and it lives on
the job document that this path deletes. The remedy would survive only in this file.

**What a fix needs**, in order of value:

1. Refuse to delete any MR carrying an issued document - bill number, estimate sent date, or
   recorded payment - and say which job blocks it. This is a few lines and closes the only
   irreversible case.
2. Count and name the inspections in the confirmation, and delete them in the same batch.
3. Per-job deletion, so removing a scratch row does not require removing its MR.

**Not built.** Deletion is the one operation with no undo, and building cascade deletion
against live data to tidy a handful of records is the wrong trade - see the five undated
AARATI jobs, where backfilling one field is reversible and deletes nothing. Recorded so the
gaps are known before someone reaches for the button, not after.

---

### O34. Subscription: a feature that appears to work and has no consumer

`AdminPanel.handleUpdateSubscription` writes four fields to an agency:

    subscriptionStatus       status
    subscriptionPlanAmount   planAmount    (default 3999)
    subscriptionLastPaid     now
    subscriptionExpiryDate   now + one year

**Three of the four are named differently from the fields `firestore.rules` was written to
validate**: the rules name `subscriptionPlan` and `subscriptionExpiresAt` (`:141-143`), and
`subscriptionLastPaid` appears in them nowhere. `isValidAgency` only validates fields it
names, so the mismatched ones pass through and persist - they are simply outside every check
that was meant to cover them.

**Only `subscriptionStatus` is ever read**, and only inside `AdminPanel` itself (`:236`,
`:237`, `:417`). `subscriptionPlanAmount`, `subscriptionLastPaid` and `subscriptionExpiryDate`
are written by one function and read by nothing, anywhere in the codebase.

So an administrator sets a subscription to expire in a year, sees a confirmation saying so,
and **nothing enforces or displays that expiry**. No screen shows it, no gate consults it, no
job is refused when it passes. The feature is complete from the operator's side and absent
from the system's.

**It slipped past the checker even where the type WAS consulted**, because every read goes
through `(agency as any).subscriptionStatus`. That is the cast pattern recorded in the note
above - reached for to silence a complaint, and still silencing it now that the types are
installed.

The four fields are now declared on `Agency`, so the WRITE is type-checked. That is all this
entry changes. Whether the feature should exist - and if so, what should consult the expiry -
is a product question nobody has been asked.

---

### O35. The wrong-agency check already exists, one layer down, in the prefix

**Not built.** A field capturing what the division wrote on the MR — `mrAddressedTo`, an
agency-name classifier over the owner's agencies, a stopword list, a scoring function —
was designed, built, and removed before it shipped. The reason it was removed is worth
more than the feature was.

**Every job number carries its agency in its prefix.** `SU-45` is SUCHIT's, `PLN1-45` is
UPENDRA's, `AAGNR-45` is AARATI's. An MR booked under the wrong agency shows up as a
prefix that does not belong there. No new field, no free-text transcription to tune a
matcher against, no classifier to maintain — the fact is already in the data, and it is
in the one piece of data that gets written onto the physical transformer.

The proposed field would have re-collected, in free text and unreliably, information the
system already held structurally.

**Where the check is a tautology.** `getJobNoPrefix` (`AgencyContext.tsx:1157`) reads
`sourceAt.prefixes`, falling back to `activeAgency.prefixes`. Both belong to the agency
being booked into. So an AUTO-GENERATED number is always internally consistent — it is
derived from the very thing it would be compared against. Checking it would prove only
that assignment works. **The wrong-agency case cannot arise in the app on this path at
all.** It arises on the division's paper, which is theirs to correct.

**Where it is not, and is already enforced.** The job-number field is editable — the
error text says "or use auto-generate". Both OGP save paths (`NewJob.tsx:1224`, `:1339`)
refuse a number that does not start with the active agency's own prefix. So an operator
copying numbers off an MR the division agreed with a SIBLING agency is refused today.
That is the whole feature, shipped, predating the audit.

**Two gaps in it.**

1. **The refusal names the prefix, not the agency.** `Invalid Job Number prefix for OGP
   job "SU-45". Expected prefix starting with "PLN1-"` reads as a formatting complaint.
   The operator retypes `PLN1-45` and books under the wrong agency with a number that
   belongs to nobody — the exact outcome the check existed to prevent, reached by
   obeying it. The missing sentence is *"SU- is SUCHIT's prefix; you are booking into
   UPENDRA"*, and every input for it is already loaded at that line.

2. **GP jobs are not prefix-checked at all.** The guarantee branch validates that a
   number was entered and a previous delivery date exists; it never looks at the prefix.
   Arguably right, since the number is historic — but it is the unguarded door, and it
   adjoins O1 (GP lookup matching the wrong transformer).

**A precondition that does not hold.** `scripts/admin/prefix-distinctness.js` checks what
the whole argument rests on: that a prefix identifies exactly one agency. It does, except

    owner nzPCcm3p:  SUCHIT   DEESA/OH -> "OH21 IS"
                     UPENDRA  DEESA/OH -> "OH21 IS"

For overhauling jobs in DEESA the prefix identifies nothing, the save check passes either
way, and both agencies can issue `OH21 IS-5` to two different transformers. Whether the
division genuinely issued the same OH prefix twice or someone copied a settings page is a
question for the operator. **DATA, not code** — but the code's guarantee is only as good
as it.

**The pattern.** Third time in this audit that a proposed feature turned out to duplicate
an existing mechanism rather than add one: three estimate engines (F41), two job-number
allocators (F68), and now a wrong-agency check that already existed in the prefix. The
common shape is a fact the system holds STRUCTURALLY being re-collected as free text,
where it is weaker. Before adding a field that records something about an entity, check
what the entity's identifiers already encode.

---

### F71. Three effects in one commit, and two absences dressed as facts

**The report:** "the prefix is still not appearing in the job number box." What the box
actually contained was **`JOB-1`** — not empty, not a bare number, but a plausible-looking
value that was wrong in both halves, produced by three faults firing in the same tick.

**THE EFFECT ORDERING.** Three effects are declared in `NewJob.tsx` and all run in the same
commit, in declaration order:

    310  division-init      setCommonData({ division: 'DEESA' })   <- queued, not applied
    332  suggest-into-blank reads commonData.division === 'SABARMATI'   <- STALE
    379  pastJobs fetch     setPastJobsLoading(true), then fetches       <- HAS NOT RUN YET

The suggestion effect read state that another effect in the same commit was about to set,
and state that a third had not yet begun to load. Neither is a race in the concurrency
sense — it is deterministic and reproduces every time.

**THE OUTPUT SUPPRESSED ITS OWN CORRECTION.** The effect carries `⚠ ONLY BLANKS`, so a row
the operator has typed into is never touched. Having written `JOB-1` into a blank row, the
row was no longer blank — so when the division settled and again when the jobs arrived, the
effect re-ran and skipped it both times. The guard that protects the operator's typing
protected the app's own bad first guess just as well.

**This cost nothing only because no counter moves.** The same shape with a write is the
reservation bug exactly: an effect that runs before its inputs are ready, whose output then
prevents the correction. F60 was this with an allocator behind it. Keep effects out of the
job-number path (see the ⚠ above the one effect that remains).

---

**TWO ABSENCES INTERPRETED AS FACTS**, found together, the same mistake at two scales.

**1. `getJobNoPrefix` returned the string `'JOB'` when nothing was configured.**

It made the missing-prefix case *undetectable*: `if (!prefix)` never fires, because `'JOB'`
is truthy. Every caller inherited that. And it shipped a plausible wrong value rather than
failing, so an unconfigured division produced `JOB-1` in a job-number box, with nothing
anywhere saying that no prefix was set.

Now returns `string | null`, and an empty or whitespace-only configured value is normalised
to null too — a settings field opened and cleared read as configured otherwise, which is the
same fault one layer in.

**2. `pastJobsLoading` started `false`.**

Between mount and the fetch effect running, it reads "not loading" — which any consumer
takes as "loaded", with `pastJobs` still `[]`. The saved-jobs maximum computed as 0 and the
suggestion said `SU-1`: one past nothing, wrong by the agency's entire history.

Replaced by `pastJobsLoaded`, which starts false and is only ever set true by the read
completing, so "not yet known" and "known to be empty" cannot be confused. It is also reset
when the agency changes — the previous agency's jobs are not an answer about this one.

**3. `division` was hardcoded to `'SABARMATI'`.**

On live data most agencies do not have it: SUCHIT and UPENDRA are DEESA only, AARATI is GNR
only. Now initialised to `''` — the honest value for "not loaded yet" — and set from
`availableDivisions` by the effect that already existed. A default that is wrong for most
agencies is not a default.

---

**THE COMPILER CAUGHT NOTHING.** Changing the return type from `string` to `string | null`
produced **zero** `tsc` errors, across seven call sites, two of which composed the value
straight into a job number.

`tsconfig.json` sets no `strict` and therefore no `strictNullChecks`, so `string | null` is
assignable to `string`, `null + '-'` is a legal expression yielding `"null-"`, and
`` `${null}` `` is legal too. Every call site had to be audited by hand.

Second time in this audit a green check has been worth materially less than it looked: the
first was `@types/react` being absent while `tsc --noEmit` was cited as evidence across a
whole session. The lesson is the same one, and it is not "add the flag" — turning on
`strictNullChecks` here is a large, separate change. It is that **`tsc --noEmit` passing on
this repo is not evidence that a null cannot reach a string.**

What the seven call sites needed:

| site | before | after |
|---|---|---|
| `setupGapForPrefix` | `if (info.prefix === 'JOB')` | `if (!info.prefix)` — **this was the trigger for the whole dialog**; changing the sentinel without it would have made the setup gap undetectable, reintroducing the exact fault the change was fixing |
| save prefix check ×2 | `startsWith(info.prefix + '-')` → `"null-"` | `setupGapForPrefix` moved **above** the composition |
| `rowJobNoPrefix` | declared `: string` | `: string \| null`, plus `rowHasNoPrefix` for the UI |
| `predictNextJobNo` | `{ prefix: 'JOB', … }` | `{ prefix: null, … }` |
| `MrLedger` add-unit | already `if (prefix)` | unchanged — the only site that was correct |
| `suggestNextJobNo` | `if (!prefix) return ''` (dead) | now live |

**Still outstanding, same shape, not changed:** `availableDivisions` falls back to the
literal `['SABARMATI', 'GANDHINAGAR', 'AHMEDABAD']` when an agency has no prefixes at all.
An agency mid-setup is offered three divisions it does not have, and the new message then
reads "No prefix configured for SABARMATI" — naming a division that is not real. Flagged
rather than changed: emptying it leaves the division dropdown blank, which is a product
decision.

---

### F72. Pricing followed the session's AT, not the job's — and the plan for fixing it undercounted the sites by eleven

**The defect.** Every pricing path passed `activeAtMaster` — whichever AT the operator has
selected right now — to `getAtPercentageForCore`. Not one read `job.atId`. So selecting a
new AT after a rollover silently re-priced every historical job at the new tender's
percentage, and that percentage multiplies **every line of every estimate and every
invoice**.

It also reached paper. The printed estimate sheet and the printed tax invoice do not read
stored figures — they **recompute at render** through `buildSingleJobEstimateData` and
`calculateJobTotal`. So a reprint of an already-issued estimate would have restated it at
the new percentage, and the copy in the file would no longer match the screen. The ledgers
(`estimateAmount`, `billAmount`) are frozen and were never at risk; the documents were.

Fixed by passing `atForJob(job, atMasters) ?? activeAtMaster`. The engines —
`buildSingleJobEstimateData`, `calculateJobTotal`, `resolveRate`, `resolveScrapCharge` —
are untouched. Only what is passed IN changed.

---

**THE COUNT WAS WRONG IN THE APPROVED PLAN: 25 sites, not 14.**

The plan was approved on the strength of "the 14-site signature change is mechanical." The
real figure was 25, and two whole files were missing from it:

| | |
|---|---|
| 15 | `getAtPercentageForCore(activeAtMaster, X.coreType)` — EstimateGenerate ×9, BillingSystem ×6 |
| 8 | the AT argument into `getJobFullEstimate` / `checkJobCircleLimit` — EstimateGenerate ×2 (**local wrappers**, covering ~14 callers between them), BillingSystem ×3, **Reports ×1**, **InternalInspection ×2** |
| 2 | the `atMaster` prop on `SingleJobEstimateReport` — the sheet that recomputes |

**`Reports.tsx` and `InternalInspection.tsx` were affected and absent from the plan.** Both
compute estimates; both passed the session's AT.

**The cause was a truncated grep.** The inventory was built from output piped through
`head`, and the tail was never read — so the count reported was the count *displayed*, not
the count that existed.

This is the F41 shape exactly: a sweep whose result was reported with more confidence than
its method supported. F41 was a sweep truncated before the judgement; this is a sweep
truncated before the count. Both produced a number that looked like a finding.

It is also the fourth time in this audit a check has reported outside its own model — the
others are recorded in `read-counters.js` (delta-must-be-1) and
`suggestion-source.js` (a counter key matched by division prefix rather than by core type).

**The rule this leaves:** an inventory that is going to be *approved on* must be produced
without `head`, `tail`, or `| head -N`, and the count must come from `grep -c` or `wc -l`
over the whole result — never from reading a screen of it.

---

**THE THREE AT CASES, kept apart** (`atResolutionForJob`):

| source | meaning | pricing | live count |
|---|---|---|---|
| `own` | `atId` names an AT that exists | that AT | 52 |
| `no-at` | no `atId` — never recorded a tender | documented fallback | 12 |
| `at-missing` | `atId` names an AT that is **gone** | documented fallback, **and warned** | 0 |

`no-at` and `at-missing` take the same fallback deliberately — a job whose tender was
deleted still has to be priceable, and blocking the estimate would strand real work. But
collapsing them to one `null` was the defect one level down: a job that HAS a recorded
tender priced from whatever is selected today, with nothing saying so. The estimate screen
now names the affected job numbers and the AT they are actually being priced from.

Built at zero live instances, which is the point: the first one would otherwise arrive
unannounced.

**The cause is unguarded, and is NOT fixed here.** Nothing prevents deleting an AT that
still has jobs under it. The app has no AT delete at all — `AtSettings` creates and
updates only — but `firestore.rules:264` permits it for the owner, so the console and the
Admin SDK are open routes. The banner is a symptom fix. `allow delete: if false` on
`atMasters` is the cause fix and is not applied: it is a privilege narrowing, and an AT is
a tender record that `status: 'Closed'` already exists to retire.

**Verification.** `scripts/admin/at-resolution-census.js`, run before and after: section 1
("jobs whose printed figure moves") is empty in both. On this data every job that resolves
its own AT sits under the AT active for its agency, so the fix is a provable **no-op** —
which makes any price difference afterwards a regression, full stop. For `AMSBT-1` the two
resolutions return the *same document* (`Unu1F8JR9koc9gamfgfL`), so the argument reaching
the untouched engine is identical and the grand total cannot differ.

---

### F73. Three writers to `public_config`, and the two rates nobody has

**The task was to replace one publish button.** "Publish to public_config" was to become
"Publish this AT as a template", so that a shared baseline is a published tender rather than
an agency-level document — rates having moved onto the AT.

**There were three writers, not one.** The other two were found by grepping for the
function names rather than by looking at the button, and neither is reachable from a control
called "publish":

| Writer | How it is reached |
|---|---|
| `handleExecuteFullSync` | the "Publish as shared default" button — **the one that was known about** |
| the per-section save modal, `saveScope === 'ALL'` | an admin **radio inside the ordinary Save dialog**, sitting beside "save for this agency" |
| `updateAllAgenciesEstimateMaster` | called by that radio's branch |

The second is the one that matters. An admin editing a single section, in the dialog they use
every day to save their own rates, could publish the shared baseline by picking the *other
radio*. Nothing in that dialog is named "publish" until you read the radio's label. F31 had
already recorded that this dialog "counted the wrong thing"; what it did not record is that
one of its two options wrote a different document entirely.

**THE DRIFT IS MEASURABLE, AND IT IS TWO CELLS.**

`scripts/admin/_pc*.js` compared `public_config` against every agency:

| Row | Cell | public_config | Most agencies |
|---|---|---|---|
| `1f` Drying of active parts | 100 KVA | **230** | `null` |
| `11B` LV Connector | 100 KVA | **148.99** | `null` |

Every other cell of every other section is identical everywhere. SUCHIT matches on both;
UPENDRA on `1f`; MEGHA, suchit, DRISHIV and AARATI have neither.

That is the residue of the eight-cell correction earlier in this audit: filled in the
baseline through one writer, applied to some agencies through another, and never reconciled
because no single action wrote both. **Two publish paths writing to different layers is not a
tidiness problem — it is how a baseline and the things derived from it stop agreeing, one
cell at a time, with nothing reporting it.**

**AND THE FIRST MEASUREMENT WAS WRONG.** The comparison initially reported **31 of 32** CRGO
rows as differing. `JSON.stringify` treats a different KEY ORDER as a difference, and two
documents written through different code paths hold the same rates in a different order. The
real figure is two. `master-equivalence.js` used the same comparison and had been giving the
right answer by luck — the migration copied arrays verbatim, so key order was preserved. Both
now use a stable stringify.

Fifth check in this audit to report confidently outside its own model. The others:
delta-must-be-1 in `read-counters.js`, a counter key matched by division prefix in
`suggestion-source.js`, the `head`-truncated inventory in F72, and the exact-string
comparison that could not detect mistyping.

**WHAT REACHES `public_config` NOW: ONE AGENCY.** Only IDEAL ENGINEERING COMPANY resolves
through it — no sections of its own, no ATs. Every other agency answers from its AT or its
own sections first, and the migration copied *agency* sections onto the ATs, so the ATs carry
the `null` version rather than the baseline's 230 and 148.99.

So freezing it creates no drift; the drift already exists and is already unreachable. **The
risk is the opposite one: it becomes a fossil that still looks authoritative** — two rates in
a document labelled "the shared baseline", which nothing reads and nothing updates, is how
someone concludes in a year that the app's baseline says 230 when no live estimate has ever
used it.

**Resolved:** all three writers deleted. Publishing is one action, "Publish this AT as a
template", writing `published_ats`. `public_config` stays as the resolution fallback and has
no writer. The `frozenAt` stamp that would say so in the data is NOT applied — it is an
additive write to a live document and was not asked for.

**The rule:** before replacing a control, count the writers to what it writes — by grepping
the function it calls, not by trusting the control's name. A second path is unlikely to be
labelled like the first; the one here was a radio button in a Save dialog.

---

### F75. Two correct commits, three days apart, that stopped anyone creating an AT

**Creating an AT failed with "Missing or insufficient permissions".** Not a privilege
problem, and nothing to do with the rules change that was suspected — the deployed ruleset
was byte-identical to the repo.

**The mechanism.** `serverTimestamp()` resolves to a Firestore `timestamp`. Every validator
spelled its time fields out by hand:

    (!('createdAt' in data) || (data.createdAt is number || data.createdAt is string))

A `timestamp` is neither. The clause evaluates false, the whole `&&` chain is false, and the
write is refused.

**Neither commit was wrong.**

| | |
|---|---|
| `e8235e0` (18 Aug) | added the `is number \|\| is string` clauses — correct when nothing wrote a `timestamp` |
| `f744ba6` (23 Aug) | *"stamp creation time on agencies and AT masters"* — started writing `serverTimestamp()`, correct because a client clock is not to be trusted |

Each is defensible alone. Together they refuse every create. Nobody reviewed the writer
against the rule, because the rule is in a different file, a different language, and is
deployed by a different action.

**IT WENT UNNOTICED FOR THREE DAYS BECAUSE NOBODY PERFORMED THE ACTION.** The evidence is in
the data: **all six existing ATs have `createdAt` ABSENT**, and so do all seven agencies.
Every one predates `f744ba6`. Not a single document has ever been created successfully since
the stamp was added — the failure was total, and total failure of an action nobody takes is
indistinguishable from everything working.

**Two more collections had it, and one was invisible for the same reason.**

| Validator | Writer | State |
|---|---|---|
| `isValidAtMaster` | `addAtMaster` | the reported failure |
| `isValidAgency` | `addAgency` (`AgencyContext.tsx:1172`, identical shape) | **same defect**, unnoticed — 7 agencies, all `createdAt` ABSENT |
| `isValidOilTransaction` | `OilInward.tsx:255` | **same defect**, latent |

The oil case nearly escaped notice a second time. Its four transactions **do** carry
`Timestamp` values, which looks like proof the clause accepts them — and that validator alone
carried `|| data.createdAt is map`, which reads like somebody's fix for exactly this. Both
readings are wrong: the transactions were written **12–15 August** and the clause landed on
**18 August**. They predate it. `is map` has never once been evaluated against a
`serverTimestamp` write, and nobody has created an oil transaction since.

**A near-miss worth recording on its own:** existing data that survived a rule is only
evidence about the rule if the data was written *after* the rule was deployed. Checking the
dates is what separated "this clause works" from "this clause has never run".

**F45 IS THE SAME BUG, ALREADY RECORDED, ALREADY SOLVED THE OTHER WAY.** Inspections were
reverted from `serverTimestamp()` to `Date.now()` for precisely this reason. So the trap was
known, written down, and left in place — the rule was never widened, so the next writer to
reach for the server clock fell into it. Fixing the symptom at one writer left the cause for
the next.

**Resolved.** One helper, `isTimeValue(v)`, accepting `number`, `string`, `timestamp` and
`map`; **12 clauses across every validator** now call it. Widening an accepted TYPE is not
widening a permission — who may write is untouched. `Date.now()` was rejected as the fix: it
would undo the point of `f744ba6` to satisfy a rule, and F45 shows where that leads.

**Why one function rather than twelve corrected copies:** twelve hand-written copies of one
clause is what let them drift in the first place — one of them already carried `|| is map`
that no other had. A single definition cannot drift from itself.

**The rule this leaves:** a validator and the code that writes to it are one change, not two.
When a write starts sending a new field or a new TYPE, the rule is part of that commit —
being in another file and another language does not make it another change.

---

### F76. The asymmetry test: a rare harmless case against a rare catastrophic one

**The question was small: how do you delete an AT created by mistake?** `allow delete: if
false` sits on `atMasters` because a tender is a record and `status: 'Closed'` exists to
retire one — which leaves a typo permanent. Refusing to remove a typo is its own kind of
wrong.

**The obvious answer does not survive contact with the rules.** The guard that matters is
"no job carries this atId", and a Firestore rule **cannot express it**: rules have `get()`
and `exists()` on a *known document path* and no query at all. So an in-app delete needs the
rule to permit any owner delete, with the guard living in the UI — where the Firebase
console, the Admin SDK, and any bug in that screen all walk straight past it. The rule stops
being a guarantee and becomes a convention.

---

**THE ARGUMENT WORTH REUSING — and it is not about ATs.**

Two rare events. Weigh them by CONSEQUENCE and by WHO IS PRESENT, not by frequency.

| | Deleting a typo AT | Deleting a live tender |
|---|---|---|
| how often | rare | rare |
| urgency | never urgent | — |
| who is there | someone who has **just noticed the mistake** | someone who thinks they are doing something else |
| if it goes wrong | a stray document | every job under it becomes `at-missing`, prices from whatever AT is selected today, and **the printed estimate recomputes** — the paper in the file stops matching the screen with nothing announcing it (F72) |
| noticed? | immediately | **silently, possibly never** |

Both are rare, so frequency does not separate them. What separates them is that one failure
announces itself to someone already paying attention, and the other does not announce itself
at all. **Paying a minute on the harmless case to make the dangerous one impossible BY RULE
rather than by convention is the trade.** The cost falls on the case where someone is already
looking; the protection covers the case where nobody is.

**THIS IS THE SHAPE THE RESERVATION MODEL GOT WRONG, INVERTED.** F70 recorded a design that
spent a real, certain, frequent cost — a job number burned on **every dropdown flip** — to
close a window that was rare and, since F62, already handled by a refused save. Here the
certain cost is a minute on an action nobody takes twice a year, and what it buys is a
catastrophic silent failure made unreachable. Same two quantities, weighed the right way
round.

The test that distinguishes them: **who bears the cost, and does the failure announce
itself?** A guard whose cost lands on the attentive case and whose protection covers the
unattended one is worth paying for. One that taxes the common path to cover a rare path that
already has a safety net is not.

---

**REJECTED: a denormalised `jobCount` on the AT.** Rules *can* express
`resource.data.jobCount == 0`, so the guard would be real. But every job create and delete
would then have to write its AT transactionally, and a counter that drifts **wrong-low
permits deleting a tender that has jobs** — precisely the outcome the guard exists to
prevent. It converts a query we cannot do into an invariant we must maintain forever, and
its failure mode is the disaster rather than an inconvenience.

**REJECTED: admin-only delete in the app** (`allow delete: if isSuperAdmin()`). Genuinely
rules-enforceable and a reasonable middle. Not taken because it still permits a live tender
to be deleted — it narrows *who* can cause the catastrophe rather than making it
unreachable.

**CHOSEN: `scripts/admin/delete-at.js`.** `allow delete: if false` stays untouched, so no
privilege widens and no path through the app can delete an AT. The Admin SDK bypasses rules
anyway, so the script is not an exception carved into them — it is the only door, and the
guard is enforced **by the same thing that performs the delete**, which is the one
arrangement it cannot be walked around.

It names the AT, its agency, status, period, `ratesSource`, rate sections, prefixes,
counters, allotments and allotment history; refuses with the full job list if anything
carries the `atId`, pointing at `Closed` instead; and **re-queries `jobs` immediately before
deleting**, because the listing came from a snapshot taken at the start of the run and an
intake saved in between would be orphaned silently. `MODE = 'dry-run'` in the repository.

---

## DELIBERATE — reviewed and kept, not defects

### D0. Job numbers are DERIVED, and typing over one does not persist

**This is the model, chosen deliberately. It is not a defect and must not be "fixed".**

A job number in New Job is computed from the agency's saved jobs, the division and the row's
core type — `getAutoJobNo`, plus the sync effect above it. The field is editable, but the
computation is authoritative, so a typed value does not survive the next recomputation:

- **changing a row's core type** rewrites `jobNo` on **every** row in the form
  (`handleTransformerChange`, the OGP branch — an unconditional `.map`);
- **changing the division**, or `pastJobs` reloading, fires the sync effect
  (`NewJob.tsx` deps `[division, repairType, activeAgency, activeAtMaster, pastJobs, pastJobsLoading]`),
  which replaces any row where `t.jobNo !== correctNo` — which is precisely a row the operator
  typed differently;
- a row with **no core type** has its number set to `''` rather than recomputed.

**Why it is kept.** The prefix and the sequence both come from configuration the operator
does not control — the division, the core type, the AT's prefixes, the agency's saved jobs.
Deriving the whole number keeps it consistent with all four by construction, and makes a
wrong prefix unconstructible rather than merely refused at save. A guard that let a typed
value stick would mean two sources of truth for the same field, and the app cannot tell a
deliberate override from a stale value left behind by a dropdown change.

**What was considered and rejected.** A per-row ledger of the last auto-assigned value
(`rowKey -> value`), so a box still holding the app's own suggestion could be recomputed and
anything else left alone. It works, and it was built and reverted. Rejected because it
reintroduces the ambiguity above for the sake of a case the derived model says should not
arise: if the number is derived, there is nothing to override.

**The consequence to be aware of.** An operator who types a number from the MR paper and
then touches a dropdown loses it, silently. If that turns out to matter in practice, the
correct response is **NOT** the guard — it is to make the field read-only, so nothing can be
typed and then discarded. What must not stand is an editable field whose contents are thrown
away without warning; either the number is the operator's or it is the app's.

**History.** This behaviour has changed three times: an allocator that reserved numbers on
entry (F60, F65, F69, F70), a period where the operator typed the number and the app only
suggested, and the current derived model introduced by `c1eabbe`. Read F70 before changing it
a fourth time — that entry is about what the reservation model cost, and the failure it
records is a number changing under an operator mid-entry.

---

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

### D4. The legacy `estimateMaster` field: writes stopped, reads kept

`estimateMaster` is the pre-sections CRGO field. Five paths mirrored `estimateMasterCRGO`
into it - `EstimateMaster.tsx` at 663, 902, 937 and 982, and `AgencyContext.addAgency` at
680, which meant every agency was BORN with a duplicate. All five now stop.

**Nothing reads it on any reachable path.** `getEstimateMasterForCore` resolves
`agency.estimateMasterCRGO` -> `globalDef.estimateMasterCRGO` -> `agency.estimateMaster` ->
`globalDef.estimateMaster`, so the legacy field sits behind public_config's CRGO section,
which exists. The CRGO editor loader has the same order. The two readers in
`EstimateGenerate` (344, 1645) are on `selectedJobsData.length === 0` branches, and
`handleExportExcel` returns early on exactly that condition - dead code.

**THE READS STAY, DELIBERATELY.** Three reasons, in order of weight:

1. "Unreachable" here is a claim about DATA, not about code. Steps 3 and 4 become live if an
   agency's CRGO section is empty AND public_config's is empty or failed to load. That state
   cannot occur today; it is not prevented by anything structural.
2. Removing a read is a behaviour change in a path no test covers, and the change would be
   invisible until the rare state occurred - which is the failure mode this whole audit is
   about.
3. There is no benefit. The stored data is inert once nothing refreshes it. Deleting the
   reads buys tidiness and risks a silent reprice.

The read site now carries a comment saying all of this, because the next reader will
correctly identify it as unreachable and incorrectly conclude it is safe to delete.

**Not a cleanup item.** The field is finished as a moving part the moment the writes stop.
Clearing the stored data is a separate decision that needs the census first - a duplicate
that matches its CRGO section is harmless weight; one that has diverged is a stale card that
would surface as different prices in the rare state above. `scripts/legacy-estimate-master-
census-console.js` (read-only) answers which. When the data is eventually cleared from every
document, the two reads go with it, and not before.

---

### D5. `estimateMasterEditedAt` cannot answer "where did this rate come from"

Added this session so provenance questions could be answered. On its first use it answered
nothing, and that is a property of the field rather than a bug in it. Stated here so the
next person does not reach for it expecting more.

**It cannot describe anything that predates it.** The stamp is written only when a master is
saved (`EstimateMaster.tsx:880`). Every agency not saved since it shipped has no value at
all - six of seven, on the first occasion it was consulted. And no future save can
retroactively date a rate that was already there. Every question of the form "where did this
rate come from" is about a value that predates the stamp, which is exactly the class of
question it cannot reach.

**The sharper half: it is stamped per AGENCY, not per cell.** Even going forward it records
that *the master was saved*, by whom and when - never *which value changed*. An agency master
holds roughly 310 CRGO cells; a save stamps one timestamp across all of them. So for "who set
this rate and when" it is the wrong instrument entirely, not merely a young one. A recent
stamp is not evidence that a given cell is recent; it is evidence that some cell might be.

**What would answer it is per-cell provenance** - a stamp per rate, or an append-only change
log. Nobody has asked for that, it is real weight on every save, and the question it answers
has come up once. Recorded as the known alternative, not as a recommendation.

**What the field IS good for**, and why it stays: the line under the master heading, *"Rates
last edited <date> by <who>. Estimates produced before that date were priced from different
rates."* That is a true and useful statement about the whole master, which is the granularity
the field actually has.

**Worked example, from the occasion that prompted this.** Seven agencies were found holding
49.00 in CRGO `1b` at 100 kVA where Schedule-A `1b` holds 46 at `B100`. Six carried no stamp;
one rendered an impossible date (F58). The value predates everything traceable, so no query
can say whether it was a deliberate rate or a slip - only the person who set up the source
master can. The field's silence was correct behaviour and still left the question open.

---

### D6. Gujarat-only registration, enforced - a scope limit, not a fix

`gstinScopeError` refuses a GSTIN whose first two digits are not `24`, at three points: the
agency creation form, the save in `EditAgencyForm` where the GSTIN is actually entered, and
`missingForTaxInvoice` - so an agency that acquired a non-Gujarat GSTIN by any route still
cannot issue an invoice against it.

**This is not the IGST fix. O9 stays open and unbuilt.** What this does is make an existing,
silent decision honest.

**The scope was already decided and encoded.** `DISCOM_OPTIONS` offers four entities, all
Gujarat, behind a required select; `discomState` and `discomStateCode` are seeded from that.
The app has only ever been built for Gujarat agencies serving Gujarat DISCOMs. The decision
was invisible, and the single place it surfaced was a tax invoice printing `Supplier State
Code 27` against `Buyer State Code 24` while charging CGST+SGST.

**Why a block is better than a partial IGST path.** `cgstPercent` and `sgstPercent` are
agency-configurable, so an out-of-state agency could set 0 and 18 and get the right AMOUNTS
under the wrong LABELS - an invalid invoice that looks solved. A refusal cannot be worked
around into something that appears correct.

**THE MESSAGE IS THE POINT, and it is why this is recorded as a decision rather than a
validation.** "Invalid GSTIN" would be a dead end: it teaches the prospect nothing and
teaches us nothing about whether we want their business. The refusal instead names what is
refused, why it is refused, and asks them to make contact:

    This app currently supports agencies registered in Gujarat - a GSTIN beginning 24 -
    working for Gujarat DISCOMs. Yours begins 27.

    An agency registered outside Gujarat supplying a Gujarat DISCOM is an inter-state supply
    and must be billed IGST, which this app does not yet produce. Issuing a CGST+SGST
    invoice for it would be wrong on the face of the document.

    Please get in touch - we would like to know about this case, and it may change what we
    build next.

**It fails at the one moment the assumption can be corrected cheaply.** Today an out-of-state
agency onboards, works for weeks, and finds out when a division office rejects an invoice -
or never finds out. With the block they hit it at signup, before any paper exists, and the
scope assumption gets tested by the only people who can test it.

**Blocked on the GSTIN PREFIX, not `agencyState`.** That field is free text, seeded empty,
and asserts nothing. The GSTIN's first two digits ARE the registration.

**When IGST is built, this constant goes** - it is `SUPPORTED_GSTIN_STATE_CODE` in
`lib/utils.ts`, one place, deliberately.

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

### F47. HV coil priced at the with-S.E. rate; corrected to without

`SingleJobEstimateReport` resolved Schedule-A **`12A-b1`** — Aluminium **with** S.E.,
Rs 213/kg — for the HV winding, while the LV winding resolved **`13A-b`** — Aluminium
**without** S.E., Rs 149/kg. With S.E. on one side and without on the other, from one
inspection, with no input distinguishing them.

The agency confirmed they do not use super-enamelled conductor, so both windings take the
without-S.E. variant. HV is now `12A-b`, **Rs 163/kg**. LV was already correct and is
unchanged — but its comment now states the same reason, so the two sites carry one
justification instead of one being explained and the other silently agreeing.

**Rs 50/kg overcharged on every HV coil kilogram**, on jobs where the agency master had no
`12A` rate of its own. Measured by `scripts/hv-coil-se-exposure-console.js`, which separates
issued from unissued and — importantly — separates lines whose **weight** was also
fabricated by the old per-capacity constant (F46). Those were wrong twice over, and
correcting the rate does not make an invented quantity right; they need re-inspecting, not
recomputing.

**The reasoning that kept it, and why it was wrong:** the comment recorded that `12A-b1` was
chosen because it matched the rate the app already produced on estimates issued to and
accepted by UGVCL, and said explicitly it was kept "for consistency with those, not because
the rule is confirmed". Honest about its own uncertainty — and still the wrong test.
**Agreement between documents produced by the same code is not corroboration**, and
acceptance by a customer is not verification. See O20.

Copper remains blocked rather than guessed on both windings. The agency fact settles the
S.E. axis; it says nothing about the material axis, and conflating them would have been the
same error in a new place.

### F48. HV bushing selects 8-A or 8-B from the recorded KV rating

`8-A` (11 KV, Rs 176) was hardcoded. `8-B` (22 KV, Rs 265) was unreachable, so a 22 KV
bushing would have been priced Rs **89 less** per bushing — silently, since nothing on the
document says which voltage class was assumed.

**The data was already there.** `kv` is captured on the external inspection, is REQUIRED on
save (`ExternalInspection`), and `externalData.kv` was in scope three lines below the
assumption. The comment defending the hardcode said *"the job data model has no
voltage-class field"* — correct about the job, wrong about the record that was already being
read on the same line for the bushing quantity.

**Normalised before matching.** `'22 KV'`, `'22kv'`, `' 22 '` all resolve; a strict
`=== '22'` would have priced every one of them at 11 KV — the same near-miss shape as
`'DAM'` against `'DMG'` (F46).

**No default either way.** Anything that is not 11 or 22 raises a `missing-input` rateError
naming the field and the value found, and only when the bushing line applies. Falling back
to 11 KV is what hid this; falling back to 22 KV would overcharge. `recordErrorIfApplies` is
skipped when the class did not resolve, so the operator gets one error naming the KV rating
rather than a second saying "no rate found", which would name the wrong cause.

**The fix predates any occurrence.** All 55 external records carry `kv = '11'`, none blank,
none 22. So this corrects nothing already issued — it is right the first time a 22 KV unit
arrives, rather than after.

**Why it selects rather than blocks on 22 KV.** The operator reported that the division does
not currently dispatch 22 KV units, which argued for blocking instead. The tender decides
otherwise: Schedule-A's own heading reads *"item-wise rate for repairing **11/22 KV**, 5 to
500 KVA CRGO"*. 22 KV is contractually in scope and the rate exists, so refusing to price it
would stop work the contract covers. See the pattern note above — that reasoning generalises
well past this line.

### F49. The master-to-Schedule-A pairings are data, in one place

`lib/scheduleItemMap.ts`. Twenty-eight pairings that existed only as scattered literals
inside `buildSingleJobEstimateData` - `resolveRate('X', scheduleRate('Y'))` at each site,
with nothing anywhere letting a reader see them together.

**That invisibility is what let F48 happen.** Item `'8'` priced every HV bushing at the 11 KV
rate, and noticing required reading the function line by line. A table makes the next gap
**countable**: an item with no entry, or one whose variants are never all reachable, is
visible by inspection.

**The 21 unambiguous sites now read from it.** `scheduleRateFor(masterCode)` looks the `sr`
up and **throws** for an unknown code rather than returning undefined - an undefined would
fall through to "no rate found", naming the wrong cause, since the rate is configured and
the *mapping* is missing. Verified mechanically before wiring: all 21 call sites agreed with
the table, none missing on either side.

**Seven variant sites keep selecting at the call site**, and the table records the AXIS -
`winding-material`, `kv-class`, `capacity` - with a note per item. The table carries the
pairing; the code keeps quantity, unit and applicability, which read inspection fields that
have nothing to do with rate lookup. Moving those here would trade one illegible place for
another.

**`NOT_FROM_SCHEDULE_A` records the deliberate absences** - scrap codes `'22'`/`'0'`, priced
by `resolveScrapCharge`, and master `'18'` "Repl. Of Tank", which is not priced at all.
"Absent from the table" and "absent on purpose" look identical otherwise, and the next
reader would log the second as a gap.

**What building it surfaced, which was the point:** the master's numbering is not the
schedule's. Master `20`→schedule `19`, master `21`→schedule `20`, master `4`→schedule `18b`,
while master `17`→schedule `17` is aligned. Every one checks out by DESCRIPTION and none is
visible from the numbers - so each row records both names. This was the first time those 28
pairings could be read side by side, and it is how the unpriced main tank was found.

Step 2 - showing inherited Schedule-A values in the master grid, greyed and overridable -
is deferred, with variant rows deferred further since a row like HV bushing has no single
inherited value to show.

---

### F54. The Excel export's item rows were computed from no inspection data

`handleExportExcel` filled its item column from `calculateJobItemDetails(itemForJob, job)` -
two arguments, where the function takes four. External and internal inspection data were
simply not passed. Every optional item is gated by a test of the shape `x !== 'N' && x !==
'0'`, and `undefined` matches neither exclusion, so **every optional item was charged on
every job**. The quantity-driven items compound it: absent a field they fall back to a fixed
default - HV bushing 3, LV metal parts 4, washer ring 6, HV/LV gaskets 7, HV metal parts 2,
LV bushing 1, dismantling 1.

Against the shipped CRGO default master that floor is Rs 5,069.80 at 25 and 63 KVA, on a job
whose inspection found nothing wrong and whose correct estimate is Rs 2,061 of dismantling.
At 100 and 200 KVA it is Rs 4,364.80 - **lower**, because the default master leaves those
columns blank and the old engine's last resort was "the first non-null rate in any capacity
column", so a 200 KVA job was priced off the 10 KVA cell. Live agency masters differ; the
figures above are analytic, not measured. `scripts/excel-export-delta-console.js` (read-only)
reproduces the sum from real data.

**The totals rows were always right.** `calculateJobTotal` has always run through
`buildSingleJobEstimateData` with real inspection data. So an exported sheet did not
reconcile against itself - the item column summed to more than the GRAND TOTAL printed
beneath it, and nothing in the document said which half to believe.

Fixed by reading both halves from the one builder. Exposure is O24.

### F55. Two estimate engines, and only one was ever fixed

`EstimateGenerate.calculateJobItemDetails` - 366 lines - priced the same jobs as
`buildSingleJobEstimateData` by its own rules, and received none of the fixes made there:

- charged on `x !== 'N'`, so an unset field read as an affirmative (F46)
- carried the fabricated per-capacity coil weights (F47)
- ignored winding material entirely for Schedule-B, so every copper amorphous job took the
  aluminium rate - 100 KVA copper is Rs 18,961 against the Rs 17,970 used, 200 KVA copper Rs
  27,720 against Rs 10,148 (F52)
- tested `lvCoilR !== 'DMG'` against a value the form has never emitted (F44)
- matched items by `itemName.includes(...)` on a user-editable master label, so renaming a
  master row changed pricing
- fell back to the first non-null rate in any capacity column when a cell was blank

Deleted. Both callers - the Excel export and the printed matrix - now read the single
builder through `builderLineFor`.

**Two gaps had to close first, and finding them is the argument for consolidating.** Neither
was visible while the engines were separate:

1. **Overhauling had no branch in the builder.** `CoreClass` has included `'OH'` and
   `classifyCoreType` has returned it since the type was written, and nothing consumed it -
   an OH job fell through to the CRGO section, which emits 29 fixed CRGO lines against a
   5-row overhauling master. The comment above that section even reads "Itemised (CRGO /
   OH)": the intent was recorded, the branch was not. Ported behaviour-for-behaviour, with
   its invented per-kg weights flagged at O25 rather than fixed, so the deletion changed no
   figure.
2. **The amorphous labour line is indistinguishable by item code.** Schedule-B's Repairing
   Charge and Labour Charge are both emitted with `itemCode: entry.sr`. Matching on the code
   alone puts Repairing Charge on the capacity row and leaves the master's row '2' empty,
   dropping labour out of the matrix. Resolved at the CONSUMER, by description - the
   builder's `itemCode` is printed as "As Per AT Sr" on the single-job estimate and is not a
   free variable.

The coil rows needed the same treatment for the opposite reason: the master carries one row
per material, the builder emits one line for the material used. `builderCodeForMasterRow`
lands it on that row and returns null for the other, so the charge appears exactly once.

**Why this is the entry that matters.** A spreadsheet whose item rows summed to more than
its own total was possible only because two engines answered the same question and no screen
ever showed both answers together. Consolidation is not tidying here; it is the thing that
makes the contradiction impossible to restate.

### F56. One button, two blast radii — split, and the override count that makes it safe

`saveGlobalDefaultEstimateMaster` did two things and named one. It wrote `public_config`
(and its `system_config` mirror), and then looped `agencies` calling `updateDoc` on each.
The button said "Publish as Default for All Users".

The two halves are not the same kind of act. Writing `public_config` seeds every future
agency for every user and cannot be undone by the actor on anyone else's behalf. Writing
your own agencies is owner-scoped and repeatable. A single control offering both is how
someone publishes a baseline meaning to update their own agencies.

**The gate was on the wrong half.** `agencies` is loaded as
`where('ownerId','==',auth.currentUser.uid)` (AgencyContext:478), so the fan-out only ever
touched the caller's OWN agencies, even for the admin. Nothing about it was privileged.
`firestore.rules:256` allows an agencies update when `existing().ownerId == request.auth.uid`,
and `isValidAgency` does not inspect the `estimateMaster*` fields at all - so the owner-scoped
half passes the rules exactly as written. No rules change, no privilege change.

Now:

- **"Apply to my agencies"** - every user, `applyEstimateMasterToOwnAgencies`, owner-scoped,
  no `public_config` write.
- **"Publish as shared default"** - admin only, `public_config` only, no fan-out.

**Splitting exposed an effect the bundle had been hiding.** `getEstimateMasterForCore`
checks `agency.estimateMasterCRGO` BEFORE `globalDef.estimateMasterCRGO`, so publishing
never changed the prices of an agency that has its own CRGO section - which is every agency,
since `addAgency` seeds them all. The fan-out was doing the entire visible half of that
button's job, and the label credited the publish for it. The modal text and the success
message both claimed "ALL users and agencies"; both now say what actually happens.

**The override count.** Applying A's master to B replaces B's section arrays wholesale -
`updateDoc` does not deep-merge - so any rate B had customised is gone. `countOverridesForApply`
states the loss before the write:

> This will update AARATI TRANSFORMER and DRISHIV, replacing 6 rates customised in AARATI
> TRANSFORMER and 2 rates customised in DRISHIV.

Three decisions inside it worth keeping:

1. **It re-reads each target document** rather than using the `agencies` state. The state is
   from page load; a confirmation is a safety claim, and a claim that was true at load and
   false at click is worse than no claim. Four `getDoc` calls.
2. **It reads the RAW document, never the enriched context object.** Enrichment fills every
   empty section from `public_config` or the shipped defaults, so an agency storing nothing
   would report hundreds of overrides about to be destroyed - the F27 trap exactly.
3. **An override is a non-null target cell whose value differs from what the source writes.**
   A null cell is inheriting and loses nothing. A non-null target against a null source
   counts, because reverting a fixed rate to inheriting is equally a decision undone.
   Cells going the other way - null target, non-null source - are reported separately and
   quietly: not a loss, but they stop tracking future tender changes, which is the F27
   mechanism applied wholesale rather than per cell.

The payload comes from `publishPlanFor` (stored when untouched, screen state when edited)
behind `blockPublishIfFallbackResolved`, so a section that exists on screen only because a
fallback resolved it cannot be pushed to four agencies at once. That is precisely how one
wrong Wound Core card became four.

### F57. The third implementation of one calculation - and the last

`BillingSystem.calculateJobTotal` and `Reports.calculateJobEstimate` each walked the estimate
master applying quantity rules of their own, reading **no inspection data at all**. The
Reports copy was verbatim. With `buildSingleJobEstimateData` that made three implementations
of one question, and this one produced **the invoice** - the document with a GSTIN on it that
gets paid.

Four divergences, running in both directions at once:

| | these two | the builder |
|---|---|---|
| inspection data | none read | external + internal |
| `unit === 'Y'` | qty 1 **always** | charged on a recorded `'Y'` (F46) |
| coil rows | `unit: 'QTY'` -> **qty 1**, so a 47 kg HV coil billed Rs 163 instead of Rs 7,661 | weight x per-kg rate |
| `unit === 'KG'` | invented 14 / 15.54 / **45.36** (O26) | blocks - no weight is recorded |
| bushings, metal parts | hardcoded by item code | read from the inspection |

They do not cancel. A coil rewind under-billed by thousands; a job needing almost nothing
over-billed. **Every fix this session landed in the builder and none of them here** - F44,
F46, F47, F52, the conservator block. That is the same evidence that retired the estimate
engine in F55, and the same conclusion.

**Both files already carried a comment asserting these paths could not drift apart.**
BillingSystem: *"there is one Schedule-B reader in this codebase and this is not it."*
Reports: *"the same resolution the estimate and the bill use, so these three can't drift
apart."* They had already drifted. **A comment describing an intention reads exactly like a
comment describing a property**, and only one of those survives the next edit. Both files had
converted their scrap and fixed-rate branches on precisely this argument and left the
itemised branch - the path most jobs take - untouched.

Both now call `getJobFullEstimate(...).baseTotal`, matching the Amorphous branch ten lines
above in the same function. `baseTotal` and not `finalAmount`, so the caller's AT uplift stays
the only one. `Reports` reads `inspections` directly rather than building a fourth place that
decides what an inspection is.

**NO ISSUED BILL CHANGES - by construction, not by census.** Two independent reasons, neither
depending on data that had to be gone and checked:

1. `jobsForBillType` filters `isGpJob` **before** any branch is reached
   (`BillingSystem.tsx:238`), so `calculateJobTotal` is never called for a GP job in the
   billing path. A GP job's bill cannot be affected whatever it contains.
2. Stored `billAmount` and `billTotalMrAmount` are written once at send time and never
   recomputed. Changing the function changes what a FUTURE bill computes; it does not rewrite
   a document already sent.

A census was run and returned zero itemised-branch bills on two agencies, but it could not
cover an agency owned by another account. The structural argument is recorded in preference
because it holds without that data.

### F58. A diagnostic reimplemented a date helper that already existed, and got it wrong

`scripts/rate-provenance-console.js` rendered one agency's `estimateMasterEditedAt` as
**11/1/1972** - an impossible date, on a field written with `serverTimestamp()` days earlier.

The script parsed dates with:

    new Date(Number(v) || Date.parse(v))

which handles numbers and ISO strings and **not a Firestore Timestamp**, the one shape that
field actually has. This is the F23 class - a Timestamp meeting a reader that expects a
number - but with an aggravating detail: **`formatDDMMYYYY` already handled Timestamps**
(`lib/utils.ts:14-21`, both `.toDate()` and the plain `{seconds}` shape), and that branch was
written EARLIER IN THIS SAME AUDIT for exactly this hazard. The fix existed, in this
codebase, and was reimplemented badly instead of reused.

**Why it was reimplemented is the part worth fixing.** A console script cannot import from
`src`. There was no way to reach the helper, so every diagnostic that printed a date wrote
its own parser. `src/lib/firebase.ts` already says the fix for a missing handle "belongs
here, not in the script" - so `formatDDMMYYYY` is now on the dev handles as
`window.__utils`, and the script refuses to run rather than falling back to a local parser
if it is absent. Refusing is deliberate: a diagnostic that silently degrades to the broken
path is worse than one that stops.

**Three other scripts carried the same expression** - `agency-activity-console.js`,
`all-agencies-census-console.js`, `mr-external-stage-console.js` - all reading `createdAt`,
which since F38 is written with `serverTimestamp()`. All three are fixed.

None of them was load-bearing, and that is worth separating from why it mattered: **a
diagnostic that mis-renders a date is more dangerous than one that fails.** A failure is
visibly a failure and gets investigated. A wrong date arrives formatted, plausible, and
labelled as evidence - it gets acted on. That is what nearly happened here: an impossible
1972 timestamp was one step away from being read as "this rate was set long ago, so it is
probably deliberate", which would have been a conclusion drawn from a rendering bug.

Two shared helpers now exist on the dev handles instead of being rewritten per script:
`__utils.formatDDMMYYYY` for display and `__utils.toMillis` for comparison and sorting -
`formatDDMMYYYY` returns a string, and the callers that need a NUMBER were the ones writing
their own parser. Each script refuses to run if the handle is absent rather than falling
back to a local one.

**The pattern note this belongs under is the third one - surveying by proxy instead of
reading the thing - applied to the DIAGNOSTIC rather than to the app.** A tool written to
check the app's correctness is not exempt from the app's failure modes, and a wrong number
from a diagnostic is more dangerous than one from a screen: it arrives labelled as evidence.
The raw shape is now printed beside the formatted value (`editedAtRaw`) so a wrong-looking
date can be diagnosed from the output instead of inferred.

**Not explained, deliberately.** The specific value 11/1/1972 (~63,916,200,000 ms) does not
correspond to any obvious misreading of a 2026 timestamp - a Timestamp object through that
expression yields `Invalid Date`, not a date in 1972. So SUCHIT holds some third shape in
that field, and what it is has not been established. Naming a mechanism without seeing the
value would be inventing one.

### F59. Diagnostics written under elevated permission, and a mistyping check that compared exact strings

Two defects in the census scripts, found when they were first run as a NON-admin.

**1. The queries omitted the filter the rules require.** Four scripts written this week
queried `where('agencyId','==',ag.id)` on `jobs` and `inspections`. `firestore.rules:240`
allows a list only when `resource.data.ownerId == request.auth.uid || isSuperAdmin()`, and
Firestore requires the QUERY to carry the filter the rule depends on - an agencyId filter
does not establish ownership, so the read is refused.

**They worked on the admin account for the worst possible reason.** `isSuperAdmin()`
short-circuits the rule, so the missing filter was invisible to the person who wrote them.
Every earlier script in `/scripts` gets this right - `allotment-coverage`, `blast-radius`,
`scrap-identity`, `backfill-condition` all pass `where('ownerId','==',uid)` alongside the
agency filter. The regression is entirely in the ones authored this week.

**A diagnostic written under elevated permission encodes that permission silently**, and
then fails for everyone else - or worse, half-succeeds and reports a partial census as a
complete one. The fix is one query per collection filtered by `ownerId`, grouped by agency
in memory: fewer reads, no composite-index question, and it cannot silently widen.

**2. The mistyping check compared strings that had been mistyped.** The AT-number variant
detector normalised with `toLowerCase().replace(/[^a-z0-9]/g,'')` and grouped. That cannot
see that `"AT2026-27"` and `"2026_27"` are one tender: the `AT` prefix survives and the year
widths differ, so they land in different groups. It reported "no tender is spelled two ways"
across six records spelling one tender at least three ways.

Comparing near-strings for a mistyping problem needs a comparison that tolerates the
mistyping. It now extracts digit GROUPS, reduces each to its last two digits and joins -
`AT2026-27` / `2026_27` / `2026-27` / `AT 26-27` all become `26-27`, `24-25` stays `24-25`.

**The same heuristic is right here and wrong as a join key**, which is the point worth
keeping. As a key it is dangerous: any rule strong enough to merge the real duplicates can
merge two tenders that genuinely differ, and a wrong merge prices jobs from another tender's
rates, silently. As a DETECTOR it is correct: a false positive costs a glance, a false
negative leaves a fragmented tender undetected. Over-group, and let a human split.

**What it established.** Six AT records across two accounts carry five spellings, of which at
least three are the 2026-27 tender. Free text as a join key has ALREADY fragmented - the
current state, not a risk to design against. That settled the AT-keyed master design in
favour of admin-issued tender keys (see O33).

### F60. Job numbers are reserved, not computed

`getNextJobNoInfo` composed a number from a CLIENT-SIDE SNAPSHOT of the counter, and the
save transaction only RECONCILED the counter to whatever the form had already decided. Two
operators on the same agency read the same snapshot, composed the same number, and one of
them lost their intake to the save-time duplicate guard (F33).

**The constraint that shaped the fix: the number goes on the transformer.** Operators chalk
it onto the tank at intake, so the number the form shows is a commitment, not a preview.
That ruled out the obvious repair - allocating inside the save transaction - because a
number that changes on save leaves the tank marked `PLN1-41` and the record saying
`PLN1-42`, and the marking is the one half this app cannot correct.

So the number is RESERVED when the row acquires it, by advancing the counter inside a
transaction. Firestore retries the loser, which reads the advanced value: two operators get
41 and 42, neither is refused, neither loses an intake.

**IT REPAIRS A MISSING BARE COUNTER KEY AS IT GOES - a property, not an accident.**

CRGO is counted under either `${div}_CRGO` or a bare `${div}` key, and `reserveJobNos` reads
the **MAX of the two** and writes **both**. An AT created before `addAtMaster`'s seeding fix
can be missing the bare key entirely; the first reservation creates it in step with the
`_CRGO` value rather than starting it at 1. Observed on `AT 2026_27 [SUCHIT]`, whose bare
`DEESA` key did not exist: a reservation took `DEESA_CRGO` from 10 to 11 and created `DEESA`
at 11.

**Simplifying that to a single-key read would reintroduce reissue-from-1** on any AT with a
missing bare key - the sequence would restart while jobs numbered 1..10 already existed, and
every one of them would collide until F33's guard caught it. The max-of-both read is what
makes writing both safe, and the two must not be separated.

**A reservation is permanent.** No expiry, no reclaim, no reservation collection. The app
cannot know whether the operator has already marked the tank, and handing a marked number to
someone else is the exact failure this prevents - an expiry sweeper would BE the defect. An
abandoned number is burned, and the gap is correct: the counter is already never rewound
when a job is deleted, and the job number is the agency's internal reference rather than a
series UGVCL tracks.

**What it removed.** Every call site carried the same block - read the counter, then scan
the form's own rows for a higher number, take max+1. That scan existed BECAUSE the counter
did not advance per row. Once it does, the counter IS the high-water mark and all of it
goes, taking with it the parse-the-number-back-out-of-a-string round trip that A6 depended
on. `nextNum` no longer appears in `NewJob` at all.

**One test for which counter is authoritative.** `getNextJobNoInfo` branched on
`activeAtMaster && activeAtMaster.lastJobNumbers` while `incrementJobNoCounter` branched on
`activeAtMaster` alone - a read and a write disagreeing about one field, held together only
by an AT never being left with an empty counter map. `jobNoCounterTarget()` is now the
single test used by both, which closes **A6** rather than preserving it. The AT's counter is
authoritative whenever an AT is active; the agency's is legacy for the no-AT case and is
deliberately NOT kept in step - nothing advances it or reads it while an AT exists.

**The auto-numbering effect was DELETED rather than converted.** It depended on
`transformers` and so re-ran on its own output - harmless while numbering was pure
computation, a burn loop once it writes, with React's development double-invocation burning
one more per mount. Numbering now hangs off the three user actions that create the need for
a number. Handlers run once per action, so there is nothing to guard: the class is removed
rather than defended against.

**What still reconciles, and why it earns its place.** The save transaction still advances
the counter to the highest number it sees, because the job-number field is EDITABLE - a
hand-typed `PLN1-99` must push the counter forward or the next reservation reissues it. It
only ever advances, so it cannot rewind below a reserved-then-burned number.

**F33 stays load-bearing, not a net.** Atomic allocation closes the concurrency path and
nothing else. A new AT still starts its counter fresh and reissues numbers that exist under
the previous AT (O2 path 3) - counters are per AT, prefixes per division - and hand-typed
numbers, GP reuse against a different transformer, and legacy duplicates all remain its job.

### F61. Changing a division or core type silently rewrote a job number that may be on metal

**A standalone defect, live before any of the reservation work, and it would have survived
every design considered.** It was found only because the marking constraint made it visible.

`handleCommonChange` did this on a division change, and the core-type handler did the
equivalent:

    if (t.jobNo && t.jobNo.startsWith(oldInfo.prefix + '-')) {
      return { ...t, jobNo: t.jobNo.replace(oldInfo.prefix + '-', newInfo.prefix + '-') };
    }

**Two faults in three lines, and neither needs concurrency.**

**One - it rewrites a number that may already be written on the transformer.** The operator
chalks the number on at intake. Change the division afterwards and the tank says `PLN1-41`
while the record says `MHS1-41`, with nothing anywhere to reconcile them.

**Two - it keeps the numeric tail from a sequence the new division does not own.** `PLN1-41`
becomes `MHS1-41` regardless of where MHS1's counter stands. If MHS1 is at 7, the number is
from the future and the next seven intakes collide with it. If MHS1 is at 200, it is a
duplicate on the spot. The prefix changed; the number did not, and nothing checked whether
the new sequence had any claim to it.

**Now: offer, never apply.** A row with no number reserves freely - nothing has been marked.
A row that holds one gets a dialog naming the physical act rather than the data operation:

    Transformer #2
    PLN1-41  ->  AMR1-7
    PLN1-41 came from SABARMATI / CRGO

    If you have already written the old number on the transformer, it must be re-marked
    before you continue.

    [ Cancel - keep PLN1-41 ]   [ Re-mark this transformer as AMR1-7 ]

The replacement is RESERVED before it is shown, so the number on screen is the number
assigned - a prompt offering an unreserved number can offer one that is taken by the time it
is clicked, which is the defect the whole design exists to close. Declining burns it, which
is consistent with F60's no-reclaim rule and costs nothing.

The provenance line exists because the operator may not remember which division they chose
two rows ago, and the number may be on metal.

### F62. A refused save now offers replacements instead of only complaining

F33's duplicate guard was correct and unhelpful. It refused the save, named the conflicting
record, and left the operator to work out the next free number and type it in - **once per
clash**, because it returned on the first one. An intake with four clashing rows produced
the same dialog four times.

It now collects EVERY clash, reserves a replacement for each, and offers them together:

    Transformer #2
    PLN1-41 is already used by:
      MR 12 - Serial 88231, 100 KVA, Make Vijay
    Next free   PLN1-45

    Re-mark each transformer with its new number before saving.

    [ Cancel - leave the numbers as they are ]  [ Re-mark all 4 transformers ]

**Reserved before shown**, as with F61's renumber prompt - an offer of an unreserved number
can be taken by the time it is clicked, which is the defect the reservation design exists to
close.

**Cancel changes nothing.** The numbers stay, nothing is written, and the operator can edit
by hand if they prefer. It is an offer, not a gate.

**Accepting writes the numbers into the form and stops there - it does not save.** The
operator has just been told to walk to four transformers with chalk; a save firing under
them would commit the record before the metal matches it. They press Save when the marking
is done, which is the same discipline F61 enforces on the other side.

**GP rows are never offered a replacement.** A GP repair reuses the original number from its
previous repair, and issuing a fresh one would break the link the guarantee depends on. A GP
clash means the number belongs to a different transformer - a judgement only the operator
can make - so it still refuses with the full comparison and no offer.

**The same-number-twice-in-one-intake case also keeps refusing without an offer.** The
operator typed one number onto two rows; which transformer keeps it is theirs to decide.

**What this does NOT change: what the guard catches.** F33 still queries every job in the
agency and still distinguishes a GP repair of the same physical unit from a genuine clash.
Atomic reservation (F60) closed the concurrency path; this closed the cost of the paths it
did not.

### F63. Rows had no stable identity - the React key was the array index

Found while building the reservation markers, and live independently of them.

Transformer rows in `NewJob` are plain array entries. `duplicateTransformer` splices at
`index + 1` and `removeTransformer` splices out, so **every index shifts**. The React list
key was `key={index}`, which means after any insert or delete React reuses the DOM node for a
different row - carrying input focus, cursor position and uncommitted keystrokes to a
neighbouring transformer.

That is a data-entry defect with no error, no warning and no trace: an operator duplicating
row 2 while typing into row 3 can find their keystrokes land somewhere else. It would be very
hard to report and very hard to reproduce.

It also made the reservation work unbuildable as designed. "Has this row already drawn a
number" cannot be answered by index when the index moves - the marker would follow the
position rather than the transformer.

Each row now carries a `rowKey`, generated at creation and never persisted, used as the React
key and as the reservation marker. `clearTransformerRow` deliberately PRESERVES the key: it
empties a row rather than replacing it, and a row that has already drawn a number keeps it,
because reservations are never released (F60). Drafts restored from `sessionStorage` are
backfilled, since one saved by an earlier build has no key.

### F65. `getNextJobNoInfo` renamed to `predictNextJobNo`, and a second allocator found

A function whose name says "next job number" sitting beside the real allocator is how someone
wires up the wrong one. Renamed to what it does: it PREDICTS from the context snapshot, and
its only legitimate caller is the renumber prompt, which shows what a replacement WOULD be
before the operator accepts.

**The rename found a live break and a second defect.** `MrLedger.tsx:101` still destructured
the old name and `:230` still called it - invisible to the checker, for the reason recorded in
the pattern note above. Repairing it exposed the larger finding: `MrLedger` composes job
numbers itself, with the same client-side high-water scan O2 was about:

    const info = getNextJobNoInfo(editingMr.division, coreType, editingMr.repairType);
    let highestNum = info.nextNum - 1;
    editingMr.jobs.forEach(j => { ...parse the tail, keep the max... });
    nextJobNo = `${info.prefix}-${highestNum + 1}`;

**So O2 was not closed by F60.** The original trace covered `NewJob` and never asked which
other screens issue a job number. Adding a transformer to an existing MR goes through this
path, and two operators doing it concurrently collide exactly as before.

### F66. MrLedger issued job numbers without advancing the counter, and stamped the session's AT

Found by a sweep for the SHAPE of allocation rather than its name - string concatenation of
a prefix and a number, a parse of a numeric tail off an existing `jobNo`, and any read of
`lastJobNumbers`. That found exactly two allocators: `NewJob`, converted in F60, and this
one, which the original O2 trace never reached.

**Two faults, and the second is worse than the defect F60 fixed.**

**One - the same client-side high-water scan.** Read the counter, scan the MR's own jobs for
a higher number, add one. Two operators adding transformers to the same MR draw the same
number.

**Two - `lastJobNumbers` appears nowhere in the file.** A number issued here left the counter
where it was, so the next `NewJob` intake reissued it. `NewJob`'s old code at least
reconciled the counter upward at save; this never told it anything. Only F33's guard stood
between that and a duplicate.

Those two interact: the scan over the MR's own jobs was **load-bearing precisely because the
counter was stale by construction**. Removing the scan without fixing the counter would have
made the screen reissue immediately.

**THE AT IS NOW THE MR'S OWN, NOT THE SESSION'S** - for the number and for the `atId` stamp.
A transformer added to MR 1563 belongs to the tender MR 1563 was issued under: it consumes
that AT's allotment and prices at that AT's percentage, whichever AT happens to be selected
months later. `atId: activeAtMaster.id` was the same defect as the estimate reading the
active AT instead of the job's own - the session's selection standing in for the job's
tender.

Prefixes follow the same AT as the sequence. Drawing the number from one tender and the
prefix from another would produce a job number that is half from each.

**It refuses rather than guesses when the MR cannot answer.** Three cases, each named:

- **no job carries an `atId`** - there is nothing to draw from, and taking today's AT would
  attach the job to a tender the MR may not belong to
- **partly stamped** - one AT is known but some jobs lack it; adding a transformer while the
  MR disagrees with itself spreads the inconsistency
- **jobs under different ATs** - an MR belongs to one tender, and until that is resolved
  there is no single sequence and no single percentage

`scripts/mr-at-consistency-console.js` (read-only) counts how many MRs fall into each case,
so the cost of refusing is known rather than assumed.

**GP draws nothing**, as everywhere else - it reuses the original number from the previous
repair.

**O2 IS ONLY NOW CLOSED**, and was declared closed once before it was. The lesson is in how
this was found: searching for `getNextJobNoInfo` finds callers of a function; searching for
`${prefix}-${n}`, a tail parse and a counter read finds ALLOCATION. A defect defined by its
shape has to be swept for by shape, or the sweep only finds the instances that share a name.

### F67. A job number is drawn on first meaningful entry, not on form open

F60 made numbers reserved rather than computed, and left one question open: WHEN. Reserving
when the form opened would have burned a number on every visit to the New Job screen -
including opening it to look and navigating away - because the operator has entered nothing
at that point and cannot have marked anything.

That mattered because the no-reclaim rule rests on exactly this: a reservation is permanent
BECAUSE the app cannot know whether the number is already on metal. Drawing one before the
operator could plausibly have written it makes the rule indefensible - burning numbers for
screens nobody used.

**A number is now drawn on the first meaningful entry in a row**: `serialNo`, `make` or
`capacityKva`. The first two come off the nameplate and start empty, so entry in either is
unambiguous evidence the transformer is in front of the operator. `capacityKva` is pre-filled
with a default, so there is no "first entry" - only a change, which is still a deliberate act
on a real unit, and excluding it would leave the commonest case (a 63 kVA unit, the default)
relying on serial or make alone. `coreType` is excluded: pre-filled too, and it already runs
the reserve-or-prompt path, so counting it would double-fire.

**The trigger is on the change HANDLER, not the value.** `applyPastJobToRow` fills serial,
make and capacity from a past job through `setTransformers` directly - a programmatic write
that must not draw a number, because a GP row reuses the original. Watching the value would
have reserved on it; watching the handler cannot.

**Until then the field shows a placeholder, never a provisional number** - *"assigned when
you start entering this transformer"*. Anything in that box that looks like a number is a
commitment, because that is what gets chalked on the tank.

**It also removed the need for the initialisation effect entirely.** The first row used to
have no number because numbering hung off three user actions and the row exists before any
of them - and the division arrives pre-selected, by `setCommonData` rather than a change
event, so nothing fired. The answer was not to restore an effect that writes; it was to
reserve when the operator starts entering the transformer, which the first row reaches by
the same path as every other.

**Failure is inline, not modal.** The reservation fires on a keystroke, so the operator is
typing in the field beside it; a dialog over that field is the wrong interruption. The row
shows *"No job number could be reserved - Get number"* and keeps working. The modal stays
for Add, Duplicate and Auto Job Nos, where there is nothing else on screen to look at.

**`reservingKeys` and `reserveFailedKeys` are keyed on `rowKey`, never on index** (F63) - a
splice moves every index, and the in-flight marker is what stops fast typing from firing a
second reservation before the first returns.

### F68. The renumber prompt predicts; the refusal prompt reserves

Two prompts offer a replacement number, and they now behave differently on purpose.

**The renumber prompt - shown when a division or core type changes - PREDICTS.** It used to
reserve before showing, so the number on screen was guaranteed to be the number assigned.
That guarantee cost a burned number every time an operator flipped a dropdown to look at
something. Weighed against each other: eager reservation burns a number certainly and
frequently; a prediction opens a window of milliseconds in which another operator can take
the offered number, which is rare and - since F62 - already handled, because a collision
produces a refused save carrying an offer rather than a duplicate.

So it predicts, and **reserves on accept, with ONE RETRY**. If what comes back differs from
what was shown, the prompt re-renders with the numbers actually reserved and says so:

    PLN1-45 was taken while you were deciding. The number now reserved is PLN1-46 -
    check it and confirm again.

Never a silent renumber. The operator confirms against the number they will write on the
tank, never against one that has moved underneath them.

**The refusal prompt still reserves before showing**, and the asymmetry is deliberate. It
appears only after a save has already been refused - the operator is not exploring, they are
correcting, and a second refusal in the same breath would be a loop rather than an offer.

### F69. The reservation guard was built for one path and two older paths reached past it

Reported from the UI: changing a row's core type repeatedly burned a number each time,
without saving. The design (F68) is that the prompt shows an UNRESERVED prediction and
reserves only on accept, precisely so flipping a dropdown to look at something costs
nothing.

**The prediction was correct. The burn came from the other branch of the same handler.**

A core-type change on a row that HOLDS a number predicts, as designed. On a row that does
not, it draws one - which is right, since nothing has been marked. But it called
`reserveJobNos` **directly**:

    if (!existing) {
      reserveJobNos(commonData.division, value, 1).then(([jobNo]) => …)

`reserveForRow` owns `reservingKeys`, the in-flight marker that stops a second reservation
firing before the first returns. This branch never touched it. And because the assignment is
asynchronous, the row stays unnumbered for the duration - so every change in that window saw
`existing === ''` and drew again. Three quick flips, three numbers.

`numberUnnumberedRows` had the same gap and a wider blast radius: no guard either, called on
every division AND repair-type change, operating on ALL unnumbered rows. A four-row intake
burned four numbers per flip.

**THE GUARD ITSELF WAS ALSO UNSOUND.** `reservingKeys.has(...)` reads React state, which is
not committed synchronously - two keystrokes in the same tick both see an empty set and both
pass. The marker is now a `useRef`, which updates immediately; the state remains only to
render the spinner. So even the path that HAD a guard was relying on one that could not hold
under the exact conditions it existed for.

Everything now goes through `reserveForRows`, which takes a batch so a division change keeps
its per-sequence batching, drops rows already in flight before reserving anything, and
assigns by `rowKey` so a splice between firing and landing cannot put a number on the wrong
transformer (F63). `reserveForRow` is a one-row wrapper.

`addTransformer` and `duplicateTransformer` still call the allocator directly, deliberately:
they create a row that does not exist yet, and two clicks SHOULD produce two rows with two
numbers. That is not a burn.

**THIS IS THE F65 SHAPE, COMMITTED BY THE FIX FOR A DIFFERENT INSTANCE OF IT.** F65 recorded
a second call site reaching past a rule - `MrLedger` allocating job numbers while the O2
work assumed `NewJob` was the only allocator. Here the same thing happened inside a single
file, in the same week, by the same hand: the guard was written for the keystroke path,
which was new, and not applied to the two paths that already existed. Building a rule and
retrofitting its call sites are two jobs, and finishing the first feels like finishing both.

The countermeasure is not vigilance. It is that a rule with more than one entry point should
have exactly one - `reserveForRows` is now the only function that calls `reserveJobNos` from
a row-editing path, so a future caller cannot bypass the guard without deleting it.

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
