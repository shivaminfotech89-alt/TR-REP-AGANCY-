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

## Terminology hazard: "AT" and "ADB" are both "the tender number" to a user

**The third instance of this shape, and the first caught before it reached the code.**

Two unrelated identifiers, both of which an operator will reasonably call *"the AT number"*:

| what | what it actually is | where it lives |
|---|---|---|
| **AT** | **Annual Tender** — the rate contract a job is priced under. Carries the schedule, the above/below percentage and the estimate masters. | `atMasters`, `job.atId`, `AtSettings` |
| **ADB/1804** | a **supply order** — the consignment a particular transformer arrived under. Identifies units with heavier coils, so Schedule-B prices them at 1d-2 (Rs 16,746) rather than 1d-1 (Rs 13,746). | `job.supplyOrderRef` |

**How it surfaced.** The 63 KVA Aluminium fork was being changed from a substring match on
`job.make` to an explicit field, and the field was requested as *"a field on the job for the
AT number this unit falls under"* — meaning ADB/1804. Taken literally that would have put a
field called "AT number" beside `atId`, holding a different kind of number, **in the field
that chooses between two rates**.

The request was not loose. To the person doing the work both *are* tender paperwork: the
annual tender sets the rates, the supply order says which consignment the transformer came
from, and both arrive as numbers on documents from the same DISCOM. **The ambiguity is real
in the domain, not a slip in the asking** — which is exactly why the code has to be specific
where the language is not.

Named `supplyOrderRef`, labelled **"Supply Order (ADB)"**. The schedule row carries
`supplyOrder: 'ADB/1804'` as the thing matched on, with `makeNote` kept for display and
marked never-match.

**The working rule, and it is the same one the two entries below arrive at from different
directions: when a user names a field, check what the name already means in the code before
using it.** "18" collided because a row was numbered by its position; "Type" collided because
five screens each shortened a different phrase; this one would have collided because two
documents in the same envelope both have numbers on them. None of the three is detectable
from the value — only from what else already claims the word.

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

## Pattern: a footer positioned by leftover space rather than by a stated gap

**Second instance, so it is a pattern rather than a bug.** `flex flex-col justify-between`
on a container with `h-full` stretches to the full page body and pushes the last child to
the floor. The gap above it is then WHATEVER IS LEFT OVER — large on a short document, small
on a long one, never twice the same, and never a number anyone chose.

  1. The tax invoice, fixed earlier.
  2. `EstimateGenerate.tsx:1000`, the forwarding-letter sheet: the signature block for the
     authority and the agency's representative sat at the bottom of the A4 page instead of
     under the content it signs.

**It costs nothing to fix, which is the part worth remembering.** The space is already inside
the page; `justify-between` only decides where to dump it. Removing the stretch and stating
the gap (`mt-3`) redistributes rather than adds, so a page fitted to A4 with a known margin
does not lose any of it. That is not obvious from looking at the defect — a bottom-anchored
footer reads as though something is holding the page open — and it is the reason to fix it
rather than live with it.

**How to recognise it:** a print container with `h-full` and `justify-between` and exactly
two children. The tell on paper is that the gap changes between documents of the same kind.

**What to do instead:** let the children stack, and state every gap. A gap nobody chose is a
gap nobody can review.

---

## Pattern: a tool that verifies by checking out history is destructive, and its output hides it

**`scripts/admin/print-subtree-hashes.js` reports hashes.** It reads as a read-only
comparison, and every line it prints supports that reading. The comparison it takes part in
is not read-only at all: getting a "before" means `git checkout <earlier> -- src/`, and
getting back means `git checkout HEAD -- src/` — **which restores to HEAD, not to what was in
the working tree.**

⚠ **SO UNCOMMITTED WORK IN `src/` IS DESTROYED, SILENTLY, AND `git status` COMES BACK CLEAN
AFTERWARDS.** Nothing announces the loss. The next `git commit` reports "nothing to commit,
working tree clean", which reads as "already committed" rather than "there is nothing left".

**It happened.** A finished rewrite of the agency-mark picker — two native selects, live
preview, collision text in the options — was wiped by exactly this sequence, moments after
being built and type-checked. It was rebuilt from the scratchpad script that had produced it.
**The guard exists because the failure occurred, not because anyone anticipated it.**

**THE GUARD REFUSES; IT DOES NOT STASH.** Stash-and-restore has its own failure modes — a
conflicted restore, an interrupted run, a stash left behind that nobody notices — and a
refusal has none. The message says what to do rather than only what is wrong:

    REFUSING TO RUN — src/ has uncommitted changes.
    This harness checks out an earlier src/ and would destroy uncommitted work.
    Commit or stash first.

with the dirty paths listed beneath it. `--no-guard` exists for a caller that has already
made the tree clean and is driving the checkouts deliberately.

### Second and third instance, same tool: an ADDED document, and line endings

**The checkout workflow could not report an addition.** `git checkout <old> -- src/` restores
files the old commit had; it cannot REMOVE one it did not have. So a change that ADDS a
printed document left the new file sitting in the working tree during the "before" pass,
which counted it in the old set and reported a spurious **CHANGED** against a document that
had never existed. The multi-job estimate's first verification printed "13 before, 13 after,
1 CHANGED" - a confident wrong answer, the same class as the destructive restore.

**And hashing raw file content compared line endings, not documents.** The working tree is
CRLF on Windows; `git show` returns what git stored, which is LF. Comparing HEAD against HEAD
on a CLEAN tree reported **13 changed**. Caught only because that control case was run at all.

**Both are fixed by not checking anything out.** `--compare <ref>` reads the old revision with
`git show ref:path`, which never writes to the working tree, and classifies by DOCUMENT
IDENTITY - file plus subtree index - so:

  - nothing is restored, so nothing can be lost;
  - a file the ref does not list simply is not in the old set, so an addition is **NEW** by
    construction rather than by anyone remembering to move it aside;
  - CRLF is folded to LF before hashing, on both sides, so the comparison is about content.

Verified on the control case it previously failed: **HEAD against HEAD, clean tree, 13
byte-identical and 0 changed.**

⚠ **THE PUBLISHED HASHES CHANGED.** Normalising line endings alters every value, so a subtree
quoted as `1e742ace…` in an earlier entry will not reproduce. The comparison is what those
figures were ever for; the absolute values were never identity with anything external.

**Three failure modes in one tool, all of the same shape:** the mechanism disagreed with the
purpose, and the output looked like a result either way. Two of the three were found by a
control run rather than by reading the code - which is the argument for always comparing a
commit against ITSELF before trusting a comparison against another one.

---

**The general shape, which is why this is a pattern and not an incident.** The discipline
belongs in the tool, not in remembering — the same reason every admin script in this
directory ships with `MODE = 'dry-run'` rather than trusting whoever runs it to check first.
A tool is dangerous when its *mechanism* is destructive even though its *purpose* is not, and
that gap is invisible from the name, the output and usually the call site. Before shipping
anything that reads history to compare against it, ask what it does to work that is not
committed yet.

**Related.** The "no difference" harness pattern below is the twin: there the risk was a
comparator that could not see, here it is a comparator that destroys what it is comparing.
Both produce a confident, clean-looking result with nothing behind it.

---

## Pattern: a harness that reports "no difference" must contain a case that MUST differ

**The rule, first: a comparator whose whole job is to report an absence cannot detect its
own blindness.** If it reads the wrong field, calls the wrong function, or is fed the wrong
shape, it finds nothing — which is exactly what a pass looks like. So any harness whose
success condition is "nothing changed" must also assert, in the same run, at least one thing
that changes. That case is not a bonus test of a second behaviour; it is the only evidence
that the comparator can see anything at all.

**⚠ THE DEFAULT SHAPE: A COMPARISON ASSERTS THAT IT COMPUTED SOMETHING BEFORE IT REPORTS THAT NOTHING
MOVED.** A script whose success condition is "nothing changed" counts what it actually compared -
estimates built, subtrees hashed, test files run, hooks found. It exits non-zero when that count is
zero, or below what is known to exist, **in the same step and before the "0 moved" line prints.**
Every such script in this project is written that way from the start; the assertion is not a repair
fitted after each one is caught.

A positive control elsewhere in the run is not a substitute. It is a separate code path: it can skip
itself, and when it does catch the blindness it may do so only by crashing, which is how the fourth
instance below was caught.

**Four instances, each found late:**

| | Reported | Why it had compared nothing | Caught by |
|---|---|---|---|
| **G33** | `verify-seed-equality.js` negative control: PASS | the perturbation's regex matched nothing, so an unmodified file was compared | the traceback printed above the PASS |
| **G59** | `hooks-after-return.js`: "None" | its patterns recognised neither the early returns nor the hooks it exists to find | three hooks below a return, found by hand (G57) |
| **G60** | `node --test`: exit 0 | no file matched, and a file with no tests counts as one passing test | trying both on purpose |
| **G61** | S.E. regression: 77 jobs, 0 moved | the stub rule took the builder's absolute `C:/` path for a bare import, so both builders were stubs | the positive control crashing on the same missing estimate |

The `est.items` case below has the same shape and predates the lettered entries.

**Where the existing comparators stand (2026-09-11)** - recorded, not retrofitted:

| Script | Asserts it computed something? |
|---|---|
| `verify-seed-equality.js` | **Yes** - the perturbation is asserted to have landed (G33) |
| `hooks-after-return.js` | **Yes** - its self-test requires planted probes to be found (G59) |
| `scripts/run-tests.js` | **Yes** - fails on no test files, no tests, or a file reported as its own test (G60) |
| `pricing-model-regression.js` | **Not in Part A.** A job that throws gives the same error fingerprint on both captures and compares equal, and an empty baseline reports 0 moved. Part B fails the run when the builder throws or no Amorphous job exists, so a blind builder is still caught - one step later, by a different path. |
| `print-subtree-hashes.js --compare` | **No.** Zero subtrees on both sides reports "byte-identical 0" and exits 0. It also exits 0 when documents are REMOVED; only a CHANGED one fails it. |
| `master-equivalence.js`, `seed-parser-equivalence.js`, `at-resolution-census.js` | **No.** Each prints its "identical / none" verdict having compared zero items. Each prints its counts beside the verdict, so a zero is visible, but nothing stops on it. |
| `read-counters.js --diff` | **No.** "NOTHING MOVED" prints when both snapshots hold no counters, and the diff prints no count. |

**It is up to whoever next touches one of the "No" rows to fit the assertion then.** A script written
from now on starts with it.

**It earned itself twice in one file, both times in
`scripts/admin/pricing-model-regression.js`, and both times it was the differing case that
caught the bug rather than any review of the method.**

**First: the wrong field name.** Part A fingerprinted each job on `est.items`. The builder
returns `physicalItems`, `internalItems` and `labourItems` — there is no `items`. Every job
fingerprinted to an empty line list and an identical code string, so all 64 compared equal
and Part A reported a clean pass. What exposed it was Part B, which prices one Amorphous job
under 2020 and again under 2026 and asserts the two DIFFER. Two estimates that are 2 lines
and 28 lines respectively came back "identical", and the assertion failed. Nothing about
Part A looked wrong at any point.

**Second: the wrong shape.** Inspections store their fields under `data`, and the builder
reads `externalData.damRadNo`, `internalData.damR` and so on directly. The harness passed
the inspection DOCUMENT, so every damage field was undefined: no radiator, no coils, no
dry-out. Every job priced down to its unconditional lines. SU-5 came out at Rs 3,238.61
instead of Rs 9,077.15.

⚠ **AND THIS ONE SHIPPED.** The commit-4 harness carried it, and its reported "64 jobs,
0 moved" is not the check it appeared to be. It was *technically valid* — the same
impoverishment applied to both sides, so like was compared with like — but the estimates
being compared could not see most of what the change under test touched. A result that is
true for a reason unrelated to the thing it is asserting is worth less than it reads, and
the earlier entry should not be left standing as though it had been the full check. It was
re-captured and re-run against real data afterwards, and 0-moved held. **The re-run is the
evidence; the original result was not.**

Again it was a differing case that found it — the Clause 4.0 impact measurement reported
zero jobs over the circle limit when SU-5 was known to be over. A number contradicting
something already known is the cheapest detector available, and it only exists if the
harness is asked to produce one.

**Practical form.** Every "nothing moved" harness in this repo should carry:

- at least one **positive control** — a case constructed so the answer MUST be non-zero,
  failing loudly if it is not;
- **one known value checked against reality outside the harness** — SU-5 being over limit,
  a total someone has read off a real document — because a self-consistent harness can be
  uniformly wrong;
- fingerprints that include a **shape** as well as a total. The item-code string was what
  would have exposed the first bug immediately, had it been populated.

**Related.** This is the measurement-side twin of *"never assert what you cannot derive"*:
there the code stated something it had not established, here the harness established
nothing and reported it as a fact. Both produce confident output with no evidence behind it,
and neither is visible from reading the confident part.

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

#### The fourth instance, and the cost of closing it — measured 2026-09-07, NOT applied

A green `tsc` has now been worth less than it looked **four times**, each for a different
reason: `@types/react` absent; `any` at a boundary (F72, where a changed signature passed
seven of eight call sites in silence); a cast written to quiet a complaint (O34); and now
**a `number | null` return type checked by nothing**, because `strict` is absent from
`tsconfig.json` and `strictNullChecks` with it. `calculateJobTotal` was given that return
type deliberately so the compiler would visit its eight call sites. It visits none of them:
`acc + calculateJobTotal(job)` raises no error. The sites were checked by hand instead, and
the doc comment on that function now says so rather than claiming the compiler's help.

**The number, obtained without changing the config** — `npx tsc --noEmit --strictNullChecks
-p tsconfig.json`:

**23 errors, 7 files.**

| cluster | count |
|---|---|
| `auth.currentUser` possibly null | 9 |
| `activeAgency` possibly null | 9 |
| `activeAtMaster` possibly null | 1 |
| `activeAgency.estimateMaster.length` possibly undefined | 1 |
| `itemsList` possibly undefined | 1 |
| `string \| null` passed as `string` (`AppLayout.tsx:303`) | 1 |
| argument not assignable to `never` (`AgencyContext.tsx:1401`) | 1 |

By file: **`NewJob.tsx` 13**, `EstimateGenerate` 3, `ExternalInspection` 2,
`InternalInspection` 2, `AgencyContext` 1, `AppLayout` 1, `AllotmentWidget` 1.

**They cluster the way the 40 did, only harder** — there, 36 of 40 were one mechanical class
(undeclared properties) and 4 were real. Here **18 of 23 are one mechanical class on two
symbols**: guard-before-use at an auth or context boundary. Both are honestly nullable — the
Firebase user before sign-in, the agency before the context resolves.

**⚠ AND THAT CLUSTER IS THE FINDING, BECAUSE THE OBVIOUS FIX FOR IT IS THE WRONG ONE.**
Writing `if (!auth.currentUser) return;` at nine sites converts *possibly null* into
*silently does nothing*. That closes the typecheck gap by opening the silent-failure gap —
the identical trade refused four times in this session: the scrap charge that must not fall
back to a hardcoded 500, the HV coil weight that must not default to 47 kg, the winding
material that must not default to aluminium, and `calculateJobTotal` returning null rather
than the `?? 0` that would have made a short invoice look finished. **Each of those eighteen
sites needs a decision about whether the correct behaviour is an early return or a named
block.** That is what turns an hour of guard clauses into a half-day, and it is the only
reason the count is not the whole answer.

**It closes the third of four gaps, not all four.** `strictNullChecks` does nothing about
`any`. Every `job: any`, every destructure off one, and every `as any` — O34's subscription
reads included — stays invisible. It would have caught this session's finding. **It would
not have caught F72**, whose values were `any` at the boundary, and F72 is the one that
reached eight call sites unnoticed.

**`AgencyContext.tsx:1401` is benign — checked on its own merits and it is not a defect.**
The suspicion was reasonable and wrong: an argument rejected as `never` means an array
inferred as `never[]` is being pushed to, which usually indicates a collection nobody gave an
element type and which may be accumulating the wrong thing. Here `countOverridesForApply`
declares `const results = [];` at `:1346` with no annotation, and the function's **own return
type already spells the element shape out in full** — `Array<{ id; name; overrides;
inheritingCellsFrozen; sections; sectionWrites }>` — which the pushed object matches field
for field. It is a missing annotation on a local accumulator, fixable by reusing the return
type that is already written above it. The mildest of the 23, not the most interesting.

**Not applied.** Recorded so the decision is made on a number rather than an impression, and
so the next person to cite a clean `tsc` knows which of the four holes is still open.

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

## Pattern: every guard individually correct, together making the feature impossible

**The oil carry-forward existed for a week and never once wrote a figure.** Not because any
part of it was wrong — because each guard was right, and nothing ever evaluated them together.

| guard | why it was added | why it was correct |
|---|---|---|
| a deliberate act, not part of tender creation (F82) | an oil balance appearing inside a creation flow is a number the operator confirms without reading | true, and it is the reasoning the whole confirm-before-writing discipline rests on |
| refuse while any work belongs to no tender (F87) | a per-tender closing balance cannot include unassigned rows, so the figure would be short | true, and it caught a real `+0.00 LTR` offered against oil the DISCOM was owed |
| refuse while that count is merely unknown (F93) | a figure recorded against a tender must not rest on a count nobody has | true, and it closed a genuine staleness where one agency's count survived into another |

Each was reviewed on its own and passed. **The conjunction was never reviewed at all**, because
there is no moment at which anyone is asked to. A guard is added in response to a specific
failure; the question it answers is "does this prevent the bad case?", never "what is left
after this and everything before it?"

The result: in live data there was **no agency where the button both appeared and would fire**.
Four of five were blocked by unassigned work; the fifth had only one tender, so no carry was
offered. The nearest miss produced nothing for a reason that was, at the time, silent — and it
was reported as a rendering bug, which cost a round of investigation into code that worked.

**This class cannot be found by reading one guard.** Every individual review returns "correct".
It cannot be found by reading the diff that introduced any one of them either. It is only
visible from the question *"under what conditions does this feature actually run?"* — which is
a different question from *"is this check right?"*, and one nothing in a normal review prompts.

**The tell: a feature that has never successfully completed.** Not one that fails — one that
declines, plausibly, every time. Failures get reported. Declines look like the system working,
because a guard firing is indistinguishable from a guard being *needed*.

**The remedy that worked** was not to relax a guard. It was to notice the operator was being
asked to confirm a number the app computes, at a moment the app already knows it, and remove
the decision point entirely — the carry now happens inside `addAtMaster` (F96). The guards
became unnecessary rather than being weakened, and **needing three guards to make one
confirmation safe was itself the signal that the confirmation was in the wrong place.**

The general rule: **when a feature accumulates guards, count the paths that survive them.** If
the answer is zero, or the answer is "only in states the live data never reaches", the guards
are not protecting the feature — they are describing why it should not exist in that shape.

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

## Pattern: one printed document was fitted against a reference; the other three were guessed

The estimate paginates through `layoutEstimatePages`, which carries a real millimetre budget —
`JOB_BOX_MM`, `TOTALS_MM`, `SIGN_MM`, `ROW_MM`, `FALLBACK_CONTENT_MM`, every one of them
measured and corrected against the CSS when G7 fitted the sheet to a single A4 page.

The three landscape reports paginate through a hard-coded row count and nothing else:

| document | number | justification found in the code |
|---|---|---|
| Estimate | `layoutEstimatePages` | a mm budget, per element (G7) |
| External Inspection | `CHUNK_SIZE = 9` | none — bare constant (G20) |
| Internal Inspection | `CHUNK_SIZE = 9` | none — bare constant (G20) |
| Testing Report | `CHUNK_SIZE = 8` | *"clean landscape A4 pagination (8 jobs per page)"* — the value restated, not a model (G21) |

**Three documents with hard-coded row counts and no budget behind any of them is a pattern,
not three coincidences.** The difference is not care taken on the estimate and care withheld
elsewhere: **the estimate was fitted against a reference document — Ravi Electric's printed
estimate for job 21SRVOH-1, supplied by the user — and the other three never were.** A number
gets a model when something forces a comparison against paper. Nothing ever forced one here.

What the guessing cost was measurable once measured: all three landscape sheets were leaving
**roughly half to two-thirds of the page empty** while printing text at 6.5–7.5px, small enough
that the user could not read it. The row count implied a vertical limit; the binding constraint
was width the whole time. G20 and G21 gave each number the model it lacked rather than changing
it — the constants were not wrong, they were merely unexplained, and an unexplained constant
invites the next reader to spend from a budget nobody has written down.

### And a fourth case, which is the worse one: a model that is incomplete rather than absent

The fixed-rate estimate — *ESTIMATE FOR REPAIRING OF … / FIXED RATE (Internal & External)*, the
Amorphous and Wound Core format — sits in the same file as the itemised sheet and **shares
`layoutEstimatePages`**. The calculation returns early; the render does not. So this document
paginates through the one real mm model in the codebase.

**And the model does not describe it.** The constants were derived for the itemised sheet, and
the fixed-rate branch prints three blocks that sheet does not have — the sub-heading, the
1,024-character clause paragraph, and the two notes. Roughly **62 mm of content the budget does
not know exists** (about 75 mm after G22 enlarged them).

| | the three landscape reports | the fixed-rate estimate |
|---|---|---|
| what governs pagination | a bare row count | a real mm budget |
| what is wrong with it | there is no model | the model is not comprehensive |
| how it reads to the next person | obviously arbitrary | **authoritative** |

**An incomplete model is harder to see than an absent one, because the constants read as
measured.** `CHUNK_SIZE = 8` announces itself as a guess to anyone who looks. `JOB_BOX_MM =
30.5` alongside `TOTALS_MM = 29.7` and `ROW_MM = 4.8` reads as a sheet that was surveyed —
and it was, for the other branch. Nothing in it says which caller it was surveyed for.

**It has never been wrong, and the reason is slack, not correctness.** Two line items against
the itemised sheet's 29 leave about 100 mm spare, which absorbs the 62 mm silently. Correctness
that rests on a margin nobody has stated is indistinguishable from correctness that rests on
the arithmetic — right up until the margin goes.

**The failure mode is silent, and it is reachable by a user rather than a developer.** The
clause is agency-editable (`agency.amorphousClauseText`). Edit it longer and the browser clips
or spills while `layoutEstimatePages` still reports one page. There is no overflow check. The
letterhead notice cannot fire either — `paginatedByLetterhead` requires `totalPages > 1`, which
two rows can never reach. **Nothing would report it.** Compare G7, where the same layout
running out of room *did* produce a notice naming the setting and the shortfall: the difference
is that G7's shortfall went through the page count and this one would not.

G22 recorded all of this in the branch rather than changing the constants, including that
`JOB_BOX_MM` is exact for the itemised sheet and about 0.4 mm light for the fixed-rate one —
inside `SAFETY_MM = 4`, so not worth adjusting, but worth *saying*. A constant that is exact
for one caller and approximate for another should not present itself as uniformly measured.

### A declared row height that silently stops applying — invisible in both directions

Two of these documents declare a row height on `<tr>`. Both were found while enlarging the
type, and they fail in opposite directions:

| | Testing Report | fixed-rate estimate |
|---|---|---|
| the class | `h-6.5` | `h-4` |
| what it asks for | 26 px | 16 px |
| status when found | **doing the work** | **stopped doing the work** |
| why it could break | 6.5 is not in Tailwind v3's scale — under v3, or a config that pins the scale, the class emits nothing and rows size to content | at 9.5px the cells already held 18.25 px, so the rows had outgrown 16 px and been content-sized for some time |
| what said so | nothing | nothing |

**A row height is a minimum, so it stops applying by being exceeded rather than by erroring.**
Growing the font past it produces no warning, no layout break and no visual tell — the rows
simply get taller and the class becomes decorative. And it can stop applying without anyone
touching the file at all: `h-6.5`'s dependency is the *Tailwind version*, not this component.

The pair is the point. `h-6.5` is a declared height carrying real weight on a foundation
outside the file; `h-4` is a declared height carrying nothing while still reading as a
constraint. **From inside the component the two are indistinguishable** — same syntax, same
apparent authority, opposite truth — which is why the enlargement had to check rather than
assume in both places. G21 left `h-6.5` alone and documented what it rests on; G22 restated
`h-4` as `h-7` against the new type so the declared number is once again the one that decides.

---

## F87. `?? ''` in JavaScript and `== ''` in a Firestore query are not the same test

**JavaScript coalesces a missing field; Firestore refuses to match one.** Every place this
codebase uses one to reason about what the other will return is suspect.

```js
String(job.atId ?? '') === ''          // TRUE for absent AND for empty
where('atId', '==', '')                // matches ONLY empty. Never absent.
```

There is no Firestore predicate for "this field is missing" — not `== ''`, not `== null`,
not `!=` anything. A document without the field is invisible to every equality on it. So
"unassigned" is **not expressible as a query at all**; it can only be recognised after
reading, in memory.

**Where it bit.** The MR Ledger backlog banner — added in F82 precisely so that jobs
belonging to no tender would not vanish behind the new tender filter — was written as
`where('atId','==','')`. Live data holds 12 unassigned jobs: **4 with `atId: ''`, 8 with the
field absent.** The banner found 4. Among the 8 it could not see was `MSBT-12`, estimated
₹5,661, billed ₹6,413 and **paid** — the exact job the banner was built to keep reachable.

The same query shape in the Oil register excluded **all four** oil transactions, every one of
them field-absent: **843.75 LTR** that the DISCOM is owed, rendering as an empty register and,
worse, as a carry-forward dialog offering **"+0.00 LTR"** — a figure indistinguishable from a
tender that genuinely closed level, presented for a person to confirm.

### 1. A plausible wrong count is worse than nothing

A banner reading *"4 jobs belong to no tender"* **asserts that four is the number.** Nobody
re-counts an answer that looks like one. Had it shown zero, the operator would have
questioned it immediately — zero is a claim that invites checking; four is a claim that
closes the question.

This is the same shape as F81 and as the whole "Recurring theme" essay below: an error that
renders as a plausible value is indefinitely survivable, where a dash, a blank or a crash
is self-reporting. Here it is sharper than usual, because **the wrong number was produced by
the very mechanism installed to prevent the loss.** A safety net reporting a third of what it
catches is not a partial safety net; it is a false negative wearing a safety net's clothes.

### 2. Two tools measured the same quantity by different means, and nobody put the numbers side by side

This is the transferable part.

| | how it filtered | what it reported |
|---|---|---|
| `scripts/admin/assign-at.js` | JavaScript: `!String(j.atId ?? '').trim()` | **12** unassigned jobs |
| the app's banner | Firestore: `where('atId','==','')` | **4** unassigned jobs |

Both numbers were reported to the user in this session, days apart. **Neither of us noticed
they disagreed.** Each was individually plausible, each arrived in its own context, and
nothing in either presentation invited comparison with the other.

The script was right and the app was wrong, but that is incidental. The finding is that **a
discrepancy between two measurements of one quantity is invisible unless something puts them
in the same place.** Verifying each in isolation cannot detect it — both passed inspection.

The working rule: **when a script and the app answer the same question, print both numbers
together and assert they match.** Not "the script confirms the app" — that is what was
believed here — but a literal side-by-side. `scripts/admin/unassigned-census.js` now does
this: it replays the app's own client-side rule against live data and prints the count the
screen will show, so the two can only diverge loudly.

The wider version of this rule was already recorded for estimates (F41/F55), job numbering
(F68) and job-number parsing (F81), each time as "one implementation, not two". This is the
case where the two implementations are in **different languages against different engines**,
which is exactly where "keep one copy" cannot be applied and the side-by-side check is the
only available substitute.

### 3. What was swept, and what it found

Every Firestore equality against a falsy literal, and every JavaScript `?? ''` guard used to
reason about a query's results:

| site | shape | verdict |
|---|---|---|
| `MrLedger.tsx` banner | `where('atId','==','')` | **the defect.** Now an agency-wide read filtered by `isUnassigned` |
| `OilInward.tsx` ×2 | `where('atId','==', <id>)` | **the defect.** Now one agency-wide read split in memory |
| `AtSettings.tsx` carry-forward | `String(t.atId ?? '') === at.id` | correct as a per-tender filter — `''` is never an AT id — but it **silently drops** unassigned rows from the closing balance. Now counted and the carry **refused** while any exist |
| `Dashboard.tsx` scoping | `String(j.atId ?? '') === scope` | same: correct filter, silent exclusion. Now states the excluded count |
| five screens' tender clause | `where('atId','==', atScope(at) ?? NO_ACTIVE_AT)` | **correct.** A positive match on a real id; unassigned work matching no tender is intended |
| `NewJob.tsx:793` GP lookup | `where('agencyId','==', activeAgency?.id \|\| '')` | same shape, benign today — no job has `agencyId` absent, and with no agency the empty match returning nothing is the wanted outcome. Left alone, recorded here because the shape is identical |
| `AgencyContext.tsx:1850` | `String(a.status \|\| '') === 'Active'` | in-memory only, no query counterpart. An AT with no `status` is never "Active" — correct by rule 3 of `isIntakeOpen`, which treats blank as open |
| ~60 `x.trim() === ''` in inspection forms | in-memory field validation | not this class. No query counterpart to disagree with |

**The tell for the future:** a `?? ''` or `|| ''` whose result is then compared to something,
where the *same field* is also used in a `where()` clause somewhere else. The two will agree
for every document that has the field and disagree for every document that does not — and
which documents lack it depends on when they were written, so the divergence grows with the
age of the data rather than with anything visible in the code.

**Two helpers now exist so this cannot be re-decided per site:** `isUnassigned(row)` (absent
and empty alike, the test no query can make) and `atClause(at, viewingAll)` — the single
place the three scope states become a filter, carrying the warning that it cannot find
unassigned work and that nothing can.

---

## F88. A signed figure that never said which direction it ran

`-2120.00 LTR` does not say who owes whom. The Oil register showed the sign and left the
direction to be inferred — from a column heading two screens away, or from the fact that
positive was coloured red.

**What the register showed after a carry-forward, before this entry:**

| question | answer |
|---|---|
| is the opening balance a line in the register? | **no** — a figure in a stat card above it, outside the ledger |
| is the sign preserved and meaningful? | preserved; **not stated**. Nothing on screen said which way it ran |
| is the source tender named? | **no** — "carried from the previous tender", while the record holds exactly which one in `openingOilBalanceFromAtId` |
| per-division lines, or only the total? | divisions appeared, but as 10px rows **inside the stat card**, not as register lines |

### The convention, and the fact that the first attempt at it was backwards

**Positive = the division owes the agency. Negative = the agency owes the division.**

**This was shipped stating the exact opposite,** and was corrected only because it was
checked against a real document rather than reasoned about. The first version read the app's
own column heading — *"Net Pending / Shortage (LTR)"*, positive coloured red — concluded that
red-and-pending meant the agency's liability, and wrote "agency owes the division" onto the
screen. Every prose statement of the convention elsewhere in the codebase had been written
during this audit from that same reading, so the codebase agreed with itself and was wrong.

**The source that settled it:** `03 SBT CO Oil Account MARCH-2026.xlsx` — the UGVCL
agency-wise oil accounting workbook, sheets SGP / RGP / OGP, ~2,300 rows per sheet.

```
Total oil in         = Opening balance + Oil required to top up failed X'mer + Filtration loss
Balance oil with agency = Total oil in − Oil Issued to agency
```

Verified on real rows — CHINTAMANI LAMINATION `122 + 394 = 516`; KRYFS TRANSFORMERS
`−172 + 140 = −32`; NAKODA `−85.50 + 165 = 79.50`.

The balance **rises** with oil the agency puts into transformers and **falls** with oil the
DISCOM issues. A quantity that grows when you spend and shrinks when you are supplied is a
**receivable**, so positive means the division owes the agency. The sheet confirms it twice
over by dividing that balance to produce *"Oil consumption per X'mer"* — it is measuring
consumption, not stock.

**The trap that produced the wrong answer.** The column names cut the other way: *"Opening
balance of oil with agencies"* and *"Balance oil with agency"* both read as oil physically
sitting in the agency's shed, which would make positive a liability. The arithmetic rules
that out — **filtration loss destroys oil and yet increases the balance**, which no measure
of stock on hand can do. The names are loose; the formula is not. Reading the header and
stopping is exactly what the first attempt did.

The app's *sign* was already right — `shortage − received` is the same arithmetic as the
DISCOM's, with the 5% filtration loss inside the shortage. **Only the words were wrong**, and
they were wrong in the dangerous direction: previously only a sign was shown, and a sign is
ambiguous enough that a reader checks. Words are believed. Making the direction explicit
raised the cost of getting it backwards, and the first attempt got it backwards.

**The rule this yields:** when a figure crosses an organisational boundary, do not derive its
direction from the application's own labels — the application is where the misunderstanding
would live. Derive it from the counterparty's document, and prefer its **arithmetic** to its
**column headings**.

The field carrying this for colouring is deliberately named `agencyIsOwed`, not `agencyOwes`:
the earlier name asserted the wrong direction, and a misnamed boolean is how a wrong
convention gets copied into the next call site without anyone re-deriving it.

### Two defects found while building it

**1. The opening balance ignored the division filter.** `subTotalNetBalance` added the
*agency-wide* opening figure to a *division-filtered* movement. Filtering the register to
KALOL showed KALOL's shortage plus every division's carried balance, labelled as KALOL's net.
The per-division map recorded in F86 is what makes the right answer available; nothing was
reading it. Now `openingForFilter` selects the division's own opening, and a division absent
from the map opens at zero — correct, since the map holds every division that moved.

**2. The Excel export's total already included the opening balance, with no row to explain
it.** The exported rows did not sum to the exported total. Anyone reconciling it would
conclude the *total* was wrong, which is the opposite of the truth. The opening rows are now
exported above the ledger, with the direction written per line — a bare `-2120` in a cell
opened six months later says nothing at all.

**A signed quantity that crosses an organisational boundary must carry its direction in
words, not in its sign.** The sign is a convention held in one file; the reader is a person
settling an account with a division. This is the same class as the "Terminology hazard"
entries below — a value whose meaning depends on context the reader does not have — but
sharper, because unlike an ambiguous *label* an ambiguous *sign* still looks fully specified.

### ⚠ Shipped unexercised

**No AT has ever had a carry-forward recorded** — `openingOilBalance` is absent on all seven
in live data, and the carry is now correctly refused for four of the five agencies because
unassigned work exists (F87). So **every rendering added here — the opening rows, the
transactions panel, the export rows, the division-filtered opening — has never been displayed
against real data.** What was exercised: `tsc` clean, and `describeOil` checked at its edges
(2120, −2120, 0, ±0.004, −0.01, NaN, undefined).

This is recorded rather than left implied because the first thing that will exercise these
paths is a real carry-forward on a real tender, and whoever performs it is the first person
to see the output. The division-filter fix in particular changes an arithmetic that has never
run with a non-zero opening balance.

### The general form

One helper, `describeOil(litres)`, now produces the signed string and the direction phrase
together, so no site can print one without the other. It rounds to two decimals **before**
choosing the sign, so `-0.004` renders `0.00 LTR / settled level` rather than the nonsense
`-0.00 LTR / division owes the agency`. Five call sites use it: the register's opening rows,
the sub-total row, the transactions panel, both stat cards, and the carry-forward dialog.

---

## F89. A refusal built on an objection that applied to a different figure

The Oil register refused to render in "All tenders" mode. The argument was that oil cannot be
summed across tenders, because each tender's balance already opens with the previous tender's
closing figure, so adding them counts the same litres twice.

**That is true of the per-tender NETS, and nobody was proposing to sum those.** Summing the
raw movement — shortage from inspections, oil received from transactions — cannot double-count,
because an opening balance never appears in it. The objection was correct about a figure that
was never on the table, and it was used to withhold one that was well-defined all along.

Two questions, two correct answers, and neither is the other with a filter relaxed:

| scope | net |
|---|---|
| one tender | opening balance + that tender's movement |
| all tenders | movement alone — `Σ shortage − Σ received`, opening balances excluded |

The second is the DISCOM's own subtraction with its opening column dropped. `openingForFilter`
returns 0 in all-tenders mode, and the F88 opening lines do not render there — they are
exactly what is being excluded.

### The correction inside the correction

The instruction as first given was "sum the TRANSACTIONS, ignoring opening balances". That
undercounts by one whole side: **`oilTransactions` records only oil RECEIVED.** The shortage
side lives in external inspections. Transactions alone would have produced:

| agency | transactions only | both sides |
|---|---|---|
| AARATI TRANSFORMER | **0.00** — it has no transactions at all | **+333.80** |
| ADMIN | **0.00** | **+2110.00** |
| MEGHA | −423.75 | **+941.85** |

AARATI would have read a flat zero while carrying 333.80 LTR the division owes it — the same
class of failure as the empty register that started this thread, arriving through a different
door. Worth recording because the phrase "sum the transactions" *sounds* like it names the
whole ledger, and in this schema it names half of it.

### The caveat that cannot be fixed from inside the app

The agency-wide net is **the app's recorded history, not the division's.** The UGVCL workbook
carries real opening balances that predate any app record — CHINTAMANI +122, KRYFS −172,
ALFA −171, DISHA −20, all on the first row of the year. If an agency was not at zero with the
division when its app records began, this figure differs from theirs by exactly that amount,
**permanently**, and nothing inside the app can detect the difference.

Both limits are stated on the screen and repeated in the Excel export, because a spreadsheet
outlives the screen it came from and this is a figure someone may reconcile against the
DISCOM's account months later.

**It could not be checked against a real row.** None of the agencies in live data — MEGHA,
AARATI, UPENDRA, DRISHIV, suchit — appears in any of the three tabs of the Sabarmati CO
workbook, which lists ACCORD, ALFA, BAGADIA, CHINTAMANI, KRYFS and the rest. The *formula* is
confirmed against their arithmetic; the *figures* are confirmed against nothing of theirs.

`scripts/admin/oil-net-census.js` prints what the screen will show, copying the app's own
`jobOilShortage` including its kVA capacity defaults and 5% filtration loss — the side-by-side
discipline from F87, applied at the point the rule was written rather than after it failed.

### Also fixed here

The fetch effect listed only `[activeAgency]`. It survived while the query itself was
tender-scoped; it does not survive now that one agency-wide read is **split** per tender in
the component, since changing tender changes the split without changing the read. Switching
tender would have left the previous tender's rows on screen.

---

## F90. A manual input for a figure the app can derive — built, then removed

**Built and removed in the same session. Nothing was ever recorded through it, on any agency,
so the removal stranded no data** — checked before deleting, since removing a field that holds
live values is a different operation entirely.

An agency joining mid-relationship with the DISCOM has a position that predates every record
here, so the agency-wide oil net (F89) is wrong by that amount permanently and invisibly. The
DISCOM's own workbook proves such positions are real and non-zero — CHINTAMANI +122,
KRYFS −172, ALFA −171 on the first row of the year.

The response was a form: per-division figures, a required free-text source, author and date,
and an append-only edit trail. Guarded properly — the source requirement lived in the form,
the context and `firestore.rules` at once, and absent was kept distinguishable from zero in
three separate places.

**It was the wrong shape, and the reason is worth keeping.**

> This app automates. Where a previous AT exists the figure is already computed from its jobs
> and transactions, and the carry-forward writes it. Asking someone to type a number the app
> can derive is the wrong shape.

The feature was justified by the case it could not reach — an agency's *first* tender, which
has no predecessor to carry from — and then built as a general input available on every
agency, including the ones where the automated path already produces the number. **A remedy
scoped to the exception, offered as the rule, competes with the derivation it was meant to
supplement.** Two ways to establish one figure is the shape this audit has removed repeatedly:
F41/F55 in estimates, F68 in job numbering, F81 in job-number parsing.

Removed: the form, the five agency fields plus history, the rules clause, the term in the
all-tenders net, the export rows. `firestore.rules` redeployed. **The carry-forward stays** —
that is the automated path.

### The caveat outlives the remedy

The all-tenders register used to end its caveat with a link to the form. The limit the link
offered a remedy for is unchanged and still true: a position predating the app's first record
cannot be seen from inside the app. So the caveat stays and stops pretending there is a button
for it, ending instead with what a person can actually do — reconcile against the division's
own oil account before quoting the figure.

**A limit stated without a fix is honest; a limit dropped because nothing can be done about it
is not.** The temptation on removing a feature is to remove the warning that motivated it,
which would leave the register asserting a figure with no qualification at all — strictly
worse than before either existed.

⚠ **The residual gap, recorded so it is not rediscovered as a bug:** an agency whose FIRST
tender in the app opens with a real position carries that error forever, and there is now no
path — automated or manual — to state it. This is a known and accepted limit, not an oversight.

## F91. Deleting the unassigned test data — what moved, and what was kept

`scripts/admin/delete-unassigned.js`, applied 2026-08-27. **9 jobs, 3 inspections and 4 oil
transactions removed. 3 jobs refused and kept.**

Nothing creates unassigned records any more — New Job, MrLedger's add-unit and Oil Inward all
stamp the active tender at creation (F82) — so the set was closed and could not refill.

### The agency-wide oil nets moved, permanently

These are the figures an agency reconciles with a division (F89), and they are recorded here
because after the delete there is no way to derive what they used to be.

| agency | before | after | moved by |
|---|---|---|---|
| MEGHA | +941.85 | **+1365.60** | +423.75 |
| AARATI TRANSFORMER | +333.80 | **+112.00** | −221.80 |
| DRISHIV | −210.00 | **0.00** | +210.00 — the agency has no oil records left at all |
| suchit | −198.00 | **0.00** | +198.00 |
| UPENDRA | +28.15 | **0.00** | −28.15 |
| ADMIN | +2110.00 | +2110.00 | unchanged |

Positive means the division owes the agency (F88).

**MEGHA's net went UP by deleting oil it had received** — 423.75 LTR of credit removed. That
is arithmetically correct and worth stating plainly, because "we deleted some oil records and
the agency is now owed more" reads as a fault until the sign convention is applied.

⚠ **If any of these 843.75 litres was real oil rather than test data, there is now no way to
restate it.** The day-one opening position that would have held such a claim was removed (F90),
and these litres cannot be recovered from the records — the records are gone. The all-tenders
caveat covers it: reconcile against the division's own oil account.

### What was kept, and why

**MSBT-12 / MR 1 (MEGHA)** — kept indefinitely. It carries estimate ₹5,661, BILL/1 ₹6,413,
**paid ₹6,680** and challan `yrtr2`. The 267 overpayment is C3's refund and **this job is its
only evidence**. O33 named this exact record as the one the app's delete path would destroy in
two clicks. It is also referenced by name in this file, so deleting it would leave an audit
entry pointing at a document that does not exist.

**MSBT-12 / MR 9344 and MSBT-1 / MR 9344 (MEGHA)** — challans 12 and 232, both `Dispatched`,
no bills. Undecided at time of writing; they block MEGHA's oil carry-forward (see below).

Two of the three blocks came from a **challan alone**. A guard testing only `billNo` would
have deleted both. The issued-document test in the script is deliberately broad — amounts,
payment date and `issuedByAgencyId` included — on the principle that a false positive costs a
decision and a false negative destroys evidence.

### Nothing was stranded, and that was checked rather than assumed

The script deletes an eligible job's inspections in the same batch, closing O33's second gap
instead of reproducing it. It then looks for what its own cleanup would have missed:
inspections naming a deleted job through any of the four link rules but not matched, and oil
transactions keyed to an MR losing all its jobs — the `mrNo`-not-`jobId` route. **Both empty.**
That is a statement about this set, not a claim that orphaning is impossible.

**MR 9344 spans two agencies.** AARATI's job `101` was deleted from it while MEGHA's two jobs
remain. Five MRs disappeared entirely (5933, 34, 000001, 214, 125); 9344 survived with two.
MR numbers are not unique across agencies — `scripts/admin/mr-across-agencies.js` exists for
this, and it is the reason the delete is per job rather than per MR.

### The cleanup unblocks four agencies and not the fifth

An unassigned job blocks that agency's oil carry-forward (F87), and the block is agency-scoped:

| agency | unassigned after | carry-forward |
|---|---|---|
| AARATI, suchit, DRISHIV | 0 | unblocked |
| **UPENDRA** | 0 | **unblocked, and it has a real previous-tender pair** (24-25 → AT2026-27) |
| ADMIN | 0 | was never blocked |
| **MEGHA** | **3 jobs** | **still refused** |

⚠ **The MEGHA block is latent, not active.** MEGHA has one tender, so `previousAtFor` returns
null and no carry button is offered at all — the refusal changes nothing today. It bites at
MEGHA's next rollover, when a second tender exists and the carry is wanted. Keeping three
unassigned jobs means that carry can never be offered until they are assigned or removed.

---

## F92. Two positions left standing on purpose

Neither of these is a defect to fix. Both are states that will look like defects to whoever
meets them next, and both were decided rather than overlooked.

### MEGHA's three unassigned jobs, and the refusal that follows

**MEGHA holds three jobs with no `atId`, and this is the settled position — there is no
deadline on it.**

| job | MR | carries |
|---|---|---|
| MSBT-12 | 1 | estimate ₹5,661, BILL/1 ₹6,413, **paid ₹6,680**, challan `yrtr2` |
| MSBT-12 | 9344 | challan 12, Dispatched |
| MSBT-1 | 9344 | challan 232, Dispatched |

**The consequence: MEGHA's oil carry-forward will refuse at its next rollover**, with the
accurate reason *"Cannot carry oil — 3 jobs belong to no tender"* (F87). It refuses because a
closing balance computed per tender necessarily excludes work belonging to no tender, so the
figure would be short by whatever those jobs hold.

⚠ **The refusal is latent, not active.** MEGHA has one tender, so `previousAtFor` returns null
and no carry is offered at all today. It bites when a second tender exists.

**Two resolutions, and only one of them works:**

1. **Assign them a tender from the paperwork.** This is the only resolution that clears the
   refusal — and it must cover all three, because MSBT-12/MR 1 stays regardless of what
   happens to the other two and alone keeps the block in place. `scripts/admin/assign-at.js`.
2. **Accept the refusal as accurate.** It is not a bug; it is the check reporting a real gap.

**What was explicitly rejected:** assigning all three to `AT 26-27` because it is the only
tender MEGHA has. *Being the only candidate is not evidence.* That would convert "we do not
know which tender these belong to" into a recorded claim that they belong to this one — the
same absent-vs-zero collapse F90 was built around and F82 drew first, arriving as a
convenience.

MSBT-12 / MR 1 is kept indefinitely regardless: it is C3's only evidence, and it is named in
this file, so deleting it would leave an audit entry pointing at a document that does not
exist.

### UPENDRA can exercise F88's carried-balance rendering — and should not

After F91, UPENDRA is the only agency with a real previous-tender pair (`24-25` →
`AT2026-27`) and zero unassigned records, so it is the only place the F88 rendering — shipped
unexercised — could be run.

**What its carry would write:**

```
openingOilBalance           = 0
openingOilBalanceByDivision = {}          <- empty; no division has any movement
openingOilBalanceFromAtId   = <AT 24-25>
```

**Because UPENDRA now has no records at all** — its only two jobs were among the twelve
unassigned, and F91 deleted them. `AT 24-25` contains zero jobs and zero transactions.

**Recording it would assert that AT 24-25 closed level, which the app cannot support.** No
records is *"we have no account of what happened"*, not *"nothing happened"* — the distinction
F82 drew for the tender carry, and which F90 was built around before being removed. This is the
`+0.00 LTR` dialog that started the whole oil thread, arriving with a different cause: then
the zero came from a query excluding everything, now it comes from an empty history. The
figure is honest and the assertion is not.

**And it is one-way.** Once `openingOilBalance` holds any finite number, including zero, the
Tenders card shows the badge and the carry button is unreachable — nothing else in `src/`
writes the field. So recording a zero to exercise a rendering would **permanently consume the
only route to recording a real figure later**, in exchange for testing a display against
all-zero data.

⚠ **The code comment at that branch used to claim the opposite** — "re-carrying after a
correction is possible through the same action". It is not, and never was; the branch returns
the badge before reaching the button. Corrected in place. This is the third time in this audit
a comment written during the work asserted behaviour the code did not have (see F87's
"the context refetches on its own", and F88's direction convention), and the pattern is
consistent: **a comment describing intent gets written in the same pass as the code and is
never re-read against it.**

The gap is recorded rather than quietly closed, because making the carry re-runnable means
deciding what a corrected carry does to a figure someone may already have settled with a
division — which is a question for the person holding the paperwork, not a code change.

---

## F93. A refusal that closed the dialog and said nothing

The oil carry-forward's confirm-time guard did this:

```js
if (unassignedOil.txns > 0 || unassignedOil.jobs > 0) {
  setCarryTarget(null);
  return;            // dialog closes. No message. Nothing written.
}
```

**A silent refusal is indistinguishable from success.** The dialog closes exactly as it would
after a successful write; the only way to discover nothing happened is to read the register
later and find 0.00 — which is precisely how this surfaced, as a suspected rendering bug in
the F88 opening lines. It cost a round of investigation into code that was working.

**F87 built the BUTTON's refusal to state its reason and left this one mute** — the same
defect, in the same feature, a few lines from the fix for it. The reasoning that produced the
first was never carried to the second because the second is on the *write* path and the first
is on the *render* path, and they were written in different passes.

The refusal now renders **in the dialog, which stays open**, naming what blocks it in the same
words the button uses. There is no longer a branch that returns without a message.

### The staleness behind it: an absence read as a fact

`unassignedOil` was initialised to `{ txns: 0, jobs: 0, litres: 0 }`. **Zero is the value that
unblocks the carry**, so before the read resolved, after a read that failed, and while
`activeAgency` was briefly null, the component asserted *"nothing is unassigned"* on no
evidence. Nothing reset it on an agency change either, so a count from a previous agency could
survive into the current one — MEGHA's three unassigned jobs blocking, or failing to block, a
carry on ADMIN.

This is the **`pastJobsLoading` shape** exactly: an absence or a staleness read as a fact, and
the fact it is read as is the permissive one. The fix is the same — **make not-knowing its own
value** so every consumer must handle it:

- `null` means not known. It is set **synchronously at the top of the effect, before any
  await and before the early return**, so no window exists in which the previous agency's
  count is attributed to this one.
- A failed read sets it back to `null`, never to zero.
- The button renders *"Checking for unassigned work…"* rather than offering itself.
- `runCarry` refuses `null` with its own message, distinct from the has-unassigned-work one.

⚠ **The compiler could not catch the null dereference this introduced.** `tsconfig.json` sets
no `strict`, so there is no `strictNullChecks`: reading `.txns` off a `null` typechecks
cleanly and throws at runtime. `npm run lint` passed on the intermediate state. The explicit
`=== null` branch is doing the job the type system would otherwise do, and that is worth
knowing before relying on a green typecheck for any nullable state in this codebase.

### Instrumentation, left in place

Twelve `[CARRY]` console lines cover the whole path — read starting (with the reset), read
resolved (with the counts and the unassigned job numbers), read failed, dialog opened, confirm
pressed, each refusal branch, the write attempt, and the write result. Added because the
alternative was a theory: the stored fields proved the write never landed, but nothing in the
data could show *which* branch stopped it. This is the same approach that ended the burning
job numbers (F60) — instrument the path, reproduce, read the output.

---

## F95. The same error, corrected in a message and left standing in the code

**F89 records this error being made in conversation and corrected: "sum the transactions"
names only half the oil ledger, because `oilTransactions` holds the RECEIVED side and the
shortage side lives in external inspections.** The correction was written up, the all-tenders
net was built on the right definition, and a census script was added to hold it.

**The identical error was already in the Dashboard's oil card, and nobody looked.**

```js
scopedOil.forEach(tx => { totalGrossLiters += tx.grossLiters; totalBarrels += tx.barrels; });
const netUsableLiters = totalGrossLiters - totalGrossLiters * 0.05;
```

Receipts only. No inspections read; `computeOilBalance` never called. The card is titled
**"Oil Account Ledger"**, links to the Oil Account, and measured a different quantity:

| | Oil Account register | the card |
|---|---|---|
| formula | `Σ shortage − Σ received` | `Σ grossLiters × 0.95` |
| inputs | inspections **and** transactions | transactions only |
| meaning | what is owed, signed | how much usable oil arrived |
| can be negative | yes | never |

### Why correcting one instance did not find the other

**Correcting an error is not the same as searching for it.** The conversational correction
closed the question — the definition was settled, the code built on it was right, and
attention moved to the next thing. Nothing in "I got that wrong, here is the right formula"
prompts the follow-up "where else is that formula already written?"

It is the same failure the sweep discipline exists for and did not get applied to, because a
correction *feels* like a completed unit of work in a way a bug report does not. The rule that
would have caught it is the one already recorded at F87 and used since: **when a definition is
corrected, grep for every other site computing the same quantity, before moving on.** Two
minutes here, against a card that had been wrong for the life of the feature.

### It was only visible once the number went away

While four oil transactions existed the card showed *a* figure, and nobody reconciled it with
the register. F91 deleted the last of them, and the card read **"No oil records logged yet."**
against a register showing **+2110.00 LTR** for the same tender — a contradiction stark enough
to report as a bug. Before that the disagreement was a mismatch between two plausible numbers,
which is the harder failure to notice, exactly as the closing essay describes.

That is also why it was initially reported as a scope or filter fault. It was neither.

### Fixed

- The card calls `computeOilBalance` — the shared implementation (F82), so it cannot disagree
  with the register.
- The Dashboard's fetch gains `inspections`. Not agency-filtered, because the collection
  carries no `agencyId`; `computeOilBalance` matches each job to its own inspection, so extra
  rows are inert, and the register reads it the same way.
- Barrels and gross litres are dropped. The card shows shortage, received, the signed net and
  **the direction in words** from `describeOil` (F88).
- A zero from an empty set is still distinguished from a settled account — `hasAnything`
  counts the inputs rather than testing the total.

Per-tender figures the card will now show, verified against live data:
MEGHA `AT 26-27` **+1201.60**, ADMIN `2026_27` **+2110.00**, AARATI `2026-27` **+12.00**;
the other four tenders hold nothing and say so.

### And the scope case that was right by accident

```js
oilTransactions.filter(t => String(t.atId ?? '') === activeAtMaster?.id)
```

With no tender selected this compares a string to `undefined` — never equal, so nothing
matches, so the screen shows nothing. **The right answer, reached by a coincidence of types
rather than any statement of intent**, and one tidy-up away from silently showing every tender
at once. `strictNullChecks` is off in this project (F93), so the compiler had nothing to say
about it either. Now three explicit branches: all tenders, one tender, none.

---

## F96. Every guard that made the manual path safe was another way for it to decline

The oil carry-forward was a button and a confirmation dialog. **Across a week of work it never
once wrote a figure.**

The history is the argument, and it is written up as its own entry above — *"every guard
individually correct, together making the feature impossible"* — because the shape generalises
past oil. F82 built it as a deliberate act, on the reasoning that an oil
balance appearing inside tender creation is a number the operator would confirm without
reading. F87 then had it refuse while any work belonged to no tender — correct, since a
per-tender balance cannot include unassigned rows. F93 had it refuse while that count was
merely *unknown* — also correct, since a figure recorded against a tender must not rest on a
count nobody has. Each guard was right on its own terms. **Together they meant that in live
data there was no agency where the button both appeared and would fire**, and the one that
came closest wrote nothing for a reason that was, at the time, silent.

**The operator was being asked to confirm a number the app computes, at a moment the app
already knows.** A rollover *is* the event that carries the balance. So it happens in
`addAtMaster`, in the same write that creates the tender, and nobody is asked anything.

### The rules, and the one that is not in the spec

- previous tender = the agency's most recent AT by `startDate` **strictly before** this one's.
  Not creation order — an AT created later can start earlier.
- no previous tender → no opening balance. The first tender starts at nothing, and **absent is
  not zero**.
- **previous tender with no records at all → also no opening balance.** This was not in the
  requirement and is added deliberately: *"we have no account of what happened"* is not *"it
  closed level"*, and writing `0.00` converts the first into the second permanently (F82,
  F92). A tender that genuinely closed level **has** records netting to zero, and that zero
  **is** written — the test is `jobsCounted > 0 || transactionsCounted > 0`, not the total.
- unassigned work in the source → **still carry**, and stamp `openingOilBalanceIncomplete`.
  Refusing to create a tender because of old unstamped rows is worse than an approximate
  figure that says it is approximate. The register prints *"Approximate — when this tender
  opened, N jobs belonged to no tender…"* and the Tenders card shows the badge in amber with
  *"— approximate"*.
- a failed read does not block the rollover. Same reasoning as the job-number counter seed
  directly above it: the tender is created either way, with no opening balance rather than a
  wrong one.

### Scope: oil only, and nothing else moved

Confirmed against the code, not assumed. The change adds `openingOil*` fields to the new AT
document and reads `jobs`, `inspections` and `oilTransactions` to compute them. **It writes
nothing to any job, inspection, estimate, bill or challan, and it does not touch `atId` on any
record.** Old work stays under the tender it was booked into and is completed there, priced
from that tender's own rate schedule and AT percentage (F72) — untouched, because pricing
resolves from the job's `atId` and no `atId` changes here. A new tender still starts empty of
work and now opens only with the previous tender's oil position.

### Removed

The button, the dialog, the two refusal states, `carryOilBalanceForward`, `previousAtFor`, the
`unassignedOil` count and all twelve `[CARRY]` instrumentation points. The Tenders card keeps a
read-only badge: the carried figure, its source tender, the division count, and whether it is
approximate.

**The F93 fixes are not lost, they are obsolete.** The silent refusal and the
zero-as-unknown staleness were both defects of a confirmation path that no longer exists.
The lessons stand recorded; the code they applied to is gone. That is the better outcome —
`unassignedOil` needed three guards to be safe, and needing three guards was the signal.

### Backfill

ATs created before this change have no opening balance and never will, since the moment that
writes it has passed. `scripts/admin/backfill-opening-oil.js`, dry run:

```
WOULD WRITE (1)
  ADMIN — AT 2028-09   carried from AT 2026_27
     DEESA  +2110.00 LTR   division owes the agency

SKIPPED (6)
  five ATs — no previous tender
  UPENDRA AT2026-27 — AT 24-25 holds no jobs and no transactions
```

**Exactly one qualifies**, and the rule that excludes UPENDRA is the same one built into
`addAtMaster` rather than a special case: its source tender is empty, so there is nothing to
carry and a `0.00` would be an assertion the data cannot support.

⚠ **A backfill snapshots today's data, not the data at rollover.** The automatic version
computes the source tender's closing net **at the instant the new tender is created**; a
backfill computes it **now**. For ADMIN — created recently, against data that has not moved
since — those are the same number. For an older tender they would not be, and **the difference
would be silent**: nothing in the stored fields distinguishes a figure captured at rollover
from one reconstructed months later, and `openingOilBalanceAt` records when it was *written*,
not what it was computed *from*.

That is the whole reason this is a one-off script requiring approval rather than something the
app runs on load. An automatic backfill would quietly restate history for every tender it
touched.

**Applied 2026-08-28.** One tender written:

```
AT 2028-09   openingOilBalance           2110
             openingOilBalanceByDivision { "DEESA": 2110 }
             openingOilBalanceFromAtId   krdXRrzgCl0aTbJNTiL4  (AT 2026_27)
             openingOilBalanceIncomplete ABSENT — ADMIN has no unassigned work
```

The register reads **+2110.00 LTR — division owes the agency**, sourced from AT 2026_27. This
is F88's opening-line rendering running against real data for the first time; it shipped
unexercised and stayed that way through F92 for want of a tender that could carry anything.

---

## F97. A correct figure that reads as a typo

Fresh oil's Gross Liters field was `readOnly`, with the tooltip *"Fresh oil is fixed at 210L
per barrel."* A division can send a barrel short, so it is not fixed — the field enforced as
policy what was only ever a convenience, and the tooltip stated it as fact.

Now: the field accepts a typed value, a typed value survives a barrels change (the job-number
field's rule), and `grossLitersManual` records that the default was overridden.

### The interesting half is the display, not the input

A short barrel stores `barrels: 1, grossLiters: 195`. **Every other Fresh row in the ledger is
a multiple of 210**, so 195 beside "1 barrel" reads as a data-entry slip — and the person most
likely to "correct" it is someone reconciling against the division months later, who has no way
to know it was deliberate.

**This is the audit's recurring plausible-value finding running backwards.** The usual case is
a wrong number that looks right, and is therefore never questioned. Here it is a *right* number
that looks *wrong*, and is therefore questioned — inviting a correction that would make it
wrong. Both come from the same absence: nothing on the record distinguishes *recorded* from
*mistaken*. A stored flag supplies it; recomputing the number cannot.

The register shows a **manual** chip with the default in its tooltip; the Excel export carries
a **"Gross source"** column reading `manual (default 210)` or `default` — a column rather than
a symbol, because a spreadsheet is sorted, filtered and re-read by people who never saw the
screen.

### Fresh only

`grossLitersManual` is never set for Used oil. Used has no default to override — its gross is
measured every time — so a flag there would mark every row and mean nothing. A marker that
fires on everything is not a marker.

Nor is it set when the typed value *equals* the default: typing 210 back is agreeing with the
default, not overriding it, and it restores the recompute-on-barrels-change behaviour.

### Details that would have bitten

- **`isValidOilTransaction` would NOT have rejected the new field.** The premise for checking
  was right but the mechanism was not: that validator *names* fields and has no
  `keys().hasOnly(...)`, so an unnamed field passes silently. F75 was a **type** mismatch on a
  **named** field — `serverTimestamp()` resolving to `timestamp` against a clause reading
  `is number || is string` — not an unknown-field rejection. The clause was added anyway: an
  unvalidated field is a gap, since nothing bounds its type or size.
- **`isManualGross` is computed once and used by both writes.** A flag set on create and
  forgotten on update is how a corrected row loses its marker and starts reading as a typo
  again — the one-call-site-guarded shape of F73, F81, F82.
- **The edit path already loaded the stored gross** (`handleEdit`, not the line reported), so
  no recomputation bug existed there. It now loads the flag too — and the compiler caught the
  omission, because the form-state type made the field required.
- **`FRESH_LITRES_PER_BARREL` is module scope**, so the number appears once instead of in the
  four places that were drifting apart: initial state, cancel-reset, and the two recompute
  handlers.

### Deferred, not missing

**A "why was the barrel short" note field was considered and declined.** It is a different
requirement from "was this figure typed": the flag answers whether a reader should trust the
number, the note answers what happened. An optional free-text field would be blank on the vast
majority of rows, and a field that is usually empty trains people to skip it — including on the
rows where it would have mattered. If the reason needs capturing, `remarks` on the transaction
is the better shape and should be decided on its own terms, not smuggled in behind this.

---

## F98. A bug report describing the open dropdown, not the layout

The sidebar tender control was reported as rendering a cramped stack:

```
Tender
AT 2028-09
AT 2026_27
All tenders — viewing only
Open to new work
```

**A collapsed native `<select>` can only ever show one option.** Two different AT numbers and
the all-tenders option cannot appear at once, so that is not a layout — it is the **open
dropdown overlaying the card**, with the label above and the state caption below still visible
around it.

Collapsed, it rendered three lines: label, selected option, state caption.

### What was actually wrong

```jsx
className="mt-0.5 w-full bg-transparent text-xs font-bold outline-none cursor-pointer"
```

**No background, no border, no chevron, no padding** — and text weight nearly identical to the
9px caption beneath it. The three lines read as one block of static text, and nothing said the
middle one could be clicked. The alternatives *were* already behind the dropdown, exactly as
the requirement asked; they only looked printed in the card because the control gave the OS
option list nothing to sit against.

**The symptom and the cause were in different places**, which is why the first proposed fix —
move the control to the top bar — would have relocated the problem intact. A borderless select
in a header reads as static text just as well as one in a sidebar.

The general form, and the reason this is worth an entry: **a description of what a screen looks
like is a description of a moment, and interactive controls have more than one.** "It renders
as a stack" was true of the instant the reporter was looking at. Reconstructing which state
that was is part of diagnosing it, and here it inverted the fix.

### The restyle

Same `<select>`, same values, same `setActiveAtMasterId` — no behaviour change. It now has a
field background, a border, padding, a focus ring, and the **same `ChevronsUpDown` glyph the
agency switcher uses**, deliberately: both controls choose the scope you work in, and a
different visual treatment made the tender read as a lesser setting than the agency rather
than its peer.

The state moved from a body-text line beneath the value to a **dot-and-word chip on the label
row** — `● Open`, `● Closed`, `● All tenders` — because "can I book against this?" is a
property of the tender, not a third equal row. The full `gate.reason` moved to `title`.

### The native control was kept, and the limit accepted

A custom popover could style the option list too. It would also have to re-earn keyboard
behaviour and the mobile picker, which the native element provides for free — not a trade worth
making for a styling problem. **The open list is drawn by the OS and is not stylable. That is
accepted and recorded, not worked around.**

### A latent fault found while restyling

The block used fixed light-on-dark colours — `text-emerald-200`, `text-amber-300` — with no
reference to `isLight`, while every sibling element in the sidebar is theme-aware. On a light
sidebar the tender name was close to invisible. **A restyle that preserved the palette would
have preserved that**, so both the control and the no-tender branch are now theme-aware.

---

## F99. Three screens, five fetches — and why the count matters

The tender filter reached six screens. External Inspection, Internal Inspection and Testing
Report were excluded on the grounds that **they create nothing** — true, and beside the point:
they *list pending work*, and that list was agency-scoped. An operator on AT 27-28 saw 26-27's
pending inspections.

### The count was three screens and five fetches

**Both inspection screens fetch jobs twice** — once on mount, once in the save path to refresh
after a batch commit. Only the mount fetch is visible from the top of the file.

| screen | mount | save-path refresh |
|---|---|---|
| ExternalInspection | `:101` | **`:550`** |
| InternalInspection | `:75` | **`:573`** |
| TestingReport | `:97` | — (refetches via an effect on `isFormOpen`) |

**Fixing the three obvious fetches and missing the two in the save paths would have produced a
list that is correct on load and wrong after a save** — the intermittent version of the bug.
That version is strictly harder to deal with than the original: it is harder to reproduce,
harder to describe, and it presents as a refresh problem, which invites the wrong fix
(re-query, add a key, force a remount) and can be dismissed as flakiness. The original bug at
least fails the same way every time.

This is the second time in this file that a save path has been the copy nobody looked at —
see F45, where inspections were denied on create and worked on edit, and it "looked
intermittent rather than broken".

### The structural fix removes the possibility, rather than fixing both sites

**The scope is applied where the list is BUILT, not on the queries.** Both fetches still read
agency-wide and both call `setJobs`; a single derived `scopedJobs` filters what the screen
renders. There is one place to get right and no second site to forget — a *count* of one
instead of a discipline of two.

It also pays for the note below from the same read: the one agency-wide fetch answers both
"what is in scope" and "how much is not", instead of a scoped query plus a second agency-wide
one that could disagree.

`matchesAtScope(row, at, viewingAll)` is declared **beside** `atClause` in `AgencyContext`, and
that adjacency is the point: two expressions of one rule that can drift is exactly F87, where a
JavaScript `?? ''` guard and a Firestore `== ''` clause were assumed to agree and did not. Both
handle the same three states, and a change to one is a change to the other.

### The note

A correct filter that makes work vanish with nothing explaining where it went **reads as data
loss**. An operator whose 26-27 inspections have disappeared cannot tell "filtered" from
"gone", and the second reading is the one that prompts re-entering the job.

`OtherTenderNote` names the remedy rather than only the fact: *"3 pending external inspections
belong to other tenders — switch tender in the sidebar to work on them."* Shown only when the
count is non-zero, and never in all-tenders mode — there is no elsewhere when the scope is
everywhere. Same reasoning as the MR Ledger's unassigned backlog banner (F82, F87).

### Two optional-chained writes, worse than the queries they resembled

`activeAgency?.id` appeared in four places across the two inspection screens. Two were query
clauses — `where('agencyId','==', undefined)`, which matches nothing and returns an empty list
rather than failing. **The other two were WRITES**: `agencyId: activeAgency?.id` inside an
inspection payload, where `undefined` is dropped by Firestore, producing **an inspection with
no `agencyId` at all** — invisible to every agency-scoped query, and indistinguishable from the
pre-backfill records the surrounding comment was about.

That is the empty-string-`atId` shape (F87) arriving on the write side: a value that silently
means *belongs to nothing* instead of failing. All four normalised.

⚠ **And the first comment written for the fix was wrong.** It said the enclosing handler
returns when there is no active agency; it does not — the *component* returns early, so the
form cannot be on screen without one. Corrected to name the real guard, because a comment
asserting the wrong protection is what lets someone remove the right one. That is the fourth
time this session a comment written alongside the code claimed behaviour the code did not have
(F87, F88, F92).

---

## G1. The restraint was a `where` clause, not a boundary

`isSuperAdmin()` appeared in **every** `allow create`, `update` and `delete` on `jobs`,
`inspections`, `agencies`, `atMasters` and `oilTransactions`. O32 recorded this and drew the
right conclusion about not exposing it in the UI; what it did not do was close it.

**Nothing in the app reached it** — `AgencyContext` loads `where('ownerId','==',uid)`, so no
screen could target another account's document. **That is a client-side convention.** A
super-admin session with a browser console could write any record on any account, and
`scripts/seed-agencies-from-public-config.js` is already write-capable in exactly that shape.

This is not hypothetical. Live data holds three owners:

```
bhagwatielectricals20@gmail.com  → IDEAL ENGINEERING COMPANY
utparekh007@gmail.com            → MEGHA, suchit, DRISHIV, AARATI TRANSFORMER
shivaminfotech89@gmail.com       → ADMIN, UPENDRA          ← the vendor / super admin
```

**Two paying customers' records sat behind a `where` clause.**

### What was removed

`isSuperAdmin()` from create, update and delete on all five. `allow get, list` **keeps** it —
diagnosing a customer's problem requires reading their state; authoring their records does not
follow from it. The vendor-owned collections (`published_ats`, `public_config`,
`system_config`, `user_roles`, `support_tickets`) are untouched and correctly still require it.

Two powers were found in the sweep that were not in the original scope:

1. **`allow create`** permitted authoring a document *owned by someone else* — the same
   liability from the other end. Nothing writes an `ownerId` other than the signed-in uid.
2. **The agencies `ownerId`-immutability clause** —
   `(incoming().ownerId == existing().ownerId || isSuperAdmin() || ...)` — reads like a
   permission check and was in fact an **ownership-transfer capability**. No path in the app
   performs a transfer. `ownerId` is now immutable.

### The check that made it safe

Removing `isSuperAdmin()` leaves `existing().ownerId == request.auth.uid` as the only route,
so **any document lacking an `ownerId` would become unwritable by everyone.** Verified before
deploying: agencies 7, jobs 55, inspections 103, atMasters 7, oilTransactions 1 — **zero
without one.** Nothing was orphaned.

Confirmed unaffected: the admin scripts (`scripts/admin/_db.js` initialises `firebase-admin`,
which bypasses rules entirely) and the `deleteIfEmpty` Cloud Function (`functions/index.js`
uses the same SDK, so its `ref.delete()` never depended on the `atMasters` delete rule — which
is `if false` regardless).

### The one thing that broke, and why that was the moment to do it

`AdminPanel.handleUpdateSubscription` called `updateAgency` against `allAgencies` — an
**unfiltered** read of every agency on every account — so it wrote to customers' documents.
It is the only app-side dependency that existed.

**It wrote fields nothing reads** (O34), so the tightening broke a decoration. Subscription
being deferred until the Razorpay work is what freed the ordering: subscription was the sole
legitimate reason for cross-account write, and deferring it meant the rules could be tightened
*first* and the feature built against them later.

The controls are now inert and labelled *"Deferred until Razorpay"*, with the reason in a
tooltip — **a control that fails loudly against a permission deliberately removed reads as a
bug to whoever meets it next.** The writer itself was deleted rather than commented out, and
`updateAgency` was removed from AdminPanel's destructure entirely: on a screen whose agency
list is unfiltered by construction, any writer in scope is a cross-account write one call site
from being reused.

### The rule this leaves

**When subscription is built, it belongs in a vendor-owned collection keyed by agency id —
never as fields on the agency document.** That is what lets the vendor hold its own commercial
data without holding write access to the customer's records. Putting it on the agency is what
dragged blanket write permission along with it in the first place.

And the general form: **"we won't build it" is not a control.** A capability that exists in the
rules exists, whatever the UI chooses to reach. The audit had recorded the reasoning for a year
of not exposing it; the reasoning was sound and the door was open the whole time.

---

## G2. A fallback nobody could reach, and one nobody had guarded

Three creation paths write `atId`. Two carried a fallback that was **unreachable**, and one
carried a fallback that was **live**.

| path | stamp | guarded by |
|---|---|---|
| NewJob save | `activeAtMaster ? activeAtMaster.id : ''` | setup-gap dialog returns first — dead branch |
| OilInward new entry | `activeAtMaster?.id \|\| ''` | intake gate **in the handler** returns first — dead branch |
| **MrLedger `handleSaveFullMr`** | `ids.length === 1 ? ids[0] : (activeAtMaster ? … : '')` | **nothing** |

`handleSaveFullMr` creates jobs for rows added during an MR edit. Its guards checked the MR
number, the job count, job numbers and kVA — **no AT check**. The only `atForEditingMr()` call
in the function ran *after* `batch.commit()`, to advance a counter.

So it could write an unassigned job two ways: the MR's jobs disagree or carry no AT, and
`activeAtMaster` is null — which includes **"All tenders"**, a scope the MR Ledger renders in
and this path never consulted.

### The wrong-tender case is worse than the empty one

An empty `atId` is **findable**: the unassigned backlog shows it, every census counts it, and
`hasTender` now refuses it at the rules. A job stamped with **today's** tender on another
tender's MR **looks correct everywhere** — and prices from the wrong rate schedule and the
wrong AT percentage, which is the failure F72 exists to prevent.

`atForEditingMr`'s own error text had said this all along: *"would have to take its job number
and AT percentage from whichever AT is selected today, which may not be the tender this MR
belongs to."* The function that produced the error was called by the button and not by the
save.

**Fixed:** `handleSaveFullMr` resolves the MR's AT before anything is written and refuses with
that same message. `activeAtMaster` no longer appears in the expression at all — there is no
fallback left for a later edit to widen back into one.

### Both dead fallbacks deleted anyway

Unreachable-today is not a reason to keep the pattern that produced the twelve unassigned
jobs. A dead `: ''` reads as **the sanctioned way to write this field**, and the next call
site copies the shape, not the guard. Both are now `activeAtMaster!.id`.

### The rules backstop, and what it cannot do

`hasTender()` on **create only** for `jobs` and `oilTransactions`. Create-only is the whole
design: every record predating tender stamping has `atId` absent, and requiring it on update
would make those documents unwritable by their own owner — the trap G1's `ownerId` check
avoided.

It stops an **empty** stamp and not a **wrong** one, because rules cannot read another
collection to ask whether the id is one of this agency's tenders. And it surfaces as
`permission-denied` mid-batch, which tells an operator nothing. **It is what survives a future
call site that forgets the refusals; it is not the refusal.**

---

## G3. Guarded control, unguarded handler — a sweep, not a fix

`handleSaveFullMr` was found guarded on its button and unguarded in its handler. That is the
fourth instance of the shape this session, so the response was a sweep.

| site | control | handler | before |
|---|---|---|---|
| OilInward new entry | hidden on `intakeGate.open` | **also checks** | ✅ already right — its comment says *"the gate is in the handler, not only on the button"* |
| MrLedger add-unit | hidden on `intakeGate.open` | checked `atForEditingMr` — a **different question** | ⚠️ fixed |
| NewJob save | whole form replaced by a refusal screen | **no gate check at all** | ⚠️ fixed |
| MrLedger `handleSaveFullMr` | — | no AT check | fixed at G2 |

**MrLedger's add-unit is the sharp one.** Its handler *did* have a guard, so it read as
guarded — but `atForEditingMr` answers "do this MR's jobs agree on a tender?", not "does that
tender still accept new work?". The F83 intake rule was enforced by a `{intakeGate.open ? …}`
in the JSX and by nothing else. **A guard that answers an adjacent question is worse than no
guard: it makes the function look protected.**

NewJob's is unreachable today — the form is replaced 600 lines away — and was fixed anyway.
A rule enforced by the UI is enforced until someone changes the UI, and a reader inspecting
the save saw no rule, which is exactly how `handleSaveFullMr` came to exist.

### The delete guard, and one shared definition

`handleSaveFullMr`'s row-removal loop deleted jobs with **no check for an issued document** —
O33's third gap, in the site O33 does not name. A job carrying a bill, a payment or a challan
was destroyed by taking its row out of a form, and `issuedByAgencyId` lives on that document
(O14), so the delete removes the only record of what was billed, to whom, and by which agency.

**Two of the three jobs kept in F91 are exactly this shape**, including MSBT-12 / MR 1 with
BILL/1, ₹6,680 paid and a challan — C3's only evidence.

⚠ **`scripts/admin/delete-unassigned.js` has refused this since it was written.** A script
guarding what the UI did freely, for as long as both existed. The test now lives once, in
`src/lib/issuedDocuments.js` — plain `.js` so Vite and Node import the **same file** (the
project sets `allowJs` and `"type": "module"`). A guard that agrees with its script only by
coincidence is the F87 shape applied to a rule instead of a number.

Verified after extraction: the script still refuses the same three jobs.

---

## G4. Inspections are reachable by `jobId` and by nothing else

The delete guard does **not** address orphaning, and the two questions are genuinely separate:
the guard decides *whether a job may be deleted*, orphaning is *what happens to its
inspections when one legitimately is*.

The answer turned on how reachable an orphan is. `inspectionFor` matches four ways, one of
them `(i.mrNo === job.mrNo && i.jobNo === job.jobNo)`. Against live data:

```
inspections: 103
carrying mrNo : 0 / 103
carrying jobNo: 0 / 103
already orphaned by jobId: 0
```

**No inspection carries either field.** That branch of `inspectionFor` has never matched
anything and never can — a comparison against data the producing code does not emit, the
F44/F53 pattern, sitting in the linking function rather than in a price.

So an orphaned inspection is **completely unreachable**: `jobId` is the only link, and nothing
lists inspections independently. It is not recoverable evidence; it is dead weight that every
future census has to recognise and explain.

**Therefore cascading is right here**, and the reasoning is specific rather than general:
cascade is correct *because* the orphan cannot be reached. Had inspections carried `mrNo` —
as `inspectionFor` assumes — the opposite would follow: an orphan would still be findable by
MR, deleting it would destroy measured facts about a physical transformer (oil capacity, less
oil, winding damage), and re-creating a job with the same number would re-link it, which is
right for a typo correction and wrong for a different transformer.

### ⚠ The counterfactual, which is the part that does not generalise

**Cascade is right HERE BECAUSE the orphan cannot be reached.** The conclusion looks like a
principle — *delete the children with the parent* — and it is not one.

**Had inspections carried `mrNo`, as the matcher wrongly assumed, the opposite would follow:**
the orphan would still be findable by MR; deleting it would destroy measured facts about a
physical transformer — oil capacity, less oil, winding damage — recorded nowhere else; and
re-creating a job with the same number would re-link it, which is right for a typo correction
and wrong for a different transformer.

So the rule to carry forward is not *cascade*. It is: **an unreachable record is not evidence,
and a reachable one is.** Decide by asking what can still find the child, not by the shape of
the relationship. Anyone extending this to another collection has to re-answer that question
rather than cite this entry.

### What was built

**The dead branch was deleted, not repaired.** Populating `mrNo`/`jobNo` would have made it
work, which is the wrong fix: it creates a **second linking rule that can disagree with the
first**. A job renumbered or moved between MRs would match by one route and not the other, and
which answer you got would depend on which clause ran first. `jobId` is the link, it works,
and nothing needs a second route — one rule cannot disagree with itself.

**And the matcher existed seven times**, character-identical, in `oilBalance.ts`,
`BillingSystem` twice, `OilInward`, and three admin scripts. It decides whether an
inspection's measurements apply to a transformer, so a divergence changes an oil shortage on a
document sent to a division. One definition now lives in `src/lib/inspectionLink.js` — plain
`.js`, imported by Vite and by plain Node, the same arrangement `issuedDocuments.js` uses.
Verified figure-neutral: MEGHA +1365.60 and AARATI +112.00 unchanged across the consolidation.

**The cascade** deletes a removed job's inspections in the **same batch** — a separate write
could leave a job deleted with its inspections intact, which is the orphan state by another
route — and names the count first: *"will also delete N inspection record(s)"*. O33's
complaint about the other delete path was a dialog "that names the jobs and not the
inspections, and gives no count of what it leaves"; this one gives the count of what it takes.

A failed read of the inspections **aborts the save**. Committing job deletions without knowing
what they strand is precisely the outcome the guard exists to prevent.

Nothing is orphaned today — 0 of 103 — so this is prevention, not cleanup.

---

## G5. Showing the rate that applies, when only one of the two ever does

The Estimate Master's HV Bushing row printed **"Varies by KV rating"**. True, and useless:
it told the reader the cell had two answers without telling them either.

Confirmed with the operator: **every transformer these agencies repair is a distribution
transformer at 11 KV, across all DISCOMs. 22 KV does not arise in their work.** So one of the
two answers is the answer for every job they will ever enter, and the marker was withholding
it.

The row now shows **`176.00` with `(11 KV)` beneath it**, the same treatment the coil rows
already give the aluminium/copper pair (F52), and for the same reason: *show the figure that
applies, labelled with which it is.*

**The label is what keeps it honest.** `176.00 (11 KV)` states the rate and its condition; a
bare `176.00` would read as unconditional, and an agency that ever did 22 KV work would have
no signal that this is not their number. The tooltip says the tender also prices 22 KV and
that the estimate resolves it from the external inspection.

### ⚠ Display only. The calculation is untouched, and that boundary is the point

`inheritedKvRate` is consulted **nowhere in pricing**. `resolveRate` reads the schedule, not
this function. So:

- a job entered at **22 KV still resolves 8-B** (₹265), exactly as before;
- a **blank or unrecognised `kv` still blocks** rather than defaulting — F48 established that
  refusing to price 22 KV work would be wrong, and that a silent default is worse than a
  refusal.

This is the distinction between *what the grid shows an agency* and *what the tender permits*.
Narrowing the display to the case that occurs is a readability decision; narrowing the code
would be a correctness regression, and the note in `scheduleItemMap` — *"Anything other than
11 or 22 blocks rather than defaulting (F48)"* — still governs.

One implementation detail worth keeping: the 11 KV schedule row is looked up by **name**
(`options['11']`), not by position. An ordering change in the variant map would otherwise
silently relabel the figure — the class of fault this file keeps recording.

### The remaining marker, and why it is still right

**Radiator is the only one left.** Of the seven variant rows: HV Bushing now shows its figure;
the five winding-material rows show the AL/CU pair (F52); Radiator alone shows
*"Varies by capacity"*.

Its marker is **not merely defensible, it is load-bearing**. `inheritedScheduleRate` resolves
through `bandForKva`, and 200 and 500 KVA both fall in `B_ABOVE_100`, whose single value is
**1971.69**. Showing an inherited figure would therefore print **1971.69 in the 500 column,
where the tender's rate is 2630.06** — a wrong number in a cell an agency reads to check a
bill. The marker is not hiding a figure; it is refusing to print a false one.

Built at G6 — see below, including the check that decided whether it was safe.

---

## G6. The grid was asking the schedule a question it cannot answer

The Radiator row showed *"Varies by capacity"* in all ten columns. It now shows the tender's
rate in eight of them and keeps the marker on **315 KVA alone** — the one cell in the entire
grid where the tender genuinely has no answer.

### The question that decided it, and it had to be asked first

**Would the grid show a figure the estimate will not use?** If it showed 2630.06 for 500 KVA
while the estimate charged 1971.69, the display and the document would disagree — worse than
the marker, because an agency checking a bill against the rate table would find a discrepancy
that is not in the bill.

**They already agreed.** `SingleJobEstimateReport:624`:

```js
const radScheduleValue = kvaNum > 100 ? RADIATOR_ABOVE_100[kvaNum] : scheduleRate('20');
```

The estimate has **never** used the band value above 100 KVA. It has charged 2630.06 for a 500
KVA radiator all along.

### So the marker was not hiding an unknown — it was hiding a mismatch in the lookup

`inheritedScheduleRate` resolves through `bandForKva`; 200 and 500 both land in
`B_ABOVE_100`, whose single value is 1971.69. **The grid asked "what is the rate for this
BAND" where the estimate asks "what is the rate for this CAPACITY."** Two different questions
against the same schedule, and the marker was the symptom of the difference rather than of any
genuine variability.

This is the fourth time in this audit that a display and a calculation have read the same data
by different routes (F41/F55, F68, F81, F95). The distinguishing feature here is the outcome:
the marker meant nobody was ever shown a wrong number, so it surfaced as a *missing* figure
instead of a *false* one — which is why it survived so long and cost so little.

`inheritedRadiatorRate` now mirrors the estimate's expression against the same two sources, and
the docstring says the equivalence is the licence for showing anything at all.

### Verified per column, against what the estimate charges

```
kVA   grid shows   estimate charges   agree
5     (marker)     BLOCKS             yes     B5 rate is 0 — "not priced", not "free"
10-25 1052.00      1052.00            yes
50-63 1248.00      1248.00            yes
100   1446.00      1446.00            yes
200   1971.69      1971.69            yes
315   (marker)     BLOCKS             yes     not in the tender
500   2630.06      2630.06            yes     ← the band model cannot express this
```

### Why 315 keeps its marker

`RADIATOR_ABOVE_100[315]` is undefined, `resolveRate` returns null, and the estimate raises a
missing-rate error rather than interpolating between 200 and 500. **A figure in that cell would
be the exact falsehood the marker exists to prevent**, and it would be the more dangerous kind:
a plausible number, between two real ones, for a capacity nobody priced.

5 KVA renders no figure for the same reason in a different form — the schedule's B5 radiator
rate is 0, and `> 0` is the same test the estimate applies, so "not priced" does not become
"free".

**One marker remains in the whole grid, on the one cell where the tender has no answer.** That
is a better end state than a marker covering two cells that do have answers — and the figure
it withholds is genuinely absent rather than merely inconvenient to look up.

---

## G7. Two print faults: a budget that missed by 1.3 mm, and one CSS declaration causing three symptoms

Reference: RAVI ELECTRIC's estimate for job 21SRVOH-1 — **29 line items, header block, totals
and signatory on a single A4 sheet.** A real document an agency produces and reads.

### The estimate: not overflow, arithmetic

`layoutEstimatePages` is budget-driven. For a single page it computed

```
usable = contentMm − TABLE_HEAD 9.1 − PAGENUM 5 − SAFETY 4 − JOB_BOX 38.1 − (TOTALS 32.3 + SIGN 18.0)
```

A standard job is 29 items + 3 section headers = **153.9 mm** of rows.

| agency has | content | usable | needed | outcome |
|---|---|---|---|---|
| no letterhead | 259.1 | 152.6 | 153.9 | **short by 1.3 mm** — a third of one row |
| full-A4 letterhead | 235.0 | 128.5 | 153.9 | short by 25.4 mm |

**106.5 mm of fixed overhead — 41 % of the page — against a 1.3 mm shortfall.** The reference
carries the same information in roughly 70 mm. The whole difference was whitespace, and the
row height and font size were never the cause.

**Font size turned out to be free.** Item rows are `<tr class="h-4">` — a fixed 16 px height —
so `text-[8.5px]` → `text-[9.5px]` costs nothing in pagination. Legibility improved and the
budget did not move.

Recovered ≈ 18 mm: job box `leading-relaxed`→`leading-snug` and `p-2`→`p-1.5` (−7.8), signature
`mt-4 pt-3`→`mt-2 pt-2` (−3.2, of which 7.4 mm was *pure gap*), totals rows `p-1`→`py-0.5`
(−2.6), title `mb-2 pb-1`→`mb-1 pb-0.5` (−1.1), and **"Page 1 of 1" no longer printed or
charged** (−5).

```
no letterhead, usable 170.8 mm
  29 items  153.9  FITS   +16.9 mm spare
  32 items  168.3  FITS    +2.5 mm spare
  35 items  182.7  2 pages
```

**The 16.9 mm is left as spare, deliberately.** Spending it on larger text would buy one more
point of size once; leaving it means a job with a few extra line items still fits one page,
which is the more valuable property.

⚠ **The constants were updated with the CSS, and that is not optional.** `JOB_BOX_MM`,
`TOTALS_MM` and `SIGN_MM` *are* the budget. Leaving them describing blocks that no longer
exist would make the budget a fiction — the same defect as a comment asserting behaviour the
code does not have, which this session has recorded four times. They are derived from the CSS
deltas rather than re-measured on paper, and rounded **up**: over-reserving leaves a page
slightly empty, under-reserving clips content.

### The single-page relief is safe only because of where it is claimed

Not charging `PAGENUM_MM` on a one-page run is a budget relief that could, in principle, talk
the layout into a page it cannot then honour. It cannot here: `greedyFillToMax` calls
`usableMm` with `isLast=false` while deciding **how many** pages are needed, so the relief
never applies during the count — only after a run has turned out to be a single page, which is
exactly when the footer is not rendered.

### The letterhead case is bounded by the agency's own margins — but no longer silently

A full-A4 letterhead reserves `letterheadHeaderHeightMm + letterheadFooterHeightMm` — **38 + 24
= 62 mm of a 297 mm page** — for the agency's pre-printed stationery. 29 items still do not
fit, now by **7 mm** rather than 25 mm.

**Shrinking the text to fit someone's letterhead art is the wrong trade**: a rate table nobody
can read at arm's length is worse than a second page. But producing two pages with no
explanation leaves the operator assuming the document is simply long, when a setting they own
decides it. So the screen now names the cause, the magnitude and the remedy — *"prints on 2
pages because of the letterhead reservation… reserves 24 mm… short by about 7 mm… reduce
letterhead header/footer height in Agency Settings"* — and says explicitly that the text is not
being shrunk to fit.

**The notice is on screen only, never on the printed document**: it is a message to the
operator about a setting, not part of what the division receives. And it fires only when the
job *would* have fitted without the reservation — a genuinely long 35-item job paginates for
its own reasons and gets no notice, because changing the letterhead would not help it.

### The invoice: three symptoms, one declaration

```jsx
<div className="border-2 border-black text-black text-[10px] h-full flex flex-col justify-between">
```

`h-full` + `justify-between` with exactly **two** children — body and footer — so flexbox
pushed the footer to the bottom of the sheet. The "gap between the totals and the signature"
was not a gap; **it was the remainder of the page.** That one declaration produced all three
reported faults: the totals-to-signature gap, the empty space after the net total, and the
received-payment block and guarantee card landing at the page foot instead of following the
total.

**And two nested instances would have survived the fix.** Each footer half is also
`flex flex-col justify-between`, pushing `For, <agency>` to the bottom of its own cell — so the
signatory would still have floated even after the footer moved up. Fixing only the outer one
would have produced a partial improvement that looked like the change had not worked.

`h-full` is kept so the bordered box still reaches the bottom of the sheet; only the
distribution changed.

Invoice text: the `8 px` runs — amount in words, settlement line, bank row, guarantee text —
raised to `8.5 px`. The amount-in-words line is what a division reads to verify the figure and
was the smallest text on the document.

---

## G8. A fabricated document number on an issued page — found while deleting the page

The multi-job summary matrix — a side-by-side comparison sheet, items down and jobs across —
was removed as unwanted. 363 lines in `EstimateGenerate.tsx`, one of four estimate view modes,
inline rather than a component.

**Line 1614 of that block:**

```jsx
<p>NO : {Math.floor(Math.random() * 100) + 1}</p>
```

**A document number generated at render time, on a page that goes to a division.**

⚠ **It is not merely arbitrary — it is unstable.** It is computed during render, so it is
different every time the component renders: **two prints of the same estimate carry different
document numbers**, and a reprint of one already sent to a division would not match the copy
the division holds. A number that a recipient could use to refer to a document, that does not
survive being looked at twice.

This is the audit's plausible-value class at its sharpest. `NO : 47` is indistinguishable from
a real reference — it is short, it is an integer, it is in the position a document number
belongs. Nothing about it invites checking, and there is nothing to check it against.

### Recorded as found-and-removed, not fixed

**No fix was made, because the page it lives on no longer exists.** That is the honest
description and it matters: an entry saying "fixed" would imply a correct document number now
exists somewhere, and none does. If a matrix is ever wanted again it needs a real identifier —
stored, stable across reprints, and unique — which is a design question nobody has answered.

⚠ **It returns if the matrix is restored from history.** Whoever reinstates 363 lines from a
git history to bring a view mode back will not read line 1614; that is the nature of restoring
a block wholesale. A pointer now sits on the `estimateViewMode` declaration — the one line
anyone reinstating this must edit — naming this entry.

### What removal touched, and what it deliberately did not

`builderLineFor` had **two** callers: the Excel export and the matrix's item cells. That was
the F55 consolidation working — the export used to price items with `calculateJobItemDetails`
(called with no inspection data, so every optional item was charged on every job) while its
totals came from `buildSingleJobEstimateData`, so the sheet did not reconcile against itself.

**The export is now the only caller, and `builderLineFor` stays for it alone.** Three comments
that named "the printed matrix" as a caller were corrected in the same change — a comment
describing a caller that no longer exists is the defect this session has now recorded five
times. One of them now says explicitly that removing the export too would take the second half
of F55 with it.

The forwarding letter is independent: `renderForwardingLetterPages` builds its own job table
and total from `selectedJobsData` and never read the matrix. It stays, unchanged.

Also removed: the toggle button, its hint line, `'matrix'` from the union type, and the
`Layers` icon import that became unused.

### The estimate output after removal

```
batch_all (default)   Common Forwarding Letter  →  one estimate sheet per transformer
forwarding_only       Common Forwarding Letter
single_job            one estimate sheet
```

---

## G10. The MR Register as a table, and a `<div>` the parser would have moved

The register was a card list: one card per MR, six chips wrapping in a flex row, inside a
`max-w-6xl mx-auto` page container. It is now a nine-column table using the `ui.ts` vocabulary.

**Width was one class.** `max-w-6xl mx-auto` is 1152px centred, so on a 1920px workshop screen
~380px of gutter sat on each side while the register itself scrolled. `AppLayout`'s content
area imposes no width of its own, so the constraint was entirely local — the table was already
filling its card; the card was in a box.

**Nine columns, none hidden at any breakpoint** — MR No, MR Date, Division, Units, Type, Core,
Stage, Actions, plus the expander. The wrapper scrolls sideways. A register missing its middle
columns on a narrow screen is not a smaller register, it is a different and wrong one.

**Actions stay visible in their own column.** A hidden destructive action is worse than a wide
table, and cancelling an MR is frequent.

### ⚠ The finding: a `<div>` inside `<tbody>`

The expanded per-transformer panel was a `<div>`, which was correct while its parent was a
card. Inside a `<tbody>` it is **invalid DOM, and the parser does not error — it hoists the
element out of the table entirely.** The rows would have rendered and the panel would have
appeared somewhere else on the page.

**It typechecks. It lints. React says nothing.** `tsc` sees valid JSX, ESLint sees valid JSX,
and the only way to find it is to look at rendered output. It is now
`<tr><td colSpan={9}>`, matching the nine header columns.

Worth recording as its own class: **a container's validity is a property of its parent, not of
itself.** A `<div>` that was right for years becomes wrong the moment the thing above it
changes from a card to a `<tbody>`, and nothing in the toolchain notices — the same shape as a
comment that was true when written. Any card-to-table conversion has this hazard in it.

### The stage column, and why it costs a read

Stage uses `mrStageSummary(group.jobs, inspections)` — the shared definition every inspection
screen already uses — at the cost of one owner-scoped `inspections` read on this screen.

The alternative was deriving it from `job.status` alone, free. **That was rejected on F87
grounds:** a stage counted one way here and another way on the inspection screens is two
measurements of one quantity that nobody puts side by side, which is exactly how the backlog
banner reported 4 of 12 for a fortnight. One read is cheap against that.

`mrStageSummary` returns four `{complete, doneCount, total, date}` states and **no label**; the
label ("Int 4/17", "Dispatched") is composed at the call site from the first incomplete stage.
That is presentation over the shared definition, not a second definition of it. A failed read
leaves the list empty rather than rendering every MR as "not started", which would be a claim.

### Restyled, not weakened

The unassigned-work banner and the intake gate keep **every word, the count, the expander and
the list**. The only addition is a **dot** on each: the amber fill alone did not survive a
photocopy of this register, and colour is never the only signal.

### Presentation-only proof

```
getDocs 5→6 · where( 8→9        the one new inspections read, and its ownerId clause
writeBatch 4→4 · batch.delete 2→2 · batch.update 3→3 · batch.set 1→1
atForEditingMr 6→6 · issuedMarks 2→2 · inspectionsForJob 2→2
intakeGate.open 3→3 · alert( 8→8 · window.confirm 1→1
filteredGroups 5→5 · highWaterJobNos 2→2 · atClause 2→2 · isUnassigned 3→3
<th 9→18 · <td 9→19 · <tr 2→5 · <table 1→2      the new MR table
hidden *:table-cell : 0
```

Every guard, batch, delete, gate and confirmation is untouched.

---

## G11. An aggregate that takes the first job's value and prints it as the MR's

`MrLedger.fetchJobs` groups jobs by MR and seeds the group like this:

```js
groups[mrKey] = { mrNo, dateOfIssue, division: job.division, repairType: job.repairType || 'OGP', … }
```

**Whichever job is encountered first supplies `repairType` and `division` for the whole MR**,
and neither is revisited as the remaining jobs are pushed in. The register then prints that one
value as a chip, with nothing indicating it is a sample rather than a summary.

### Why this is materially wrong and not merely imprecise

**GP means repaired under guarantee, at no cost.** An MR holding one GP job among three OGP
ones would display a single **GP** chip — asserting free-of-cost repair for three transformers
that are chargeable. The reverse is as bad: a GP job hidden inside an MR chipped OGP invites a
charge for work already covered.

Division is the same shape with different consequences: it addresses the forwarding letter and
selects the job-number prefix.

### ⚠ Latent, not theoretical — and the census says which

`scripts/admin/mr-homogeneity.js`, read-only:

```
MRs examined             : 21
mixed repairType (GP/OGP): 0     ← the chip has never yet shown a wrong value
mixed division           : 0
mixed coreType           : 4     ← legitimate; one MR can hold several core types
```

**No MR in live data is mixed on repair type or division, so nothing has been displayed
wrongly.** The mechanism is wrong; the data has not yet exercised it. It would be wrong the
first time an operator adds a GP unit to an existing OGP MR — which the add-unit button
permits, and which nothing prevents.

The four core-type mixes are real and correct: `MR 9344` holds CRGO 13 · AMORPHOUS 3 ·
WOUND CORE 2, and those price from three different schedules.

### How it surfaced, which is the transferable part

**Nothing examining the data found this. A presentation change did.**

The restyle needed the value *per job* to build the Type and Core columns — and the moment the
aggregation had to be written out per job rather than read off the group, it showed itself. No
census was looking for it; no test would have caught it, because the output is a plausible
single value.

That is the inverse of the usual case in this file, where a defect is found by tracing a
value's provenance and the UI is where it surfaces. Here **the UI work was the instrument**:
asking "what should this cell contain?" forced the question "is there one answer?", which
nobody had asked of the group object in the years it had existed.

### The fix, and what it deliberately does not do

The row shows **counts, never a dominant value** — `OGP 3 · GP 1`, and just `OGP` when
uniform. Same reasoning as the per-division oil split (F86): *"an opening position of +40
SABARMATI, −30 KALOL is two facts, not one net of +10."* A "mostly OGP ⚠" chip puts one word
where two facts are, and the marker is exactly what an operator scanning forty rows does not
read.

⚠ **It does not silently correct.** A GP job sitting on an OGP MR may be a data fault rather
than a legitimate mix, and that is a question for someone with the paperwork. The row reports
what is there and decides nothing.

**`group.repairType` and `group.division` still exist and are still first-job-wins.** The
display no longer trusts them. The underlying fields are unchanged, because changing what they
mean is a logic change and this commit was presentation.

### ⚠⚠ It does not only DISPLAY the sampled value — the edit modal WRITES it

Found while checking what still reads those fields, and it escalates this entry from a display
fault to a data-corruption path:

```js
// handleSaveFullMr — both the update branch and the create branch
batch.update(docRef, { …, division: editingMr.division,
                          repairType: editingMr.repairType,
                          isGp: editingMr.repairType === 'GP', … });
```

`editingMr.repairType` is seeded from `group.repairType` — the first job's value. So **opening
an MR in Full Edit and pressing Save stamps every job on that MR with the first job's repair
type and division**, and sets `isGp` to match.

On a mixed MR that is not a wrong label; it is a **silent rewrite of the data**. A GP job among
OGP ones would be converted to OGP — losing the record that it was repaired under guarantee at
no cost — by an operator who opened the modal to fix a serial number and touched nothing else.
`isGp` is written from the same sampled value, so the derived flag is rewritten to agree with
the corruption.

The census keeps this latent: no MR is mixed today, so nothing has been overwritten. **But the
add-unit path permits adding a GP unit to an OGP MR, and the moment one exists, the next Full
Edit save destroys it.**

**The sequence is worth keeping on paper: a display bug, traced to its source, turned out to
share that source with a write.** Nothing was looking for the write; it was found by asking
what still read the field the display had stopped trusting.

### Fixed

`EditableJobEntry` now carries each job's own `division` and `repairType`, and both save
branches stamp per job:

```js
division:   j.division   ?? editingMr.division,
repairType: j.repairType ?? editingMr.repairType,
isGp:      (j.repairType ?? editingMr.repairType) === 'GP',
```

The fallback fires only for a row with no value of its own — a row the operator just added —
which is the one case where the MR-level control **is** the right source. Both branches use the
same expression so they cannot drift.

**The MR-level controls stay, and are now documented as read-not-written.** They cannot be
removed: `getJobNoPrefix(editingMr.division, …)` supplies the job-number prefix, the counter
advance is keyed on the same division, and `repairType === 'GP'` excludes a job from number
continuation. Removing them would break number allocation — which has been rebuilt three times.

### ⚠ Division was not the lesser of the two

Same mechanism, same write, different blast radius. `repairType` decides whether work is
charged — worse per job. But `division` decides the job-number prefix, the forwarding-letter
address, **and the per-division oil split (F86)**: a job silently moved to another division
takes its oil shortage with it, so the per-division opening balance the carry-forward records
is wrong — and that is a figure a DISCOM is settled against.

### The control question, and why it cannot be deferred indefinitely

The safe half is built: **nothing is ever overwritten silently.** But that leaves a specific
wrong of its own, and it is not a general open item.

**If an operator changes the Division dropdown meaning it to apply, it now applies only to new
rows.** The existing jobs stay on the old division while the MR header shows the new one — so
the screen asserts something the data does not say. That is the same class of fault as
everything else in this file, arriving from the opposite direction: before, the write agreed
with the header and corrupted the jobs; now the jobs are safe and the header can lie.

Two answers, both narrow:

1. **A checkbox — "apply to all N jobs".** Keeps the field editable and makes the blast radius
   explicit and counted. More UI, and it invites the operator to do the thing that was until
   now happening by accident.
2. **Read-only when the MR has jobs; editable only on the add path.** Smaller, and probably the
   honest answer: **an MR's division is a fact from the division's paperwork, not something the
   agency chooses.** The same argument applies to repair type — whether a transformer is under
   guarantee is a property of its history, not a field.

### ⚠ DECIDED, NOT OPEN: (2), read-only when the MR has jobs

**This is settled and should not be re-argued.** The operator's reasoning is the deciding one:
*an MR's division is a fact from the division's paperwork, not something the agency chooses* -
and the same holds for repair type, since whether a transformer is under guarantee is a
property of its history rather than a field.

**Deferred only for sequencing**, not for doubt: it changes what an operator can do, and
interleaving a behaviour change into a screen-by-screen restyle pass makes both harder to
review. It lands after the restyle.

Until then the safe half stands - nothing is overwritten silently - and the header-can-lie
window above is the accepted cost of waiting.

---

## G12. Oil Account restyled — the screen with the most recent work on it

Chosen as the second restyle for three reasons, and all three held: it exercises the token
vocabulary hardest (signed figures with direction words, a per-division breakdown, an
unassigned section, an all-tenders mode with two caveats, F88's opening lines); it carries the
highest density of recent work (F87, F88, F89, F95, F96, F97 all land here), so it is the real
test of *restyle, do not weaken*; and it is a clean file with a printed sibling, which lets the
diff-the-printed-subtree discipline be established on an easy case before `BillingSystem`,
where it is load-bearing.

**Two surfaces unified, two tables through `TABLE`/`TH`/`TD`** (16 `th`, 21 `td`), figures made
tabular, and the wrapper now scrolls with **no column hidden at any breakpoint**. The
transactions table has ten columns and the summary six; an operator reconciling oil against a
division needs every one of them.

### Three notices restyled, none reworded

The all-tenders scope panel, the unassigned-oil section and the intake gate refusal. **Every
word is unchanged** - they bound what the figures can be used for, and F89's second caveat in
particular is the one thing standing between this screen and a number quoted to a division.

Each gained a **dot**. The panel fill alone did not survive a photocopy of this register, and
colour is never the only signal.

### The proof

```
getDocs 4→4 · where( 6→6 · addDoc 2→2 · updateDoc 2→2
isUnassigned 6→6 · describeOil 14→14 · intakeGate.open 2→2
viewingAllTenders 13→13 · openingForFilter 5→5 · showOpeningLines 6→6
grossLitersManual 16→16 · defaultGrossFor 7→7 · isManualGross 3→3
openingIncomplete 8→8 · alert( 1→1

<th 18→18 · <td 36→36 · <table 2→2 · hidden *:table-cell 0→0
```

Wording verified phrase by phrase rather than by eye: *"belong to no tender"*, *"No new oil
entries:"*, *"Approximate"*, *"Opening balances are excluded"*, *"recorded history, not the
division"*, *"Reconcile against"* - each 1 → 1.

**The printed sibling is untouched.** `BillingSystem.tsx` holds both the tax invoice and the
oil account SHEET; `OilInward.tsx` holds only the screen. `git status` shows no modification to
`BillingSystem.tsx`, `SingleJobEstimateReport.tsx` or `LetterheadHeader.tsx` - so the diff
discipline had nothing to diff, which is exactly the easy case it was worth proving on first.

---

## G13. Two vocabularies on one screen, and how the boundary was made structural

Dispatch Challan was chosen as the third restyle because it is the first screen where the token
vocabulary has to sit **beside** a contrast-committed set without absorbing it.

### The printed subtree was proved unchanged, not asserted

The delivery challan lives in this file, between `<PrintableA4Page>` and `</PrintableA4Page>`.
It was snapshotted before any edit and re-hashed after each of three:

```
before  297e2504eb580704e3897b02b7afbbc9
after   297e2504eb580704e3897b02b7afbbc9      (three times)
```

⚠ **The method matters more than the hash.** The edit script splits the file at the
`PrintableA4Page` boundary, edits only the text above it, and re-attaches the printed subtree
**verbatim**. It is structurally incapable of touching the document, rather than merely
careful about it - and the hash then confirms what the structure already guarantees. A
discipline that depends on remembering is not a discipline.

### The exclusion, documented where someone would tidy it

`bg-amber-50/60` for a scrap row, `bg-blue-50` and `bg-rose-100/80` for selected rows, and
`bg-blue-600` / `bg-rose-600` for their checkboxes are untouched. Verified rather than
intended: each string is 1:1 against HEAD, and `isScrap` (30) and `isSelected` (7) are
unchanged.

**Four states overlap in these rows** - scrap, selected, selected-scrap, and GP brown text
(`#5B3A1A`, GP_TEXT_CLASS) - and the pairing was measured, not chosen.

⚠ **The comment sits at the row states, not in a header.** That is deliberate: a note about
"do not tidy these" is only useful where the tidying would happen. It says that `TONE.warn` is
a **different** amber and `TONE.bad` a **different** rose, so a substitution would look like a
cleanup while silently re-opening a measurement, and it points back at ui.ts's exclusion list.

**This is the shape the restyle pass needs to survive at scale:** the tokens are for chrome,
and a measured colour is data. The screen now carries both, and the boundary is written at the
line where the two meet rather than in a document nobody opens.

### What did not move

```
sort( 8→8 · testingDate 4→4 · challanNo 43→43 · coreType 6→6
GpChip 5→5 · matchesGpFilter 10→10 · selectedJobIds 18→18 · handleToggleJob 2→2
<th 33→33 · <td 31→31 · <table 3→3 · min-w-[ 2→2 · hidden *:table-cell 0→0
```

The pending list's test-date sort, the dispatched list's challan numbers and the core-type and
GP/OGP columns are intact. **The two `min-w-[…]` values were deliberately preserved** when the
tables moved to `TABLE`: they are what stops a column being squeezed out rather than scrolled
to, and dropping them would have satisfied the "no hidden columns" rule while breaking the
thing the rule exists to protect.

---

## G14. Four printed documents in one file, and the check that had to be positive

Billing System is where the split-and-reattach discipline stops being a formality. The tax
invoice was fitted to a single page against the Ravi Electric reference (F97/G7), and it does
not ship alone.

**There are FOUR printed documents in this file, not two:**

```
forwarding    lines 2813-2884   e85a73859da6ee375c61d4e04758f9fd   IDENTICAL
certificate   lines 2887-2916   072daf7678ea0e63b236b2b22c8919d5   IDENTICAL
TAX_INVOICE   lines 2919-3147   1ddc4fef971153d12da0dbcb5e1fc257   IDENTICAL
OIL_SHEET     lines 3150-3299   0f9e2222d2d1acc1c078a2f1bbd46315   IDENTICAL
```

A forwarding letter and a certificate ship alongside the invoice and the oil account sheet. The
survey found them because the script enumerates `<PrintableA4Page>` boundaries rather than
looking for the documents it expects - **the count was an output, not an assumption.** Had it
been written against "the invoice and the oil sheet", two documents would have been silently
in the editable region.

### The negative check that had to be made positive

The G7 invoice fix removed `justify-between` in three places so the signatory sits under the
totals rather than at the page foot. **A restyle that reintroduced a flex utility there would
undo it silently** - and "silently" is the whole problem, because the symptom is a gap on a
printed page that nobody looks at until a division does.

Confirming "the hash would catch it" is not enough on its own: it is only true if all three
removals are inside the hashed block. So it was checked **positively**, by asserting the
absence of the utility on each of the three specific elements:

```
outer container has NO justify-between : True
left footer cell  has NO justify-between: True
right footer cell has NO justify-between: True
```

All three live at lines 2931, 3111 and 3129 - inside 2919-3147. So the hash does cover them,
and that is now a fact on the record rather than an inference.

⚠ **Five `justify-between` remain inside the invoice and are correct.** They distribute within
the invoice's own header boxes, not between the totals and the signatory. A future sweep that
removed them "for consistency with G7" would break the header - the fix was never "remove
justify-between from the invoice", it was "the footer must follow the totals".

### What did not move

```
billTypeFilter 24→24 · paidAmount 17→17 · paymentStatus 11→11
blockIfMasterMisfiled 3→3 · GP 15→15 · billable 15→15
<th 53→53 · <td 65→65 · <table 6→6 · min-w-[ 8→8 · hidden *:table-cell 0→0
getDocs 4→4 · where( 5→5 · writeBatch 4→4
```

The scrap/repairable bill separation, the GP exclusion and its reconciling count, and payment
recording are intact. All eight `min-w-[…]` preserved, for the reason given at G13: they are
what stops a column being squeezed out rather than scrolled to.

Restyled: 12 card surfaces, 5 filled-pill shadows, 2 radii, 25 figures made tabular. The two
coloured summary cards became left-accent tints rather than white cards with a full coloured
border, matching the vocabulary.

---

## G15. Reports, and the one thing in this pass that was added rather than re-expressed

A clean file - no `PrintableA4Page`, asserted by the edit script rather than checked by eye, so
a document appearing here later would stop the restyle instead of being quietly edited.

Restyled: eight identical stat cards, the tab shell, five selected-tab shadows, twelve header
cells through `TH`, fourteen figures made tabular. The AT-scoped filter, per-job pricing,
scrap-charge resolution, GP display and the Excel export are untouched:

```
<th 13→13 · <td 12→12 · <table 1→1 · getDocs 3→3 · where( 3→3
atClause 2→2 · atForJob 3→3 · getJobFullEstimate 2→2 · resolveScrapCharge 2→2
matchesGpFilter 4→4 · GpChip 2→2 · sort( 3→3 · XLSX 5→5 · hidden *:table-cell 0→0
```

### ⚠ THE EXCEPTION: `min-w-[1100px]` was ADDED, not re-expressed

**Every other change in this restyle pass re-expresses something that was already there.** This
one is not, and it is recorded here so it does not read as scope creep to whoever reviews the
diff.

Reports' table has **twelve columns and no minimum width**. The wrapper was already
`overflow-x-auto`, so no column was hidden - and that is exactly what made it easy to miss:
**the "hide no column" rule was satisfied while the thing the rule exists for was defeated.**
With no minimum the columns compress and wrap, so on a narrow screen the operator still cannot
read the row. Several columns carry two facts each - "MR No & Date", "Capacity & Make",
"Estimate & Billing" - so compression bites harder here than on a plain table.

Dispatch and Billing already carry `min-w` for precisely this reason; this table had none. The
addition brings it into line rather than inventing a treatment.

**It is still a behaviour change at narrow widths**, not a re-skin, and calling it one would be
wrong. The general form is worth keeping: **a rule stated as a prohibition ("do not hide
columns") can be honoured to the letter by a layout that fails its purpose.** The prohibition
was the wrong shape; the requirement is "the operator can read the whole row", and the min-w
is what actually delivers it.

---

## G16. Two kinds of excluded colour, and only one of them is detectable

External, Internal and Testing restyled as a group - they share a toolbar and a shape. Each
holds one printed report, sliced at the `PrintableA4Page` boundary and re-attached verbatim:

```
ExternalInspection   752-889    8f40d56867052c5d9ff84ea2594919a5   IDENTICAL
InternalInspection   892-1039   3db3b79c1b4b53d9bade84d951f3e6f5   IDENTICAL
TestingReport        476-601    cc30c5afa9acc7bf49a47aef0893b8a6   IDENTICAL
```

Small diffs by design - these screens are mostly form and table, and most of the table cells
live inside the printed reports.

### ⚠ THE FINDING: the exclusion list had two kinds in it, and did not say so

`ui.ts` named three excluded colour sets - GP brown, the tender state chip, the Dispatch
scrap/selected tints. All three are excluded because **they were MEASURED**: contrast-checked
against specific backgrounds, so a substitution fails a contrast check and an automated audit
would eventually catch it.

**The circle-limit indicator is excluded for a completely different reason, and it is the
reason that cannot be automated.**

`renderCircleLimitIndicator` uses three visual states to make three different statements about
what the operator should do next:

| state | says |
|---|---|
| `text-slate-400 italic` | *nothing to do here* — a fixed-rate job, or a missing **rate**, which is not this operator's action |
| `text-amber-700 italic` | ***your* next action** — a field on the row in front of them is blank |
| `text-slate-500 italic underline` | *this is a clickable setup gap* |

The code states the rule outright: **"grey reads as 'nothing to do here', which is the opposite
of the case."**

Four branches produce seven distinct messages, and **F79 established that the wording
distinguishes an unentered field from an unconfigured rate** — sending an operator to the
Estimate Master to fix a field on the bench in front of them was a real failure, not a
hypothetical one.

**Flattening these into `chip('warn')` would look like a tidy-up. It would pass every contrast
check, every lint and every type check, and it would silently merge "you can fix this" with
"someone else must configure this."**

### The distinction, which is the transferable part

- **Contrast-committed**: the colour was measured. Breaking it fails a *measurable* property.
  A tool can find it.
- **Meaning-committed**: the colour carries a distinction in what it *says*. Breaking it fails
  nothing measurable at all. **No tool will ever find it.**

A design system's exclusion list therefore cannot be one list. The second kind needs its reason
written next to it, because the only thing standing between it and a well-intentioned cleanup
is a person reading a sentence.

Recorded as set 4 in `ui.ts`'s exclusion block — the place someone looks before restyling —
with the two kinds separated and the tell for each stated.

### Verified rather than intended

Seven messages, both semantic colour states and the underline are each confirmed present after
the edit. Across all three files: `<th>`, `<td>`, `<table>`, `getDocs`, `where(`, `writeBatch`,
`batch.set`, `OtherTenderNote`, `otherTenderPending`, `scopedJobs`, `matchesAtScope`,
`missing.push` (blank-save validation), the stage helpers, `min-w-[`, `hidden *:table-cell` —
every count equal, and the other-tenders notice wording identical.

---

## G17. Two printed boundaries of different kinds, and one of them is not a hash

Estimate Generator, plus Admin Panel and Support Desk folded in - two clean files needing no
record of their own beyond this line: eleven card surfaces routed through `CARD`, two gradient
banners flattened, eight radii, four figures tabular, and the G1 *"Deferred until Razorpay"*
label intact. Every logic count equal.

### The two boundaries are not the same kind of thing

**1. IN-FILE - the forwarding letter.** Sliced at `<PrintableA4Page>`, re-attached verbatim,
hash confirms it:

```
lines 938-1058   4b81c11aa8fb93208ba8488bafae3337   IDENTICAL
```

**2. CROSS-FILE - the estimate sheet.** `<SingleJobEstimateReport>` is *rendered* from this
screen but *lives* in another file. Hashed too:

```
WHOLE FILE       f0e63ea5869f9957f2ea54c94e2065bf   IDENTICAL
  printed block 1  lines 1163-1335   ebdd466c49ee02985e02cd79047f9b87
  printed block 2  lines 1385-1566   b7b0ccd033a085f749e1d3a3b6f0b132
```

⚠ **But the hash is not what protects it, and saying so matters.** The edit script never opens
that file - the guarantee is the file boundary itself, which is stronger than any check applied
after the fact. The hash confirms what the structure already made true.

**The distinction is worth keeping because the two fail differently.** An in-file boundary is
maintained by discipline and needs the hash: one careless global replace reaches across it. A
cross-file boundary is maintained by the filesystem and cannot be crossed by accident - but it
is also *invisible*, so a reader of this diff would have no reason to know a printed document
was in play at all. **The hash on boundary 2 exists to document a risk, not to catch one.**

### The ~16mm spare, checked positively

G7 fitted the estimate sheet to one A4 page with about 16mm to spare. That margin lives in
constants, not in the JSX, so the file hash alone would not say whether the *figures* survived.
Checked by name:

```
JOB_BOX_MM = 30.5 · TOTALS_MM = 29.7 · SIGN_MM = 15.0 · ROW_MM = 4.8
FALLBACK_CONTENT_MM = 259.1 · text-[9.5px] · const singlePage = isFirst && isLast;
```

All present. The last is the single-page relief that makes 29 items fit; the `9.5px` is the
table size that was raised because row height is fixed.

### The G8 pointer, and a check that had to be two-sided

The `estimateViewMode` declaration carries the note naming G8 - **the only thing a person
reinstating the matrix from git history cannot avoid reading.** It is untouched:

```
'matrix' IS GONE AND SHOULD NOT COME BACK (AUDIT G8)              present
useState<'batch_all' | 'forwarding_only' | 'single_job'>(…)       present
Math.floor(Math.random() * 100) + 1                               present   ← as TEXT
estimateViewMode === 'matrix'                                     0 matches ← as CODE
```

⚠ **The last two lines are one check, and it needs both halves.** The fabricated document
number must be **present as quoted text** inside the warning - that is the whole point of the
pointer - and **absent as code**. Grepping for it alone would have looked like the matrix was
back; grepping for its absence alone would have silently permitted deleting the warning that
explains why it must not return.

### Presentation-only proof

```
<th 32→32 · <td 34→34 · <table 4→4 · getDocs 3→3 · where( 3→3 · atClause 2→2
builderLineFor 4→4 · buildSingleJobEstimateData 3→3 · renderForwardingLetterPages 3→3
estimateViewMode 11→11 · XLSX 13→13 · triggerUniversalPrint 3→3
setupGap 2→2 · blockIfMasterMisfiled 2→2 · hidden *:table-cell 0→0
```

`builderLineFor` still has its one Excel-export caller (G8), and `git status` shows
`SingleJobEstimateReport.tsx` unmodified.

---

## G18. Exclusion from restyling is not the same as being well-built

The carried-balance badge on a tender card sets a standard the other meaning-committed sets
should be measured against, and it was not noticed until three of them had been catalogued:

```jsx
short ? 'text-amber-900 bg-amber-50 border-amber-300'
      : 'text-emerald-800 bg-emerald-50 border-emerald-200'
...
Opening oil {d.signed}{short && ' — approximate'}
```

**The colour and the word say the same thing, so neither carries it alone.** Amber and the
literal word *"approximate"* both mark the same state. Photocopy it, hand it to a colour-blind
operator, print it in greyscale: the meaning survives every one.

### By that standard the circle-limit indicator is weaker than its exclusion implied

`renderCircleLimitIndicator` separates **"your next action"** (amber) from **"someone else must
configure this"** (grey). Checking each message against whether the words carry it:

| message | tone | do the words carry it? |
|---|---|---|
| `Enter Wt of Coil LV to estimate` | amber | **yes** — imperative, addressed to the reader |
| `Enter Wt of Coil to estimate` | amber | **yes** — same |
| `Inspection incomplete - cannot estimate` | amber | **no** |
| `External inspection missing - cannot estimate` | grey | **no** |
| `Rate not configured - cannot estimate` | grey | **no** |
| `Fixed rate - no limit check` | grey | partly — states a reason, not an owner |

**Two of the three amber messages carry the distinction in words. The third does not** - and it
is the one that sits closest to a grey message of near-identical shape. *"Inspection incomplete
- cannot estimate"* and *"External inspection missing - cannot estimate"* are the same sentence
pattern, the same length and the same italic weight. **In greyscale they are two identical-
looking grey lines, and one of them means "go and fill in the field in front of you" while the
other means "wait for someone else".**

So the defect is narrower than "the indicator relies on colour", and sharper: it is one branch,
and it is the branch where the colour is doing all the work.

### The general finding, which is the reason this is its own entry

**Exclusion from restyling is not the same as being well-built.**

The indicator was excluded from the token vocabulary because its colours carry meaning (G16),
and that exclusion is correct. But it was then treated as *compliant* - as though being
protected from a cleanup were evidence that it was right. It is not. **The exclusion says "a
tool cannot check this"; it says nothing about whether it passes.**

This is the same shape as the GP chip needing its label: *colour is never the only signal*.
That rule was applied to every token in `ui.ts` and to every notice restyled in this pass, and
the one set explicitly held outside the tokens is the one where nobody re-checked it.

The lesson generalises past this codebase: **a carve-out list needs its own audit, precisely
because the automated checks stop at its boundary.** Everything inside the system is checked by
the system; everything the system was told to leave alone is checked by nobody.

⚠ **AND IT GENERALISES PAST STYLING.** Every exclusion in this project sits outside whatever
checks the rest of it, and each was carved out for a good reason that says nothing about
whether the thing itself is right:

| carve-out | outside what |
|---|---|
| the deferred "Type" heading rename | outside the terminology work that named the ambiguity |
| the Wound Core fallback | outside the master-health checks that cover the other sections |
| the legacy `estimateMaster` field | outside the per-AT migration that moved everything else |
| D0's derived job numbers | outside the numbering rebuild that made the rest allocated |
| GP brown, the Dispatch tints, the tender chip | outside the token vocabulary |
| the circle-limit indicator | outside it too - and the one that turned out to be weak |

**The test to apply to any of them is the same:** not "why was this excluded?" - that is
usually recorded and usually sound - but **"what checks it now?"** For most of the rows above
the answer is an entry in this file and nothing else, which is why the entries have to say what
the thing must satisfy rather than only why it was left alone.

### Not fixed here, deliberately

Making *"Inspection incomplete"* carry its own ownership is a **wording change to a message F79
settled**, and F79's wording distinguishes an unentered field from an unconfigured rate. Editing
it inside a presentation pass is exactly the interleaving that makes both harder to review - the
same reasoning that deferred G11's read-only control.

It belongs after the restyle pass. The standard to hold it to is the badge's: **say it in the
words, and let the colour agree rather than carry.**

### Resolved — and the rule turned out to be grammatical

| condition | was | now | tone |
|---|---|---|---|
| coil LV weight | `Enter Wt of Coil LV to estimate` | *unchanged* | amber |
| coil weight | `Enter Wt of Coil to estimate` | *unchanged* | amber |
| other missing input | `Inspection incomplete - cannot estimate` | **`Enter the missing field to estimate`** | amber |
| no external data | `External inspection missing - cannot estimate` | **`External inspection not done yet`** | grey |
| rate missing | `Rate not configured - cannot estimate` | **`Rate not configured in Estimate Master`** | grey |
| no limit | `Limit not configured` | *unchanged* — a button, underlined | grey |
| fixed rate | `Fixed rate - no limit check` | *unchanged* — declarative already | grey |

**Imperative for the reader's action, declarative for someone else's.** The two amber messages
that already carried their ownership did it by being instructions; the fix was to make that the
rule rather than an accident of two strings. Ownership now survives greyscale, photocopying and
colour-blindness with no colour at all, and the tones still agree rather than carry.

**The shared `- cannot estimate` suffix was the actual defect and is gone from the grey pair.**
That suffix is what made the amber and grey messages twins — same pattern, same length, same
italic weight. Removing it breaks the resemblance at its source rather than compensating for it.
`Rate not configured in Estimate Master` also now names where the fix lives, so nobody infers
it from the colour.

### Two things this deliberately did not do

**It does not name the field in the fallback**, because it cannot: `EstimateRateError` carries
`kind` and `message` and nothing else, and the two coil messages identify themselves by
substring-matching their own prose. See **O36**.

**It does not change the tone on two branches where amber is arguably wrong** — a conservator
weight with no field anywhere in the app, and a KV Rating that lives on the other screen. Both
are logic defects that no rewording fixes, and disguising them with better words would have been
worse than leaving them visible. See **O37**.

That split is the same discipline as the deferral itself: **a wording change fixes wording.**
Where the words were carrying a defect rather than causing one, they were left alone and the
defect was written down.

---

## G19. The last screen, and a guard that caught a comment describing a deleted system

New Job was held back to the end of the restyle pass deliberately: it is where a presentation
change is most likely to disturb something that took three rebuilds, and the vocabulary needed
to be settled across ten screens first.

**Five sets frozen, asserted before and after**, with the script writing the file back unchanged
if any assertion failed:

1. the intake gate (F83) and its handler assertion (G3);
2. **the job-number field** — c1eabbe's shape: numbers DERIVED not reserved, the suggestion
   continuing from the highest SAVED active OGP job, the prefix inside the box, recomputation
   when division or core type changes;
3. the setup-gap dialogs, each naming the thing that is actually missing (F50/F79);
4. draft stashing on a mid-entry tender switch;
5. the duplicate check and the allotment count.

Fourteen expressions confirmed present before and after. Restyled: 8 modals, 2 pill shadows,
40 figures made tabular. No card surface matched — this screen's surfaces were already plain.

### ⚠ The assertion refused, and what it caught was a lie in a comment

The pre-check also asserted that the **removed** reservation system stays removed. It failed:
`reserveJobNos` was present. Not as code — in a comment, and the comment said:

> *"Every number now comes from `reserveJobNos`, which advances the counter inside its own
> transaction before the operator ever sees the number (AUDIT F60)."*

**There is no `reserveJobNos`.** The whole apparatus was deleted when intake changed from
allocating numbers to recording the ones the division already agreed. The comment described the
system that F60 built and F68 removed, and it sat directly above the counter-reconciliation
block explaining why that block exists — so it did not merely fail to describe the code, **it
gave a wrong reason for the code that is still there**.

Corrected to say what the block actually does: the job-number field is editable, so a saved
number higher than the stored counter must push the counter forward, or the AT's
`lastJobNumbers` sits below reality and the seeding that reads it (F42) starts a later tender
too low.

**This is the fifth comment in this session found asserting behaviour the code does not have**
(F87, F88, F92, G11, and now this). What is different here is how it was found: not by reading,
but by **a machine check that happened to be looking for the same string**. The guard was
written to prevent a restyle reintroducing a deleted system; it caught documentation claiming
the deleted system was still in use.

### The refinement that followed

The check then had to distinguish code from prose, because the corrected comment *names*
`reserveJobNos` in order to say it does not exist. So the assertion strips comments before
looking — **the name must be absent as code and is now deliberately present as text.** Same
two-sided shape as the G8 pointer check in G17: a probe that only searched for absence would
have permitted deleting the correction that explains the absence.

The same distinction settled the two apparent DIFFs in the proof: `getAutoJobNo` 9→10 and
`lastJobNumbers` 3→4 were both the new comment. **Code-only: 9→9 and 3→3.**

### The restyle pass is complete

Eleven screens, one vocabulary in `src/lib/ui.ts`, four exclusion sets recorded with the two
kinds distinguished (G16, G18), every printed document hashed identical, and every screen's
guards, notices and wording verified unchanged rather than assumed.

---

## G20. The inspection reports: text sized to fit a page that was two-thirds empty

**Reported by the user**, who could not comfortably read a printed External inspection sheet.
That is the whole reason this was found: the restyle pass immediately before it had hashed both
documents byte-identical eleven times over, and every one of those checks passed. **A frozen
document is not a correct document.** The pass proved nothing had changed; nobody had asked
whether what was there was any good.

Both sheets printed their data table at **7.5px**, with individual cells narrowed to **7px** and
**6.5px**. For comparison, the itemised estimate on the same printer is 9.5px.

### The measurement that inverted the question

| | External | Internal |
|---|---|---|
| orientation | landscape A4 | landscape A4 |
| columns | 29 | 27 |
| content area | ~176 mm | ~176 mm |
| used by 9 rows + chrome | ~68 mm | ~68 mm |
| **spare** | **~115 mm** | **~115 mm** |

**Two-thirds of the page was empty while the type was too small to read.** `CHUNK_SIZE = 9` sits
above the pagination loop and reads as a vertical capacity — nine rows, one page. It is not.
Nine rows use about a third of the height available. The constraint that actually binds these
documents is **29 columns across 297 mm**, which is a width, and the row count says nothing
about it.

So the number was not wrong and did not change. What it lacked was the *reason*, and a reader
who assumed the obvious reason would reach for exactly the wrong lever.

### What changed

Table `7.5px → 9.5px`; the narrowed `7px` and `6.5px` cells to `8.5px`; signature sub-labels
`8px → 9px`; the stamp box `7.5px → 8.5px`; Internal's amorphous/wound-core note band
`8px → 9px`. Floor across both documents: **8.5px**. Nothing shrank.

`CHUNK_SIZE` was given the model it never had — 29 (27) columns across 297 mm, ~115 mm of
vertical surplus, width as the binding constraint, and the instruction that horizontal overflow
must be answered by **fewer columns or a smaller chunk, never smaller type**, because smaller
type is the fault being fixed and compensating that way would undo it silently.

### The assertion that refused

Internal's `font-mono` cell anchor did not match. The restyle pass had inserted `tabular-nums`
into that class list, so the pre-edit string no longer existed. The script stopped rather than
skipping the edit — **the failure was mine and the guard was right**, which is the same shape as
the EstimateMaster and NewJob refusals earlier in this session.

One error corrected during drafting: the first version of the `CHUNK_SIZE` comment said 69
columns, taken from a `grep` of the whole file rather than the printed block. The real figures
are 29 and 27. A model with a wrong number in it is worse than no model, because it will be
believed.

---

## G21. The Testing Report, and a row height that only works because of the Tailwind version

Same treatment, same document family, one structural difference worth the entry.

**Sizes before:** table `8px`; sub-header row `7.5px`; stacked sub-lines `6.5px` (serial number,
MR date) and `7.5px` (MR number); core-type suffix `7px`; chrome `10px` and `9.5px` with `8px`
sub-labels. **Spare:** ~97 mm of a 176 mm content area — about half the page.

**Sizes after:** table **`9.5px`**; every sub-line **`8.5px`**; signature sub-labels **`9px`**;
`10px` and `9.5px` chrome untouched. Floor **8.5px**, up from 6.5px.

The sub-lines deliberately did **not** go to the table's 9.5px. A sub-line at the same size as
the value it sits under is not a sub-line, and this sheet has 21 column slots to keep legible.

### `h-6.5` is valid, and only because of the Tailwind version

Unlike the inspection reports, this document declares a row height: `<tr className="border
border-black h-6.5">`. That class is not in Tailwind v3's spacing scale, and the first reading
of it was that it was dead.

**It is not.** This project is on **Tailwind v4.1.14** — CSS-first, `@import "tailwindcss"`, no
config file — where spacing is generated dynamically and `h-6.5` resolves to `calc(var(--spacing)
* 6.5)` = **26 px**.

That verification changed the answer rather than confirming it, and the dependency it exposed is
the durable part: **the row height is what made the enlargement nearly free, and it rests on the
Tailwind major version, not on anything in this file.** A downgrade, or a config that pins the
spacing scale, would silently return these rows to content-sizing and change how the document
paginates with no diff to point at.

"Nearly" free rather than free, because a `<tr>` height is a **minimum**: five cells stack two
lines, so at 9.5px each row grows by about a pixel — roughly 2 mm down the page, against ~88 mm
spare after the enlargement.

### The comment that already existed, and was still not a model

Unlike the inspection reports, `CHUNK_SIZE = 8` here had a comment:

> `// Chunk jobs for clean landscape A4 pagination (8 jobs per page)`

It restates the value and asserts a result. It does not say why 8, that the page is half empty,
or which dimension binds. **A comment that names the constant and claims it works is easy to
mistake for a justification** — arguably worse than the inspection reports' bare number, which
at least announced itself as unexplained. Replaced with the same model: 21 column slots across
297 mm, ~88 mm spare, width binding, the `h-6.5` dependency spelled out, and overflow answered
by fewer columns or a smaller chunk rather than smaller type.

---

## G22. The fixed-rate estimate: a borrowed floor, and a budget that does not know what it is measuring

The Amorphous / CRGO Wound Core document — *ESTIMATE FOR REPAIRING OF … / FIXED RATE (Internal &
External)*. **Two line items**, against the itemised sheet's 29.

Two passes, and the second one mattered more than the first.

### Pass one: the prose, and the finding underneath it

The clause paragraph — 1,024 characters describing what is actually being charged for — printed
at **9px**; the LT-coil and radiator notes at **8px**. Raised to 11px and 10px, with the
rate-error box and the Order No. line to 10px and the title to `text-base`.

While measuring, the real finding: **this branch shares `layoutEstimatePages`.** The
*calculation* returns early; the *render* does not. It maps the same pages over the same
measured `contentMm` and the same constants — constants derived for the itemised sheet, which
does not have this sheet's sub-heading, clause or notes. See the pattern section for why an
incomplete model is worse than an absent one.

### Pass two: the floor was borrowed, and stopping had to be derived

Pass one left the table, totals, job box and signature alone because they already met "the
9.5px target". **That target came from the itemised sheet** — 29 rows, 16 mm spare after G7
fitted it to one page. This sheet has two rows and ~90 mm spare. There was no reason for it to
sit at the same size as a document with fourteen times the content, and "it already meets the
target" concealed the fact that the target belonged to something else.

| | before | after |
|---|---|---|
| title | `text-base` | `text-lg` |
| job box + labels | `10px` | `12px` (`w-24 → w-28`) |
| sub-heading | `text-xs` | `text-sm` |
| clause | `11px` | `12px` |
| **table** | `9.5px` | **`13px`**, rows `h-4 → h-7`, cells `p-0.5 → p-1.5` |
| notes | `10px` | `11px` |
| totals | `9.5px` | `13px` |
| **Final Amount** | `10.5px` | **`15px`** |
| signature | `10px` | `13px` |

Floor **11px**. Page usage 169 mm → **206 mm of 259.1 mm**, leaving **~53 mm**.

**Why stop there, with 53 mm still spare.** The page is `flex flex-col justify-between`, so the
signature block is pinned to the bottom whatever the content does. Surplus therefore becomes
**one gap** between the notes and the signature, not more readable text; past roughly this point
the sheet reads as a stripe of type at the top and another at the bottom. That is a limit
derived from how this page lays out. The 9.5px floor it replaced was a number copied from a
different document — **the distinction between those two kinds of stopping point is the entry.**

### What the guards did

The two printed branches live in **one file**, and `w-24`, `p-0.5`, `p-1` and `text-[10px]` all
appear verbatim in both. Every edit was applied to the fixed-rate **slice**; a whole-file
replace would have silently edited a document that was out of scope. The itemised block was
asserted byte-identical (`b7b0ccd033a085f749e1d3a3b6f0b132`) against a snapshot taken in the same
process, in both passes — **compared, not assumed**.

Three assertions refused across the two passes, all three my error rather than the code's: a
floor set to 10px while the table and totals were deliberately left at 9.5px; a label count of
13 taken from the row layout when there are 14 spans. Each stopped before writing.

Also recorded rather than fixed: `JOB_BOX_MM = 30.5` is exact for the itemised sheet and about
0.4 mm light for this one, inside `SAFETY_MM = 4`. **A constant that is exact for one caller and
approximate for another should say so rather than look uniformly measured.** G23 extended that
note to three constants — see below.

---

## G23. The overflow the budget could not have reported, however honest it became

G22 left the fixed-rate sheet with ~85 mm of uncharged content against ~53 mm of margin — a
blind spot larger than the slack hiding it — and the clause driving it is **agency-editable**
(`agency.amorphousClauseText`). The obvious repair was to charge the sub-heading, clause and
notes in `layoutEstimatePages` so this branch would fail the way the itemised one does: loudly,
with a notice.

**That repair would not have worked, and the reason is structural rather than incidental.**

### Why charging the budget cannot produce the warning

`layoutEstimatePages` relieves pressure in exactly one way: **it moves rows to another page.**
The three uncharged blocks are not rows, and all three are `isFirst`-gated, so they are pinned
to page 1 and there is nothing for the mechanism to move. Worse, in `fixLastPageOverflow`:

```js
if (used + cost > cap) { overflowAt = i; break; }   // i = 0 when the clause alone blows the page
...
if (overflowAt <= 0) break;                         // gives up, returns one page
```

A mild overgrowth pushes row 2 onto page 2 and produces a page count somebody might notice. A
severe one — the clause alone exceeding the page — sets `overflowAt` to `0`, breaks, and returns
**one page**. It clips silently.

**So a budget-based check would go quiet exactly when the failure is worst.** That is not a bug
inside the function; it is what a row-moving relief valve can and cannot see. Any amount of
honesty added to the constants would have inherited it.

### And it would have misattributed the cause

Charging the blocks *can* push `totalPages` to 2 in the mild case — at which point
`paginatedByLetterhead` fires and announces *"prints on 2 pages because of the letterhead
reservation"*. Its `wouldFitWithoutReservation` computes `rowsMm` from `allRows` only and never
sees the clause. **Charging without rewriting the notice would have converted a silent failure
into a confidently misattributed one** — the operator reduces the header height, the fault does
not move, and the app has actively sent them the wrong way.

### What was built instead

A measurement, outside `layoutEstimatePages` entirely, so the itemised document carries **no
risk at all**: its budget is untouched, its overflow still moves rows, and
`paginatedByLetterhead` still reports it.

**It measures natural heights, not the container's.** The page is `flex flex-col
justify-between` and both children default to `flex-shrink: 1`, so content that is too tall gets
**compressed** rather than overflowing its parent — the container's own `scrollHeight` would
equal its `clientHeight` and report nothing wrong. Summing each child's `scrollHeight` against
the container's `clientHeight` is what survives that. A 1 mm floor absorbs sub-pixel rounding.

The notice **names the clause, not "content"**, because the clause is the editable thing: which
paragraph, which three settings, where to change them, and how many millimetres are being lost.
It also says the printed sheet will not show that anything is missing — clipping leaves no mark,
so the warning is the only evidence there will ever be.

And it says what it is **not**: *"This is not the letterhead reservation and reducing the header
or footer height will not fix it."* Two notices on one screen with different causes must each
name their own. On this sheet only the clause notice can actually fire — two rows cannot reach
a second page — but that is a fact about today's row count, not a property of either notice, so
they are kept distinguishable regardless.

### What this does not do

**It reports the consequence; it does not make the model true.** The ~85 mm is still uncharged
and `layoutEstimatePages` still does not know this branch exists. That was the deliberate split:
loud failure and a truthful budget are different goals, and only one of them was needed to stop
a division receiving a clipped estimate.

The per-caller drift is now recorded as **three** constants rather than one — `JOB_BOX_MM`
~0.4 mm light, `ROW_MM` ~2.6 mm light **per row** (G22 set these rows to `h-7` = 7.4 mm against a
constant describing 4.8 mm), `TABLE_HEAD_MM` slightly light from `p-1 → p-1.5`. All inside
`SAFETY_MM = 4`, all stated rather than adjusted. The `ROW_MM` divergence was introduced by G22
and not noticed until this entry — **the same class of defect G22 was written to record.**

---

## G24. A control that took input and then discarded it

G11 stopped the Full Edit save writing the MR header's `division` and `repairType` onto every
job, because on a mixed MR that was a silent rewrite — a GP job among OGP ones became OGP,
losing the record that it was repaired under guarantee at no cost, for an operator who opened
the modal to fix a serial number.

**That fix left the controls in a worse state than either of the two honest ones.** They still
looked like editable properties of the MR. They still accepted a change. And the change was then
discarded for every row except a brand-new one. **An input that ignores you is worse than a
locked one, because it also tells you it worked.**

The underlying reason is not a UI preference: **an MR's division and repair category come off
the division's paperwork.** The agency does not choose them. They are recorded, not decided.

### The lock condition is the same fact as the message

The trigger is deliberately *"are there saved units whose values would not follow"* — not
*"does the MR have jobs"*:

```js
const savedJobs = (editingMr?.jobs ?? []).filter(j => j.id && !j.isNew);
locked: savedJobs.length > 0
```

A row added in this session has no values of its own and **does** take these, so it is not a
reason to lock. That keeps the lock and the sentence shown to the operator as one fact rather
than two rules that can drift — the same discipline as G3's "the gate is in the handler, not
only on the button", applied to an explanation instead of a guard.

### Not a disabled box

A greyed-out input says *"you cannot do this"* and stops there. It invites the operator to hunt
for the enabled version, or to read the lock as a bug. The field shows the value **as a record**
and says why in words:

> **Division Office** 🔒 SABARMATI
> *Addresses the forwarding letter and sets the job-number prefix. Recorded on 4 saved
> transformer(s) — editing it here would not change theirs.*

The reason names the **consequence of editing**, not the rule. "Would not change theirs" is
checkable against the screen below it; "this field is read-only" is not.

### It shows counts when the units disagree

`editingMr.division` is seeded from `group.division`, which is **first-job-wins** — the exact
sample G11 was written about. Displaying it read-only as *the MR's division* would have asserted
the one thing G11 established is unreliable, and asserted it more firmly than before, because a
locked value reads as authoritative.

So the field reuses G10's `mixOf`: `SABARMATI 3 · KALOL 1` when they disagree, one value when
they do not. Same rule as the register and the per-division oil split (F86) — **two facts are
not one fact.** The amber tone agrees with the words rather than carrying them; the counts
themselves say the units disagree, in greyscale and on a photocopy.

**Zero MRs in live data are mixed** (`mr-homogeneity.js`: 0 of 21 on both fields), so this
branch is written against a state that has not occurred. It is written anyway because G11's
whole finding was that nothing prevents it.

### What the add path inherits, said where the adding happens

The locked values are still the source for a row that has none — the job-number prefix comes
from `getJobNoPrefix(editingMr.division, …)`, the counter advance is keyed on it, and GP excludes
a job from number continuation. So this is **not a dead control; it is a record that also seeds**,
and the modal now says so above the unit list:

> A transformer added below is stamped **SABARMATI** / **OGP** from these values. A unit
> belonging to another division, or repaired under guarantee when this MR is not, belongs on
> that division's own MR.

When the saved units disagree there is nothing coherent to inherit, and it says that instead —
that a new row would be stamped from whichever unit was read first, which is arbitrary.

**A side effect worth naming: this closes the path G11 identified as the way a mixed MR would
first appear.** G11 recorded that the defect would bite *"the first time an operator adds a GP
unit to an existing OGP MR — which the add-unit button permits, and which nothing prevents."*
Locking the category means the button can no longer be used that way. That was not the goal of
this change and it does not make the display fix redundant — data can still be mixed by other
routes, and G10's counts still report it — but the most likely route is now shut.

### The heading and the subtitle contradicted the controls

Two pieces of surrounding text promised what the fields no longer do, and both were more
misleading than the controls themselves because they are read first:

| | was | now |
|---|---|---|
| section heading | `MR Header & Administrative Details` | `MR Header — As Issued By The Division` |
| modal subtitle | Edit MR Header information, **change category**, and modify all N transformer unit(s) | Edit the MR number and date, and modify all N transformer unit(s). Division and repair category come from the division and are shown as recorded. |

*"Administrative Details"* frames the block as properties the agency administers. *"As Issued By
The Division"* names the source, which is the actual rule and also explains the lock before the
operator reaches it.

**The subtitle was the sharper one.** It said *"change category"* — an explicit offer to do the
thing the control three inches below now refuses. It had been wrong since G11 in substance
(the change was accepted and discarded) and became visibly wrong here.

**This is the third time in this session that surrounding prose outlived the code it
described** — after G19's comment citing a deleted `reserveJobNos` and G21's `CHUNK_SIZE`
comment asserting "clean pagination" with no budget. The pattern is consistent: **the code was
changed, the checks passed, and the sentence next to it was not part of either.**

---

## G25. A 1024px badge rendered at 28px, and the mark that was already in the repo

**Reported by the user:** the logo is not clearly visible.

The obvious diagnoses were all wrong. It was not too small, not low-resolution, and only
secondarily a contrast problem.

### What it actually was

`src/assets/images/transformer_app_logo_*.jpg` is a **1024 × 1024 JPEG, 637 KB** — a circular
badge with **three concentric rings of text** and a shaded transformer illustration with
individually drawn coil windings. It was rendered at 8 UI sites between **28px and 64px**.

| | |
|---|---|
| downscale at the sidebar | **25.6×** |
| downscale at the largest site (sign-in card) | 16× |
| share of the canvas the badge occupies | ~70% — the rest is the file's own margin |
| effective mark inside a 40px box | **~28px** |

**The fault was detail density, not resolution or box size.** At 25× reduction, ring text and
hairline windings average toward the background and the whole resolves to a blue-grey disc with
an orange blob. **Enlarging it would not have fixed it** — a mark drawn to be read at 300px does
not read at 40px at any scale, which is why the remedy was a different mark rather than a bigger
one.

Two secondary faults, both consequences of it being a photograph-shaped asset: ~30% of every box
was spent on the JPEG's opaque off-white margin, and that margin dissolved into the six
near-white sidebars while punching a white square into the three near-black ones.

### And it said VOLTCORE

The badge's rings read *VOLTCORE · TRANSFORMER REPAIR · OVERHAUL SERVICES*, sitting immediately
left of an `<h1>` reading **TR REP AGENCY**. Illegible at 28px, and wrong at 64px.

Nothing found this. It is not a data fault, not a logic fault, and no check in this codebase has
an opinion about it — **it was visible on every screen, every day, to everyone.**

### The fix was already in the repository

`public/favicon.svg` — five geometric paths, no text, drawn for small sizes, already referenced
by `index.html` and `manifest.json`. The app had been carrying **two unrelated marks** and using
the worse one everywhere except the browser tab.

Measured before adopting it, from the SVG geometry:

| | 28px | 40px | 64px |
|---|---|---|---|
| body stroke (3u) | 1.31px | 1.88px | 3px |
| bushing pins (6u × 3u) | **2.6 × 1.3px** | 3.8 × 1.9px | 6 × 3px |
| bolt outline (1.5u) | 0.66px — vanishes, harmlessly | 0.94px | 1.5px |

The pins are the weakest element at 28px and the one thing the user is checking on screen.

*This table describes the mark before G54 redrew it. It measured elements, not the frame - the
artwork used 48% of the tile's width - and it never measured the tank fill (G55).*

### The tile is load-bearing, which inverts the obvious instinct

The instinct with a logo that dissolves into its background is to make it transparent. **That
would have broken six of the nine themes.**

| | ratio |
|---|---|
| body stroke `#93C5FD` on a **near-white sidebar**, tile removed | **1.8:1** — vanishes |
| body stroke on its own navy tile | 5.7:1 |
| navy tile vs the six near-white sidebars | 10.4:1 |
| navy tile vs the three near-black sidebars | **1.9:1** — edge merges |
| contents vs those same near-black sidebars | **10.9:1** |

So on dark themes only the *silhouette* merges; the mark still reads. **A floating mark is
cosmetic; an invisible one is not** — the two were worth separating rather than adding a ring
speculatively for a problem nobody has seen.

### The chrome was written for the old asset

Every site carried `rounded-*`, `border-*` and `shadow-*`. All three assume an opaque rectangle:
a CSS radius (fixed 8px) clips into the SVG's own corners (6.1px at 28px), a CSS border traces a
box the eye no longer sees, and a CSS shadow falls square behind a rounded shape. All removed.
**Replacing an asset without revisiting the styling written for it leaves decoration describing
something that is gone** — the same shape as G24's subtitle, in CSS instead of prose.

### One file, not two

`APP_MARK = '/favicon.svg'` in `ui.ts`, referenced by all 8 sites. Importing a bundled copy
would have restored the two-marks problem in a form that stays invisible until someone edits one
of them. The trade-off is stated where the constant is defined: `public/` assets are not
content-hashed by Vite, so a future edit relies on ordinary cache expiry.

### Deliberately not done

**The JPEGs stay.** `transformer_hero_bg_*.jpg` is still live as the landing hero backdrop
(`LandingPage.tsx:211`, 14% opacity, greyscale). The logo JPEG is now unreferenced but was left
in place pending a decision, rather than deleted in a change about legibility.

**The name stays.** `TR REP AGENCY` remains in every heading and in `<title>`. The mark now
carries no name at all, so removing VOLTCORE settles the inconsistency that existed today
without asserting a new one.

---

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
>
> **⚠ THE DATA BELOW HAS MOVED SINCE THIS WAS WRITTEN — see the re-census at the end of
> this entry (2026-09-07).** `101` is gone, `MSBT-10` has appeared, and the two MEGHA
> collisions are unchanged. A reader who takes "3 collisions" from the tables above and
> finds two in the database would not know which reading is stale. It is the tables.


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

#### Re-census, 2026-09-07 — what the database holds now

Read with the Admin SDK across every owner, applying **this entry's own same-transformer
test** (serial + make + capacity). **63 jobs scanned, 59 distinct job numbers, 3
repeated** — against 37 / 3 above.

| number | records | then | now |
|---|---|---|---|
| `MSBT-12` | 3 | true collision | **unchanged** — all three doc IDs present, `BxVxraTszbqkpZprmhwp` still the 25 kVA `DVDVDFV` against two 100 kVA `121` records. The RENUMBER verdict stands and has not been acted on. |
| `MSBT-1` | 2 | true collision | **unchanged** — both doc IDs present, still two units under one number |
| `101` | 0 | true collision | **both records deleted** |
| `MSBT-10` | 2 | not recorded | **new repeat, and NOT a collision** |

**`101` WAS RESOLVED BY DELETION, NOT RENUMBERING — and it was the evidentially important
one.** Neither `dXMZ8WALx0QpOK6oAM79` nor `P9q3SxKkehJVEbGxCmSe` exists any more. This
entry singles that pair out above: both records were pre-AT within one agency (DRISHIV),
which makes it the only observed instance that came from **O2 paths 1-3** rather than
path 4, and therefore the only empirical evidence that **agency-wide counters would not
have prevented it**. Both MEGHA pairs are path 4 and would have been.

**That evidence now exists only in this entry.** Anyone re-running
`scripts/duplicate-jobno-console.js` will find nothing but path-4 collisions and could
reasonably conclude agency-wide counters are a complete fix. They are not, and the
record that proved it has been deleted. This is the reason the entry is being amended
rather than left closed.

**`MSBT-10` is the pattern working, not a fourth collision.** Both records —
`BShPQhnu11n0s5yrkIQ5` (MR 85558) and `DfLga5UJcnp4oVdLT7uc` (MR 6652) — carry the *same*
serial `213213213213`, make `DFDFDFDFDFDFXCXC` and 200 kVA, and one is flagged
`repairType: 'GP'`. It passes this entry's same-transformer test, which is exactly the
shape identified above as `MSBT-12`'s legitimate KEEP pair: a GP return of a unit already
repaired, reusing its number on purpose. Both sit under the same AT and the same agency,
so had it been a collision it would have been paths 1-3.

On this entry's own counting the tally moved from **3 numbers / 0 legitimate GP repeats /
3 collisions** to **3 numbers / 1 legitimate GP repeat / 2 collisions**. The list of
*collisions* above is still accurate. The list of *repeats* is stale in both directions.

**Nothing here changes the CLOSED status.** The records are still test data, still due to
be wiped, and O2 is still the live defect. What changed is that a closed entry's data no
longer matches the database, and a stale table is worse than an open question.

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

> **THE ANSWER HAS CHANGED - 2026-09-11.** "These agencies do not use S.E. conductor", below, was
> the operator's answer when asked, and it was right to record it as that: an agency fact, not
> something read off the tender. **The operator now says S.E. conductor is used.** Nothing below was
> a mistake at the time; the fact it records is no longer current.
>
> Until an S.E. input exists, every coil still prices at the without-S.E. rate. On S.E. work that
> under-charges each winding in both tenders:
> - UGVCL-2020: 12A-b 163 against 12A-b1 213, and 13A-b 149 against 13A-b1 199;
> - UGVCL-2026: 12A-b 165 against 12A-b1 215, and 13A-b 150 against 13A-b1 201.
>
> The fixed selection lives in `SingleJobEstimateReport`, at the HV and LV coil lines.
>
> **DECIDED, 2026-09-11: NO S.E. ROWS IN THE ESTIMATE MASTER.** Schedule-A holds sixteen coil rows
> per tender - with and without S.E., originals present and missing, copper and aluminium. The master
> holds four, all without S.E. **That is not an unfinished set.** Pricing reads Schedule-A whenever
> the master has no row, so an S.E. job prices 12A-b1 and 13A-b1 correctly without a master row.
> Adding one buys nothing and creates another cell that can disagree with the tender. Anyone counting
> sixteen schedule rows against four master rows is looking at this decision, not a gap to fill.

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

> **⚠ REOPENED — THE ANSWER CAME BACK, AND IT IS YES (2026-09-07).** The heading is now
> wrong in the only way that matters: the operator confirms the estimate Excel export **is
> used routinely — notes are added to it and it is sent to division offices**, and the
> agencies hold copies of what they sent.
>
> **So inflated spreadsheets did go out.** The earlier closure — "every sheet that could
> have been exported came from test data" — was an inference from the database, and the
> database was the wrong place to look: nothing about an export is ever written back to it.
> The files exist only on the agencies' machines and in division offices.
>
> **THE WINDOW, from git history:**
>
> | | commit | date |
> |---|---|---|
> | export added, already self-contradicting | `1f1e735` *"feat(estimate): add multi-core estimate support and excel export"* | **2026-08-14** |
> | fixed | `5fd1ca9` *"fix: delete second estimate engine, route export and matrix through builder"* (F54/F55) | **2026-08-24** |
>
> **Ten days, 84 commits.** Any `Estimate_Report_MR_<mr>.xlsx` produced in that window is
> affected. Anything exported from 2026-08-24 onward reads both halves from one builder and
> reconciles.
>
> **It was wrong from the first commit, not from a later regression.** At `1f1e735` the item
> rows were already computed inline from invented quantities while the BASE REPAIR COST,
> AT % RISE / FALL and GRAND TOTAL rows already came from `calculateJobTotal` — i.e. through
> the builder, with real inspection data. The refactor into `calculateJobItemDetails` on
> 2026-08-18 (`6282d3f`, `dc90f74`) moved that arithmetic without changing it. So every sheet
> in the window contradicts itself, and there is no earlier "good" version to compare against.
>
> **NOTHING RECORDS THAT AN EXPORT HAPPENED. Stated plainly because it decides the method:**
> `handleExportExcel` ends at `XLSX.writeFile` and writes nothing back — no Firestore write,
> no job field, no state change, no `exports` collection. The app has no telemetry of any
> kind (the only `analytics`/`logEvent` hits in the tree are inside vendored Firebase SDK
> code under `functions/node_modules`). **The affected set cannot be reconstructed from the
> database at all. It can only be identified from the agencies' own copies** — their sent
> folders, their email, and the division offices' files.
>
> **What to tell them to look for.** Any `Estimate_Report_MR_*.xlsx` dated between
> 2026-08-14 and 2026-08-24. The test needs no reference copy and no software: **add up the
> item column and compare it with the GRAND TOTAL printed beneath.** If the column exceeds
> the total, that sheet is affected. The totals row was always correct, so the GRAND TOTAL on
> those files is the figure that should have been claimed.
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

**ANSWERED, 2026-09-07 — see the block at the top of this entry.** Yes to the first, and the
second is the worst of the three available answers: the sheets are annotated and sent to
division offices, and the agencies keep copies. The two-part question was right to ask; what
it got wrong was the closure written before it was put, which read the empty database as
evidence of no exposure when the database was never going to hold any.

**The transferable lesson, and it is the reason this entry is worth keeping after the fix:
absence of evidence in a system with no telemetry is not evidence of absence.** Every other
open question in this audit was settled by querying live data. This one could not be, because
the action leaves no trace by design - a file is written to the operator's disk and the
process ends. When the only record of an action is outside the system, the system cannot be
asked, and closing the question from inside it produces a confident wrong answer.

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

### O29. CLOSED — the approved amount now decides what the bill claims

**Closed by the consent work.** `approvedAmount` had been written at the approval stage and
read by nothing since it was built: the bill recomputed from the master every time, so a
figure the division had actually sanctioned sat in the database beside a claim derived
independently of it.

It is now the claim. `BillingSystem.calculateJobTotal` returns `job.approvedAmount` where one
exists, and the chain runs end to end: the agency consents at the estimate stage → the
consent is printed on the sheet → the division approves that figure → the bill claims it.

**Two things had to change before the field was usable, and both are recorded here because
the field looked usable and was not:**

1. **It was an MR-LEVEL TOTAL written onto every job in the MR.** One `apprAmount` input,
   pre-filled from `calculateMrEstimateTotal(mr)`, copied into each job's `approvedAmount`.
   Reading that per job would have claimed the whole MR's approval for each transformer.
   The approval stage now captures one amount PER JOB, pre-filled from that job's consented
   claim where consent exists and from its own assessed amount otherwise, editable because
   the division may approve something different. The MR total became a computed sum shown
   for reconciliation against the division's letter.

2. **A GUARD REFUSES A PRE-CHANGE RECORD.** The signature is more than one job in the MR all
   carrying the identical value; such a record falls through to recomputation rather than
   being billed. ⚠ TODAY IT MATCHES NOTHING — the single live record, MSBT-12 at 5661, is
   alone in its MR, so its figure is already correct per job. That is luck rather than
   design, and the guard is what makes the luck running out a refusal instead of an
   overclaim. No migration was needed and none was written.

**The original entry follows, for the reasoning that led here.**

---

### O29 (original). The DISCOM's approved amount is captured, displayed, and never read by the bill

> **RESOLVED BY DOMAIN ANSWER, NOT BY A CODE CHANGE (2026-09-07).** The operator confirms:
> **UGVCL approves the same amount that was submitted. The approved figure always equals the
> estimate.**
>
> That is the first of the three outcomes below, and it means the bill recomputing rather
> than reading `approvedAmount` produces the RIGHT number. **This is not a live defect and
> nothing here should be fixed.** No bill has claimed an unapproved figure, because there
> has never been a divergence to miss.
>
> **What is still true, and is the reason the entry stays open rather than being deleted.**
> The field is written at two sites and read by none. The Approved Estimates table renders
> a divergence (`:2247`) that does not occur, so the UI expresses a case the business does
> not have — harmless, but it is why this looked like a defect from the code alone.
>
> **What would change it, stated so the next reader does not have to re-derive it:** if UGVCL
> ever approves a revised figure, the bill would silently ignore it and claim the recomputed
> total instead, with nothing on the invoice saying so. **The field to honour already exists
> and is already populated**, so that remains a one-line change in `calculateJobTotal` —
> prefer `approvedAmount` when present — and not a design question. The reason to keep this
> entry is that the one line is easy and finding out it was needed would not be.
>
> **The classification matters more than the outcome.** A defect that exists only in the
> code's model of the business is not the same as a defect in the business, and the audit was
> right that it could not tell them apart. Only the operator could, and did.

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

⚠ **THE GAP HAS TWO SITES, AND THIS ENTRY NAMED ONLY ONE.** `handleDeleteEntireMr` is the
one described above. `handleSaveFullMr` - the MR **edit** modal's save - also deletes jobs,
one per row the operator removed:

    for (const delId of editingMr.deletedJobIds) batch.delete(doc(db, 'jobs', delId));

Same three gaps, reached by taking a row out of a form rather than by pressing Delete. **It
survived a fix aimed at the other because this entry named a function instead of a
behaviour** - anyone checking "is O33 closed?" would read `handleDeleteEntireMr`, find the
guard, and stop. Closed at G3; recorded here so the next reader of O33 knows to look for the
second site rather than trusting the name.

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
own sections first.

> **CORRECTED 2026-09-07.** This paragraph used to end: *"and the migration copied agency
> sections onto the ATs, so the ATs carry the `null` version rather than the baseline's 230
> and 148.99."* **The data contradicts the second half.** A fresh census across every AT and
> agency finds **four ATs carrying 230** at `1f`/100 KVA — ADMIN's `2026_27`, PATEL's
> `.../2020-21/1087`, and both of UPENDRA's, `24-25` and `AT2026-27` — and **seven holders
> carrying 148.99** at `11B`/100 KVA.
>
> The mechanism described is right and the conclusion drawn from it was too broad: the
> migration did copy agency sections onto the ATs, which is precisely *why* some ATs carry
> the 230 version — the agencies they were copied from (PATEL, ZENITH, ADMIN, UPENDRA) hold
> it. Whether an AT has 230 or `null` depends on which agency it descended from, not on the
> migration having filtered it out.
>
> **What that changes and what it does not.** The two cells are still unreachable by any
> live estimate — they sit at the 100 KVA column of two items, and no job has priced through
> them — so the entry's conclusion stands. What is no longer true is the reassuring form of
> it: the drift did not stay confined to `public_config`, it was carried onto four tenders,
> and freezing the baseline does not reach those copies.
>
> Found while gathering evidence on whether tender rates ever change between periods. The
> census was looking for repricing and found this instead: **the only two cells that differ
> anywhere in the database are these, and neither is a tender difference.**

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

### F81. A check measuring something that was never the problem

**The warning:** creating an AT reported *"N job numbers could not be read — so the starting
number for those divisions may be lower than the highest already issued."* Prominent, amber,
and shown at the moment a tender is created.

**It was measuring a disagreement between two parsers, not a fault in the data.**

| | reads a job number as | `SU-12A` | `102` |
|---|---|---|---|
| the SEEDER (`addAtMaster`) | `/(\d+)\s*$/` — trailing digit run | **unreadable** | 102 |
| the LIVE PATH (`getAutoJobNo`) | `parseInt` after the prefix | **12** | — |

So a number the seeder called unreadable and warned about, the code that decides real job
numbers read perfectly well. **The strict parser was the one wired to a user-facing warning;
the tolerant one silently decided the numbers.**

---

**AND THE VALUE IT WARNED ABOUT IS READ BY NOTHING.**

`lastJobNumbers` has exactly three consumers:

- the save-time advance in `NewJob` and `MrLedger` — reads the current value only to decide
  whether to write a **higher** one;
- the seeder, seeding a new AT from existing counters;
- `predictNextJobNo`, which has **zero callers**.

Every suggested job number comes from **saved jobs**: `getAutoJobNo` reads `pastJobs`,
MrLedger reads `editingMr.jobs` then `mrGroups`. So an under-seeded counter has no
consequence — and because the advance only ever moves upward, a low counter **corrects
itself at the next save**. The warning described a condition that was invisible and
self-healing.

**Live data: 0 unreadable job numbers in 64.** It had never fired.

---

**THE INVERTED SHAPE, and why it is worth a separate entry.**

Five checks in this audit have reported outside their own model — `delta-must-be-1`, a
counter key matched by division prefix, a `head`-truncated inventory, an exact-string
comparison that could not detect mistyping, `JSON.stringify` comparing key order. Every one
was a check **too narrow to see the thing it was about**.

This is the opposite: a check that worked exactly as written, on a quantity **that was never
the problem**. Nothing was too narrow. It measured the wrong thing, precisely, and reported
it prominently to a user who could do nothing with it — and the answer to "what would fixing
it mean" turned out to be *nothing*, which is how the measurement was exposed.

**The question that catches this one:** not "is the check correct?" but **"if this fires,
what does the operator do — and does anything read the value it is about?"** A warning whose
answer to both is *nothing* is not a conservative safeguard; it is noise with authority.

---

**THE FIX ALMOST INTRODUCED A REAL BUG, and the before/after check caught it.**

The obvious unification — point the seeder at the existing `highWaterJobNos` — would have
been wrong. That function required a dash before the digits, and **AARATI's highest job
numbers are bare**: `1`, `2`, `101`, `102`, with no prefix at all. Seeding a new AT would
have dropped its `SABARMATI` counter from **102 to 5**, losing 97 numbers.

    === COUNTERS A NEW AT WOULD BE SEEDED WITH ===
      ⚠ 2 counter(s) differ:
        AARATI TRANSFORMER  SABARMATI       102 -> 5
        AARATI TRANSFORMER  SABARMATI_CRGO  102 -> 5

`scripts/admin/seed-parser-equivalence.js` reported that **before the change was made**.
Reading the code did not, and would not have: nothing in either parser says "AARATI has bare
job numbers". Only the data says that.

That also means `highWaterJobNos` had a live gap of its own — a job saved with a bare number
would not have advanced the counter at either save path. Unreachable in practice, because
the OGP prefix check refuses a number without the configured prefix, but it was there.

**Resolved:** one function, `jobNoSequence` — after the last dash when there is one, the
whole string when there is not. `highWaterJobNos` delegates to it and the seeder calls it.
The `unparsed` and `unparsedKeys` fields, and the amber block that rendered them, are
**deleted along with the discrepancy that produced them** rather than moved somewhere better
— there was nothing left to report. After: counters identical for every agency and every
key, and no stored job number read differently by the two rules.

---

### O36. Estimate errors do not carry where they came from, so the UI matches on their prose

**Found while doing G18's wording change, and it is the reason that change could not go
further.** `EstimateRateError` is:

```ts
export interface EstimateRateError {
  kind: 'missing-rate' | 'missing-input';
  message: string;
}
```

`kind` separates *configuration* from *observation*, which is what F79 needed and it works.
But **nothing identifies the field**, so `renderCircleLimitIndicator` recovers it the only way
left — by substring-matching the error's own prose:

```js
inputErrors.some(e => e.message.includes('Wt of Coil LV'))
inputErrors.some(e => e.message.includes('Wt of Coil'))
```

Two consequences, one live and one latent.

**Live: the fallback message cannot name its field.** G18 asked whether *"Enter the missing
field to estimate"* could name the field the way the two coil messages do. It cannot, and
naming it would mean four or five more substring matches on sentences written for humans —
deepening the coupling rather than paying it off. The hover title carries the specifics instead.

**Latent: this is the pattern with its own entry in this file** — *a comparison against a
literal the producing code never emits*. It is currently correct only because both sides sit in
files that were edited together. Rewording `"Wt of Coil LV"` in `SingleJobEstimateReport.tsx`
for clarity — a change no reviewer would flag — silently drops the indicator to the generic
message. It type-checks, it runs, and the branch it wrongly selects is a real one.

Note also the **ordering dependency**: `'Wt of Coil LV'` must be tested before `'Wt of Coil'`,
because the second is a prefix of the first. Nothing in either file says so.

**The fix** is a structured origin on the error — the field key and the screen it lives on —
which `kind`'s own doc comment already gestures at by claiming `'missing-input'` is *"fixed on
the inspection form, by the person in front of it."* **O37 shows that claim is not always
true**, which is a second reason the origin should be data rather than prose.

Deferred deliberately: it touches the estimate module every consumer reads, and it was not
going to be done correctly inside a wording change.

---

### O37. Two branches where "your next action" is not the operator's action

Both reached through the same amber message, both found while scoping G18, and **neither is
fixable by wording** — which is why G18 changed the words and left the tone alone.

**The conservator branch points at a field that does not exist.** Schedule-A 18b prices
conservator replacement per kilogram; `damCtTank` is an integer *count*. When it is non-zero the
estimate raises a `missing-input` error saying *"no conservator weight is recorded anywhere"* —
and it is right: there is no such field in `ExternalInspection`, `InternalInspection` or the
job. The indicator then renders it amber, meaning *your next action*, for a value the operator
has nowhere to enter.

**Blast radius today is zero** — the census recorded at `SingleJobEstimateReport.tsx:621` found
0 jobs with `damCtTank > 0` across both agencies. That is what makes it an open item rather
than a defect to fix now, and also what makes it easy to leave: it will surface the first time
an inspector records a damaged conservator, on a bench, with no way forward.

**This is a data-model decision, not a rename.** Either the case is grey and says the weight
cannot be recorded anywhere, or `damCtTank > 0` is refused at the External inspection with a
message saying it cannot be priced, or the field is added. Choosing between those is not a
presentation question.

**The KV-rating branch is on the other screen.** A blank KV Rating blocks HV bushing pricing;
the field lives on the **External** inspection, while the indicator is rendered on the
**Internal** one. Amber is defensible — it is still the operator's action — but the words must
not say *"this inspection"*, which is why G18 rejected *"Complete this inspection to estimate"*
in favour of a message that stays silent about the screen. **Saying the wrong screen is the
exact failure F79 was written about.**

Fixing it properly means the error carrying its origin as structured data — see **O36**. Doing
it by matching message text would extend the coupling O36 exists to remove.

---

### O38. Two definitions of scrap — one in the bill's filter, one in the builder

**A job can be scrap for pricing and repairable for filing, at the same time.** The two tests
do not read the same fields:

| | test |
|---|---|
| `BillingSystem.jobsForBillType` | `j.status === 'Scrap' \|\| j.condition === 'Scrap'` |
| `buildSingleJobEstimateData` | `job.status === 'Scrap' \|\| job.condition === 'Scrap' \|\| internalData?.condition === 'Scrap'` |

The builder also honours the **internal inspection's** verdict; the filter does not. So a
transformer declared scrap on the bench, with nothing written back to the job, passes the
*repair* filter and is then priced by the builder's scrap short-circuit at the Rs 500 flat
inspection-and-dismantling charge.

**It is live.** `ASU-2` (10 kVA Amorphous, MR 1234) is scrap by internal inspection only:
`status: 'Dispatched'`, `condition` empty. It therefore appears on the **repair** bill, at
Rs 500, and it is the only dispatched job in its MR — so it constitutes that MR's entire
repair bill. The scrap bill for MR 1234, meanwhile, contains nothing.

**Why this is not merely cosmetic.** The two bill types are separate documents with separate
numbering and separate send state (`isBillSentForType`), and the scrap bill additionally
requires the unit to have been returned to the division on a challan. Pricing a job as scrap
while filing it as a repair defeats both: the Rs 500 lands on a document whose covering
letter describes repair work, and the return-to-store check that guards the scrap bill is
never applied to it.

**Which side is wrong is not obvious and is not decided here.** Either the filter should read
the inspection too — in which case `jobsForBillType` needs the inspection maps, which it does
not currently take — or the internal inspection's verdict should be written back to
`job.condition` when it is saved, making the job the single record of its own condition. The
second is the better shape and the larger change; it is the same "identity in a mutable
field" question as F5.

**Found while scoping the `rateErrors` gate on `calculateJobTotal`, not by it.** Nothing in
this change touches it, and the gate does not fire on ASU-2: a scrap charge that resolves
cleanly produces no `rateErrors`, so the wrong-document problem passes the new block exactly
as it passed the old one. **A bill can now be refused for being unpriceable and still be the
wrong bill.**

---

### O39. A settings screen doubles as a document's structure, and neither end says so

**The estimate master's row LIST is the exported estimate spreadsheet's skeleton.**
`EstimateGenerate.tsx:406` resolves `itemsList` through `getEstimateMasterForCore(…,
coreType)` and `:421` iterates it — one exported row per master row, carrying the master's
`itemCode` and `itemName`, with only the amounts coming from the builder via
`builderLineFor`. So adding, deleting, renaming or reordering a row in **Agency Settings →
Estimate Master** changes a document that goes to UGVCL.

**This is true for every core type, not just the fixed-rate ones.** The CRGO master's rows
shape the CRGO export the same way. It is filed here because the Amorphous lock is what
surfaced it.

**It is invisible from both ends, which is the whole finding:**

| looking from | what you see |
|---|---|
| `EstimateMaster.tsx` | a settings grid of codes, names and rates. Nothing says a row is a line on an exported document. |
| `EstimateGenerate.tsx:421` | `itemsList.forEach(...)` reading what looks like a constant. Nothing says it came from a user-editable table. |

**A rate lock does not close it.** Locking the Amorphous and Wound Core rates removes the
price risk from those sections and leaves the structural coupling untouched — an operator
who can no longer change what a job costs could still change what the spreadsheet contains.
That is why Add and Delete are disabled on the reference sections rather than only the rate
cells, and why the delete tooltip names the export as a second, separate reason.

**Not closed for the other sections.** CRGO and Overhauling are still freely editable and
still shape their exports, correctly so — those rows genuinely are the agency's. The open
question is whether that coupling should be *stated* at both ends rather than discovered:
a line in the Estimate Master header saying the rows structure the exported sheet, and a
comment at `:421` saying the array is user-editable. Cheap, and it is the kind of fact that
is only ever learned the expensive way.

---

## Pattern: a copy cannot be told from a decision, and the thing it copied moved

**The estimate master could not distinguish a deliberate override from a migrated copy,
because they are byte-identical.** That is why versioning the rate schedule never reached
the price: **the schedule changed underneath a layer that had already copied it.**

`resolveRate` checks the agency/AT master before Schedule-A, so a master cell wins. The
masters were populated by a MIGRATION from the UGVCL-2020 schedule when rates moved onto
tenders — nobody typed those figures. So an AT stamped `UGVCL-2026` priced item `1a` at
**2061** instead of **2079**, because a 2020 copy sat in front of the 2026 schedule.

**It was live with no template adopted.** ZENITH's AT 1819, `ratesSource: none`, priced a
25 kVA CRGO job at `1a` 2061, `1d` 286, `2b` 149 — all 2020 — while item `16` came out at
144, correctly 2026, because that master row is null and fell through. **A mixture per item
and per capacity, on an estimate that names no schedule anywhere.**

This is `ratesSource: 'inherited-agency'` one level down. There, values carried over from
the agency were labelled "nobody has confirmed them". Here the carrying-over left no label
at all, because a copied number and a chosen number are the same number.

**The fix (`4aadb6f`): a master cell equal to the schedule it was copied from is not an
override.** `resolveRate` compares each master value against the **UGVCL-2020** baseline —
always 2020, never the job's own schedule, because the question is "was this copied?" and
the migration copied from 2020. Comparing against the current schedule would make every copy
look like an override the moment the tender changed, which is the bug itself.

**⚠ THE TEST IS SAFE ONLY WHILE NO REAL OVERRIDES EXIST, and that is a property of today's
data rather than of the design.** A genuine override that happened to equal the 2020 figure
would be silently discarded. If an agency ever needs one it must be recorded by an
**explicit marker** — a flag saying a person typed this cell — not by a difference test.
**Do not extend the difference test; replace it.** Not built now: a mechanism for a case that
has never occurred in 1,572 cells is speculative.

### The evidence, and how strong it actually is

Across every agency and AT: **1,572 populated comparable CRGO cells, 1,555 byte-identical to
the 2020 schedule, 17 differing, ZERO genuine overrides.**

The 17 are two cells repeated — `1f@100` = **230** against the schedule's 229, and `11B@100`
= **148.99** against 149 — the `public_config` residue already recorded above. Under the fix
they resolve to 229 and 149, which is the tender figure and a correction, on ten holders:
PATEL, ZENITH, ADMIN, UPENDRA, megha transformer, GUJARAT and four ATs.

**What those 17 demonstrate is the argument for the whole change: the only cells in the
entire database that differ from the schedule are wrong by a rupee in a direction nobody
chose.** The master was never used as an override mechanism.

**⚠ AND THAT CENSUS IS CORROBORATED, NOT VERIFIED.** It holds because its 17 differing cells
matched two artefacts this audit had already recorded independently — not because the method
was checked. Two censuses in the same session returned confidently wrong numbers, and both
were caught by an implausible output rather than by review:

| wrong answer | cause |
|---|---|
| **414 differing Overhauling cells** | `SCHEDULE_ITEM_MAP` pairs master codes to Schedule-A `sr`s **for the CRGO section only**. The Overhauling section reuses codes `3`/`4`/`5`/`6` for the Schedule-B extras — tank 54/kg, conservator 54/kg, radiator 1057/1256/1452, sealing 189. Mapping it through the CRGO table compared unrelated items. The tell: a radiator table sitting where an oil-gauge glass had been looked up. |
| **4 jobs "moved" by the fix** | the before/after comparison keyed on `jobNo`, so it compared **different transformers with each other**. |

**⚠ KEYING ANYTHING ON `jobNo` COMPARES DIFFERENT TRANSFORMERS.** C1 records three `MSBT-12`
records, two `MSBT-1` and two `MSBT-10` — 59 distinct numbers across 63 jobs. **Any census
must key on document id.** Re-keyed, the real answer was 0 of 64 jobs moved, which is what a
copy resolving to the figure it copied should do.

That is the third and fourth instance of the "check that reports confidently outside its own
model" family already listed at the `public_config` entry, and both were mine.

### The propagation asymmetry — registry versus master

Rate corrections now reach agencies by **two routes with opposite behaviour**, and the
difference has caught this work twice:

| | where it lives | how a fix propagates |
|---|---|---|
| **Schedule-A / Schedule-B / radiator** | `SCHEDULES[…]` in code, selected by the AT's `scheduleId` | **instantly, to every AT on that schedule.** No republish, no re-adoption, no agency action |
| **Master sections** (CRGO overrides, the scrap row, the export skeleton) | `estimateMaster*` on the agency or AT | **a republish and every agency taking the new version.** A copy never follows the template — that is deliberate, so a live estimate cannot move under an operator |

So when the 2026 Schedule-B pages arrive, correcting `SCHEDULES['UGVCL-2026'].scheduleB`
fixes every AT on that schedule at once. Nothing needs republishing and nobody needs to click
anything. The opposite is true of anything in a master section.

**A consequence that inverted an earlier plan.** Before the copy test, the fix proposed for
the admin template form was to seed its master sections **from the chosen schedule**, so a
2026 template carried 2026 figures. **Under the copy test that is now actively wrong:** cells
seeded from 2026 would DIFFER from the 2020 baseline, be read as genuine overrides, win over
the schedule — and then not follow any future 2026 revision. Seeding from the shipped 2020
constant is correct, because those cells are recognised as copies and ignored.

Verified rather than argued: adopting the 2026 template onto AT 1819 in memory leaves every
rate at 2026 and `baseTotal` unchanged at 5,613. **The template's master sections are inert
for pricing, which is what they should be.**

---

### O61. Every estimate prints the same 2020-21 tender reference, whatever its tender

Open, found 2026-09-11 while printing G62. Not fixed.

The estimate's header prints "Order No.: ..., Dt.: ...". `SingleJobEstimateReport` takes it from
`agency.atDetails.orderNo || agency.contractAgreementNo || atMaster.orderNo`. When none of those is set,
it prints a hardcoded **`UGVCL/EE-T-1/TRANS-REP/2020-21/01/1102`**, and the date falls back separately
to **`16/04/2021`**.

- **None of the three is set anywhere:** 0 of 16 agencies, 0 of 14 ATs.
- **So every estimate in the database prints that reference.** All 74 jobs that belong to an AT do,
  on 2020 and 2026 tenders alike, and the AT's own number (`atNumber`) is never read.
- **One has left the building:** STD-1's estimate, sent 2026-09-10. It is on SAMOR's ALLOTMENT
  NO.25903 - a **UGVCL-2026** tender - and names a 2020-21 order dated 2021.

It is the sentinel shape this codebase keeps removing: a plausible value standing in for an absent
one, on a document to the DISCOM, with nothing saying it was substituted.

**It bears on O59.** The one place an estimate names its tender names the wrong one, for every tender
in the database.

**Not decided:** print the AT's number, refuse to issue an estimate with no order number, or both.

---

### O60. Copper labour coil lines price at the aluminium rate

Open, found 2026-09-11 while verifying G62. Not fixed. **No live figure is affected today.**

**The tender, both schedules:**

| Row | Copper | Aluminium |
|---|---|---|
| 12C, HV coil winding labour | 12C-a: 11/kg | 12C-b: 34/kg |
| 13C, LV coil winding labour | 13C-a: 17/kg | 13C-b: 51.75/kg (52 under 2026) |

**Why copper gets the aluminium figure:**
- **One generic row each.** The master has a single labour row per winding, `12C` and `13C`, not
  split by material.
- **It holds the aluminium figure everywhere.** Every AT's master, and the built-in default in
  `estimateData.ts`, hold 34 and 51.75.
- **The copy test misreads it.** `resolveRate` compares a master cell with the baseline of the row
  being priced. For aluminium, 34 equals 12C-b, reads as a copy, and Schedule-A prices. For copper, 34
  differs from 12C-a's 11, so it reads as a genuine override.
- **The result:** copper labour prices at 34 and 51.75, under both tenders, since an override wins
  over either schedule.

**Size:** +23/kg on HV coil weight and +34.75/kg on LV, before the AT percentage. On a 149.60 kg HV coil
that is +3,440.80.

**Live:** one copper job, which charges no labour coil line.

**The same shape as G61's S.E. hazard.** A master row standing for an item code with several tender rows
is read as an override of whichever row is being priced. The HV and LV coil rows avoid it by being
split (`12A(a)` / `12A(b)`); the labour rows are not.
- Verified on a synthetic job with no master anywhere, on 8e2e5e7 and after G62 alike.
- Since G62 the line prints `12C-a` beside 34, so a careful reader can see it.

**Not decided:** split the master's labour rows by material, or make the copy test recognise a cell
equal to any of the code's variant rows as a copy.

---

### O59. Eight tenders price from the 2020 schedule on an inference, and nothing recorded can confirm it

Open, 2026-09-11. Nothing changed.

`scripts/admin/backfill-schedule-id.js` stamped every AT then in the database UGVCL-2020 except A/T 1819,
on the reasoning that they predate 1819's date, 07.09.2026. That was an inference from names and
dates. **Nothing in the data records which Schedule-A a tender was awarded under**, and a tender
priced from the wrong one carries the wrong figure on every line of every document, not only the coils.

**Which ATs carry which schedule** - read-only census, 2026-09-11:

| Agency | AT | Schedule | Its source | Start | Jobs | Issued | Priced under 2026 instead |
|---|---|---|---|---|---|---|---|
| ADMIN | 2026_27 | 2020 | none recorded (backfill) | 2026-08-15 | 20 | 1 challan | -32,368.05 on 14 jobs |
| suchit | 2026-27 | 2020 | none recorded (backfill) | 2026-08-22 | 0 | - | - |
| MEGHA | AT 26-27 | 2020 | none recorded (backfill) | 2026-08-01 | 35 | 27 challans | +6,551.47 on 31 jobs |
| UPENDRA | 24-25 | 2020 | none recorded (backfill) | 2024-08-18 | 0 | - | - |
| UPENDRA | AT2026-27 | 2020 | none recorded (backfill) | 2026-08-22 | 0 | - | - |
| PATEL ELECTRICALS | .../2020-21/1087 | 2020 | none recorded (backfill) | 2026-09-07 | 5 | - | none price cleanly both ways; 2 price under 2020 and block under 2026 |
| GUJARAT ENERGY TRANSMISSION | 2020-21/01/1049 | 2020 | none recorded (backfill) | 2021-04-16 | 4 | - | +255.24 on 4 jobs |
| AARATI | 2026-27 (closed) | 2020 | none recorded (backfill) | 2026-08-22 | 1 | - | - |
| ZENITH | .../2026-28/01/AT/1819 | 2026 | backfill, held back as 1819 itself | 2026-09-07 | 0 | - | - |
| ADMIN | 2026-28/AT/1819 | 2026 | rate template | 2026-09-07 | 0 | - | - |
| SAMOR | ALLOTMENT NO.25903 (closed) | 2026 | rate template | 2026-09-07 | 9 | 2 | (under 2020: -3,688.30) |
| SAMOR | AT-2026-28 | 2026 | rate template | 2026-09-07 | 0 | - | - |
| SAMOR | .../2026-28/01/AT/1808 | 2026 | rate template | 2026-09-07 | 0 | - | - |
| megha transformer | 2026-28 | 2026 | rate template | 2026-09-07 | 0 | - | - |

"Priced under 2026 instead" reprices each AT's live jobs with the real builder, counting only jobs that
price cleanly both ways. The figure is the final amount, including the AT percentage.
- **ADMIN's -32,368.05 is mostly a pricing-model change.** Under 2026, Amorphous and Wound Core are
  itemised, not fixed-rate: its four Amorphous jobs move -33,058.27 and its Wound Core job -1,850.37,
  while its CRGO jobs rise 2,540.59.
- **MEGHA:** CRGO +1,564.67, Amorphous +3,217.76, Wound Core +1,769.04.
- **Every issued mark on the 2020 ATs is a delivery challan**, dated 13-23 August 2026. No estimate or bill
  on them has been issued, and all of those challans predate the schedule-confirmation gate (24fb475,
  2026-09-07 23:41 IST).

**Is any on the wrong one? The data cannot say.**
- **Consistent with 2020:** GUJARAT ENERGY TRANSMISSION 1049 - a 2020-21 tender number and a 2021 start
  date - and UPENDRA 24-25, starting 2024.
- **Unknown:** the five ATs named by year - ADMIN 2026_27, suchit 2026-27, MEGHA AT 26-27, UPENDRA AT2026-27,
  AARATI 2026-27. The name is a year, not an A/T number. Their start dates, 1-22 August 2026, precede
  07.09.2026, but a start date is typed by the operator, not taken from the award.
- **Self-contradictory:** PATEL 1087. Its number reads 2020-21, but its start date and creation are
  07.09.2026 - 1819's own date - while its jobs' MR dates are 20 August.

**What does not settle it, and why:**
- **Master cells.** Every AT's cells match the 2020 schedule wherever they hold a value - including the six
  2026 ATs, whose templates carry 2020 figures that the copy test defers to the tender's schedule. The
  cells record a copy, not an award.
- **The AT percentage.** The 2020 ATs hold 4 (suchit 5); the 2026 ATs hold 7, which is 1819's accepted 7.00%
  above. A percentage is an agency's accepted bid, not a schedule marker. It can only corroborate -
  though a 4% AT whose paper says 7.00% above is wrong on that field whatever its schedule.
- **What the app does not record at all:** an award date, a tender (NIT) reference separate from the AT's
  name, and which schedule edition the paper cites.

**What to check on paper, per AT:**
1. **The A/T letter's number and date.** For the five year-named ATs, the real A/T number is not in the
   app.
2. **The schedule of rates the A/T cites or annexes.** The quickest test is a cell that moved: Schedule-A
   12A-b (HT coil, aluminium, without S.E.) is 163 under 2020 and 165 under 2026; 12A-b1 is 213 against 215.
3. **Clause 2.0's accepted percentage**, against the percentage stored on the AT.

**The app already asks the question once, at the first estimate sent** (read in code, not exercised):
none of the eight has `scheduleConfirmedAt`, so the send path stops for confirmation and records who
confirmed and when. That records a person's answer; it does not check the paper for them.

---

### O58. A signed inspection sheet can lose its signature block, and nothing says so

Open, found 2026-09-11 while printing G61's column. Not started.

`PrintableA4Page`'s body is `flex-1 overflow-hidden` (`LetterheadHeader.tsx:243`). Whatever does not fit
between the letterhead's header and footer is cut off:
- not moved to another page;
- not flagged on screen or on paper.

The preview is cut the same way, so an operator who looks for the signatures can see they are missing,
but nothing points there.

**Measured on the internal inspection sheet** - MR 85558, printed through `triggerUniversalPrint` in
headless Chrome, on a full-A4 letterhead with a 64mm header and a 25mm footer:

| Nine rows of | Spare under the table | The last sheet's signature block |
|---|---|---|
| one line (today's data) | 130.1px (~34mm) | visible |
| two lines (a make that wraps) | 27.6px (~7mm) | **cut off by 43.8px (~12mm)**: Inspected by, Executive Engineer and the agency's signatory are all gone |

It is identical before and after G61. It takes a full last sheet (`CHUNK_SIZE = 9`) whose rows wrap -
a long make or serial on each - and the signature block sits only on the last sheet.

**⚠ THE CHUNK_SIZE MODEL IS WRONG ON A LETTERHEAD.** G20 measured ~115mm spare and called the sheet
two-thirds empty, and the comment above `CHUNK_SIZE` repeated it. That figure did not account for a
letterhead's header and footer. On this one the spare is about a third of it with one-line rows, and
almost nothing with two-line rows. The comment now says so.

**The shape is wider than this sheet.** Every document built on `PrintableA4Page` has the same body.
Which others can overflow, on which letterheads, is not measured.

**Not decided:**
- paginating by measured height rather than a row count;
- fewer rows a sheet when a letterhead is set;
- a visible warning when anything is cut off.

Each is its own change.

**The estimate is cut off too, with no letterhead at all** - found printing G62. SU-5's itemised
estimate has 28 lines on one page and no letterhead, and it loses what sits below its totals:
- the Final Amount row's box is clipped;
- the signature block - "For, <DISCOM>" and "For, <agency>" - does not print.

It is identical on 8e2e5e7 and after G62: 14 elements cut off, measured against the clipping container
and seen in the print. `layoutEstimatePages` kept all 28 lines on one page; why its budget allowed that
is not investigated. SU-5 has no issued document.

**Same letterhead, a different defect.** MEGHA's letterhead image carries its own "For MSD Corporation
/ Authorized Signatory" and "Page 1 of 1" inside the picture, above the 25mm footer the agency set.
- They print through the table's lower rows.
- The report reads "Page 1 of 1" on each of two sheets.

That comes from the agency's image and its footer setting; nothing in the app compares the two.

---

### O57. ONE IMPORT EDGE is why pricing cannot be tested - estimateCalc reaching into a component

Open, and deliberately not started. It is about 1,100 lines of movement through the code that prices
every estimate and bill, and G60's tests do not need it, so it is its own decision on its own day.

> **THE CAUSE IS ONE IMPORT.** `src/lib/estimateCalc.ts` imports `buildSingleJobEstimateData` and
> `classifyCoreType` from the component `src/components/SingleJobEstimateReport.tsx`.
>
> **That single edge drags 52 modules, 35 of them from 19 packages (3.7 MB), into anything that
> touches pricing** - React, react-router, Firebase (app, auth, Firestore, Functions) and pdf.js - **and
> makes pricing unloadable under Node.** Importing `estimateCalc` fails immediately with
> `DOMMatrix is not defined`, which is pdf.js.

Measured with esbuild's metafile, not estimated. **Every one of those packages arrives through that
edge.** `estimateCalc`'s other imports - `ugvclSchedules`, `estimateData` and `scheduleItemMap` - pull
in no package at all. `estimateMasterHealth` inherits the identical 52 modules, because it imports
`estimateCalc` for one constant.

From the component, the chain branches three ways:
- React and react-router, for the component itself;
- `LetterheadHeader` → `letterheadUtils` → pdf.js;
- `AgencyContext` → Firebase, for `getAtPercentage` and `getEstimateMasterForCore`. Firebase
  initialises the app as soon as that file loads.

### THE ONLY IMPORT CYCLE IN THE APP RUNS THROUGH THE SAME EDGE

This is worth knowing independently of testability: it sits in the pricing path, and nothing marks
it. Grouping the app's 80 modules (everything reachable from `src/main.tsx`) by which can reach each
other finds **exactly one cyclic group - four modules - and both of its cycles pass through this
edge**:
- `estimateCalc` → `SingleJobEstimateReport` → `estimateCalc`, because the component takes
  `resolveScrapCharge` back;
- `AgencyContext` → `estimateMasterHealth` → `estimateCalc` → `SingleJobEstimateReport` →
  `AgencyContext`.

**Latent, not live.** In all four modules, every import from a cycle partner is used only inside a
function, never while the module loads - checked with the TypeScript parser. So load order does not
matter today.

It will matter the day any of the four reads a partner's export at module level - for example, a
constant built from `SCRAP_ITEM_CODE_BY_CORE_CLASS` at the top of `estimateMasterHealth`. That read
would happen before the export is initialised, and what follows depends on how the bundler orders
the modules.

### IF THE EDGE IS CUT, THE REST IS SMALL

**The fix that matters is moving the estimate builder out of the component** into a lib module. That
is `buildSingleJobEstimateData` - 1,030 lines, with no React and no JSX - plus what only it uses:
- `classifyCoreType`, `CoreClass`, `classifyWindingMaterial`, `windingMaterialError`;
- `scheduleBCandidates`, `findScheduleBEntry`;
- `MASTER_BASELINE_SCHEDULE_ID`, `ScheduleLookup`;
- its three result types.

The print layout, the section labels and every React import stay with the component. Two other
components import from it only for `classifyCoreType`. **That move alone takes React, react-router
and pdf.js off the pricing path**, because they belong to the component, not to the builder.

It does not finish the job by itself, and the entry should not pretend otherwise. Two follow-ons,
both small:
1. **Firebase travels with the builder**, because the builder itself imports `getAtPercentage` and
   `getEstimateMasterForCore` from `AgencyContext`. Move those two functions (about 170 lines) into a
   module with no Firebase import, and re-export them from `AgencyContext` so existing importers do
   not change.
   - `getAtPercentage` is pure.
   - **`getEstimateMasterForCore` is not quite.** It falls back to a module-level cache,
     `cachedGlobalDefaultEstimateMaster`, which the provider fills and `localStorage` seeds when the
     file loads. Decide whether that state moves with it or callers pass the default in. A test that
     inherits a cache set by whichever test ran first would be order-dependent.
2. **The cycles re-form unless two things are placed deliberately:**
   - the builder uses `resolveScrapCharge` from `estimateCalc`, which will import the builder - so that
     function has to live where both can import it without importing each other;
   - `estimateMasterHealth` should take `SCRAP_ITEM_CODE_BY_CORE_CLASS` from wherever it can reach
     without passing through `estimateCalc`.

**Size and risk.** About 1,100 lines move, almost all verbatim, into two new modules, plus import
lines in fewer than ten files. This prices every estimate and bill, so verify it the way G57's
normaliser move was verified - a mechanical diff proving the moved text unchanged - and with
`scripts/admin/pricing-model-regression.js`, which already reprices live jobs against a baseline.
Re-run the cycle grouping afterwards: the move is done when it finds no cyclic group.

---

### O56. The unsaved-edits flag reports edits that do not exist - and the screen acts on it

> **FIXED in G57**, together with the first two leads below, which shared its cause. The third
> lead, the publish guard, is a different cause and is G58. G57 also found what this entry did not:
> Cancel restored the agency's rows, and the screen and the tender shared objects.

**A defect in its own right, not a step in O55.** The check is wrong whether or not a warning is
ever built on it.

`editedSections` is meant to say "the operator changed this section since it was loaded". It is set
by `markEdited`, which also adds the section to `touchedRef` - the list of sections changed this
session, which survives a save. The flag is cleared only by a reload, and the list only by changing
agency. Two paths leave them claiming an edit that does not exist:

- **Cancel - certain.** `handleCancelSection` re-seeds the section from storage and clears neither.
  This predates G56.
- **A save that leaves the stored rows as they were - possible.** Edit a cell, type the original
  value back, and save: if `loadKey` does not change, nothing reloads and the flag stays. Before
  G56, every save replaced the context object and the reload cleared the flag whatever was written.
  Whether `loadKey` changes here depends on key order, because it compares with `JSON.stringify`
  (see the last note below).

What reads the false "edited" today, all in `EstimateMaster.tsx`, taking a cancelled section:

| Where | What it does |
|---|---|
| The stored-vs-showing band (`cause`) | Says **"Showing your N edited row(s) - not saved"** and **"Nothing is written until you click Save."** The true cause is `normalised` - rows filled in for display - whose band would name the rows not in storage instead. |
| `publishPlanFor` | Treats the section as edited, so it publishes the rows **on screen** rather than the rows **stored**. The confirmation reads **"Publishing your N edited row(s)"**, including rows the normaliser added that nobody stored or chose. |
| "Apply to my agencies" (`buildSectionPayload`) | Sends the cancelled section to the other ATs. Its own refusal - "Nothing to apply ... No section has been changed" - exists to stop exactly that kind of write, and the stale list gets past it. The modal still shows override counts before anything is written. |

**A signal of change raised by an act, instead of by a difference in the data, is trusted until it
is wrong and ignored after.** This is the same shape as the template version that bumped on every
republish, including a typo in the notes (`publishAtTemplate`, `AgencyContext.tsx`, "THE VERSION
BUMPS ONLY WHEN THE RATES MOVE"). Adopters were prompted to take updates that changed nothing, which
teaches them to dismiss the one prompt that will matter. A confirm built on this flag would do the
same to operators. That fix stopped trusting the act and compared the data (`sectionsDiffer`).

**The fix - recorded, not built, not decided:**
- **Minimal.** Clear the section's flag in `handleCancelSection` and after a successful save. Remove
  a cancelled section from `touchedRef` unless it was saved earlier this session. That last clause is
  where the minimal fix gets fiddly: the list has to remember saves separately from pending edits.
- **Derived - recommended.** Do what the version-bump fix did. Keep each section's rows as loaded,
  after normalising, and call a section edited when the screen differs from that snapshot. Compare
  the way `lib/compareSections.ts` does, never with `JSON.stringify`. Cancel, a typed-back cell and a
  no-change save are then right by construction, with nothing to remember to clear. `touchedRef`
  becomes "saved this session, or differs now".

**Noticed while recording this, NOT verified:**
- **Saving one section may reload all five.** "Save Rates" is per section, but `loadKey` covers every
  section's rows, so a save that changes one section re-seeds all five grids - and would discard
  unsaved edits in the other four. If so, this predates G56, which kept the reload on a save of rates.
- **`loadKey` compares with `JSON.stringify`,** which the version-bump comment warns against, because
  Firestore does not preserve key order. Its failure there is an extra reload, not a missed one: rows
  replaced by equal content in a different key order would reload and clear the flag. That is safe
  for saves on other tabs, which do not touch the rate arrays.
- **The template publish guard checks the touched list when it is non-empty,** and all five sections
  otherwise, while a template carries all five. A stale touched list would narrow what the guard
  checks.

---

### O55. Switching tender in Estimate Master discards unsaved rate edits, and says nothing

Queued, not built. Found during G56; it predates G56.

The loader is keyed on the tender (`loadKey`), so anything that changes `selectedAt` re-seeds all
five grids from storage and clears `editedSections`. **Discarding is correct.** A tender switch
changes what the editor is editing, and edits typed against one schedule carried onto another
would be worse. **The defect is that it happens without a word.** The screen's only two
`confirm()`s guard deleting a row and adopting a template.

It splits into two halves of different size, and different direction.

**Half 1 - the screen's own controls. Small; do it when `EstimateMaster.tsx` is next open.**

Covers the "Rates for" selector (`setSelectedAtId`) and links carrying `at=` (the `?at=` effect).

**Unblocked - O56 is fixed (G57).** The unsaved check this warning rests on is now a comparison:
`editedNow`, the screen against what was loaded. A confirm built on it fires only on a real
difference.

Half 1 is two changes:
1. **Confirm in the selector's `onChange`** when any section is unsaved, naming the sections and
   both tenders. Cancel keeps the current selection.
2. **The `at=` path runs in an effect, where a confirm is the wrong tool** - it would fire on
   arrival, not on a click. With sections unsaved it should leave the selection alone and say the
   link asked for AT X; the operator switches with the selector, which confirms.

**Half 2 - the active-AT controls. Larger; not built.**

These change the active AT, which Estimate Master follows while no tender has been picked in its
own selector (`selectedAt = chosen || globalActiveAtMaster || ...`):
- the sidebar tender selector (`AppLayout`);
- the AT selector above the Agency Settings tabs (`AgencySettings`);
- "Book jobs against this AT", and creating a tender (`AtSettings`).

**Route A - lift the unsaved state into context, so those controls can confirm. Decided against.**
It puts Estimate Master's editing state into the sidebar and two other screens: three components
outside the editor learning its internals, to guard a rare case. That is the wrong direction for
the size of the problem.

**Route B - stop following the active AT once there are edits. PREFERRED.** It is about one line,
no state crosses a component boundary, and the existing divergence note already handles the
divergence it creates. Its cost is smaller than Route A's. When any section first reads edited
(`editedNow`, G57), pin the selection if none was chosen: `setSelectedAtId(selectedAt.id)`.
After that, an active-AT change elsewhere no longer changes what this screen edits. The edits
survive, and the existing divergence note (`divergedFromActive`) says the screen and the app now
point at different tenders. Nothing outside `EstimateMaster` changes: about one line, plus a test.
- **Cost:** an operator who switches the active AT *meaning* to see the other tender's rates stays
  on the pinned one until they use the selector.
- **Why that is acceptable:** it is visible, not silent, and it matches F79's rule that this
  selector changes only what the screen shows.
- **Depends on Half 1, and so on O56.** The selector's confirm is how a pinned operator gets off
  the pinned tender.

**Uncovered by both routes: changing agency.** It also discards unsaved rate edits, silently.
Route A, as scoped, lifts state only to the active-AT controls. Route B cannot apply: the edits
belong to one agency's tender, and pinning a tender does not survive the agency being replaced.
Recorded; no route chosen.

---

### O54. The Admin Panel has no `?tab=` deep link, and nothing yet needs one

Recorded as available rather than missing. The estimate screen gained `?tab=sent|approvals`
this session because the Dashboard's follow-up tiles needed to land on a specific stage.
**Nothing links into the Admin Panel at all** - the sidebar entry is the only way in - so
there is no caller to serve and building it now would be speculative.

If a link ever wants one, `EstimateGenerate`'s is the shape to copy: read `?tab=` once on
mount, set a STARTING tab rather than a pinned one, and do not rewrite the URL under the
operator afterwards.

---

### O53. Razorpay settings and maintenance mode are stored and read by nothing

Two settings screens write `system_config` and no code anywhere consults what they write.

**Razorpay** (`system_config/razorpay`): key id, secret, annual fee, enabled, test mode.
There is no Razorpay integration in the app. The only other occurrences of the word are
prose in `SupportTickets`. So the "enabled" toggle enables nothing and no payment is taken
or checked.

**Maintenance mode** (`system_config/general`): `maintenanceMode` appears in exactly two
places - the panel that writes it and `types/admin.ts`. Switching it on records a flag and
does not lock anyone out, show a banner, or change what any user sees.

**RELABELLED, NOT BUILT.** Both headings now say "not yet connected" / "not yet enforced"
with a line naming what does not happen. Neither is urgent and neither was mistaken for a
guarantee - unlike the RBAC screen, which was (O52).

**What making each real would take.** Razorpay: the integration itself - checkout, webhook,
a record of what was paid, and a decision about where subscription state lives, which G1
already says is NOT the customer's agency document. Maintenance mode: a read of
`system_config/general` on app load and a gate in `AppLayout` ahead of the router, plus a
decision about whether the super admin is exempt (they must be, or the switch cannot be
turned off from inside the app).

---

### O52. The RBAC screen recorded roles that grant and restrict nothing

**The dangerous one of the three, because it read as a security control.** The heading was
"User Role & RBAC Permissions Management" and the screen assigns Super Admin, Manager,
Operator and Viewer with permissions. **Nothing outside the Admin Panel reads `user_roles`.**

Access is decided by `isSuperAdmin()` in `firestore.rules`, which tests the signed-in email,
and by nothing else. So someone could reasonably assign a *restricted* role to a user
believing it takes effect, and it would not - the difference between a control that is
missing and one that appears to be there is that only the second gets relied on.

**RELABELLED to "User role records"**, with a notice saying plainly that the records do not
grant or restrict anything, that access comes from the super-admin email in the rules, and
that assigning a restricted role does not limit that user.

**What making it real would take:** `firestore.rules` reading `user_roles` - a
`get(/databases/$(database)/documents/user_roles/$(request.auth.uid))` in the permission
helpers - which costs a document read on every rule evaluation and needs a decision about
what each role may do per collection. That is a security design task, not a screen change,
which is why it is recorded rather than attempted.

---

### O51. The Dashboard's follow-up counts have no view to link to, and no data to show yet

**Two things recorded together because they are the same shape: a count that is correct and
currently useless.**

**1. FOUR OF THE SIX FIGURES CANNOT LINK ANYWHERE.** The Estimate / Bill follow-up tiles show
six counts. Two link - `EstimateGenerate` already has `sent` and `approvals` tabs, and now
reads `?tab=` to land on one. The other four have no destination that exists:

  - **Pending approval** needs a SENT-BUT-UNAPPROVED view on `EstimateGenerate`. Its `sent`
    tab shows everything sent, approved or not.
  - **Bills sent / Payments received / Payment pending** need sent, paid and pending views on
    `BillingSystem`, which has none. It already has `useSearchParams` and reads `?mr=`, so
    the plumbing is there and the filter is not.

They were left as plain figures deliberately. A tile that navigates to an unfiltered list
promises a work list and delivers everything, which is worse than one that does not
navigate - and inventing filters on two screens as a side effect of adding a Dashboard tile
is the wrong shape of change. Worth doing when those screens are next opened for their own
reasons.

**2. THE ONLY JOB WITH FOLLOW-UP DATA IS A GP JOB, WHICH SHOULD HAVE NONE.**

    MSBT-12   repairType GP   estimateStatus Sent   billNo BILL/1   paymentStatus Paid
              atId NONE

A guarantee-period repair is done under guarantee at no cost: it is never estimated and never
billed (`BillingSystem:350` excludes GP from every bill). MSBT-12 carries the entire chain -
sent, approved, billed, paid - and it is also the one job holding an `approvedAmount`, and
one of three with no `atId` at all.

⚠ **SO ALL SIX COUNTS READ ZERO**, correctly. The tiles exclude GP, and the single job that
would otherwise populate them is GP. That is the counts working, not failing - but it means
the feature has never been exercised against real data and its first real numbers will appear
only when a non-GP job is actually sent.

**Which of two things this is, is not settled here:** either MSBT-12 is test data typed to
exercise the estimate and billing paths - the same explanation that turned out to be true of
the per-core-type percentages (O50) - or a GP job really was estimated and billed against the
tender's terms. The first is likely and harmless. The second would be a billing error.
Checking it needs someone who knows what MSBT-12 actually was.

---

### O50. FOUND AND DISSOLVED — LSTC took CRGO's percentage by accident of branch ordering

**Recorded although it no longer exists, because of HOW it stopped existing.** Nobody
reported it, nobody fixed it, and it was closed as a side effect of collapsing three fields
to one. A gap that dissolves without being noticed is worth a note, or the next one of the
same shape will not be looked for either.

**What it was.** `getAtPercentageForCore` tested Amorphous, then Wound Core, then fell to an
`else` returning `atPercentageCRGO`. LSTC is a core type this app knows — `AgencySettings`
collects a `prefixLSTC`, `AtAllotments` resolves `coreType === 'LSTC'` — but it had **no
percentage field of its own**. So an LSTC job did not take CRGO's percentage because anyone
decided it should; it took it because LSTC failed two `includes()` tests and landed in the
final branch. The value was plausible, the mechanism was accidental, and nothing on the
finished document would have named which percentage was used.

⚠ **AND `classifyCoreType` DOES NOT RETURN LSTC AT ALL** — it returns only
`CRGO | OH | AMORPHOUS | WOUND_CORE`. So LSTC is a prefix and an allotment key but not a
pricing class, which is a second, separate inconsistency in the same area and is NOT closed
by this. If LSTC work is ever priced differently from CRGO, that is where it will surface.

**How it dissolved.** A/T 1819 clause 2.0 quotes ONE accepted percentage for every core type,
so the three fields collapsed to one. With one field there is nothing for a core type to be
missing from, and no branch order to fall through. The fallback chain
(`per-core-type → atPercentage → 4`) did not merely stop being used — it ceased to exist.

**The hardcoded default went with it.** `getAtPercentageForCore(null)` used to return **4**.
That is the sentinel shape recorded elsewhere in this file: a plausible figure standing in
for an absent one, multiplying every line of an estimate. It now returns null and the
builder raises a missing-input error, so a job whose tender cannot be found withholds its
total instead of quietly pricing at 4% above. Three live jobs with no AT changed behaviour
because of this, and that is the intended change.

**The evidence for three fields was test data.** Live ATs carried 4/-8/-4 and 5/-2/4, which
read as proof that tenders price per core type. They were typed at random to exercise the
estimate and billing paths. The real document gives one figure, and both ATs on it carried
7/7/7 — so the collapse was lossless exactly where it mattered.

---

### O49. Any job can be billed, whatever stage its estimate reached — a contractual gap

**`BillingSystem` never reads `estimateStatus` or `estimateApprovalStatus`.** Confirmed by
grep: neither field appears anywhere in the file. `billableJobs` filters GP jobs and nothing
else. So a job whose estimate was **never generated, never sent and never approved** reaches
a bill and prices normally, and there is no point in the flow at which that is questioned.

**THIS IS A CONTRACTUAL GAP, NOT ONLY A WORKFLOW ONE.** Clause 4.0 of A/T 1819 is explicit:
the transformer must not be opened before UGVCL's representative attends, and **work starts
only after estimate approval**. A bill for a job whose estimate was never approved is
therefore claiming for work that, under the tender, should not have begun. The document is
not merely out of order — it asserts something the contract forbids.

Clause 11.0 compounds it: payment follows a bill "submitted on completion of each work",
with a test certificate, and the repairer certifies on that bill that the materials billed
were actually fitted. A bill raised ahead of approval carries that certification about work
the tender had not authorised.

**How it surfaced.** SU-5 was found billing 9,077.15 against a recorded consent of 8,716.00.
The immediate cause was that its estimate had never been sent or approved, so
`approvedAmount` was empty and `calculateJobTotal` fell through to a recomputation. Fixing
that case revealed the general one: **SU-5 could reach a bill at all only because nothing
checks the stage.** The consent made it visible; the gap was always there.

**THE CONSENT FIX IS SCOPED DELIBERATELY AND DOES NOT CLOSE THIS.** It refuses only a job
carrying an ACTIVE CONSENT with no `approvedAmount` — 1 job in live data. The ordinary case,
55 of 64, bills exactly as before. Closing the general case would refuse every job whose
estimate is not approved, which changes how every MR is worked: it would block bills that
are raised today, and it presumes the app's approval record is complete enough to gate on,
which has never been tested. **That needs its own decision, not a side effect of a
consent bug.**

**What settling it requires, in the order the questions arise:**

1. Is `estimateApprovalStatus === 'Approved'` reliably recorded in practice, or is it a
   field operators skip? One live job carries an `approvedAmount`; that is not enough to
   judge from.
2. Does the gate refuse, or warn? A refusal on an unapproved job is the honest reading of
   Clause 4.0. A warning is what a yard with a backlog of unrecorded approvals can actually
   work with.
3. Whichever it is, existing jobs need a position — grandfathered by date, or blocked
   until their approvals are entered retrospectively.

**Related.** O29, now closed, made `approvedAmount` load-bearing for the first time; this is
the question of whether its ABSENCE should mean anything. Also G-series on the billing gate
for `rateErrors`, which is the same shape of refusal already accepted here: the bill declines
to assert what it has no authority to assert.

---

### O48. A scrapped Overhauling job has no item code, because the OH master has no scrap row

**Found while making the scrap code follow the pricing model, and deliberately not guessed.**

`SCRAP_ITEM_CODE_BY_CORE_CLASS` maps CRGO to '22' and Amorphous / Wound Core to '0'. It has
no OH entry, so `scrapItemCodeForJob` returns null for an Overhauling job and
`resolveScrapCharge` blocks with "No scrap charge item code is mapped for core type…".

**That is not an oversight in the map — the row does not exist.** The Overhauling master
holds five codes: `7, 3, 4, 5, 6`. There is no inspection-and-dismantling row in it. Code
'6' is "Rate for sealing of uneconomical unit by welding at six places", which is a
different charge for a different situation (see O45).

**Why it was not given a code anyway.** Mapping OH to '22' or '0' would point it at a row in
a section it does not read — `getEstimateMasterForCore` sends OH to the Overhauling master —
so the lookup would fail exactly as it does now, but with a message naming the wrong
section. A blocking refusal that says "nothing is mapped" is more useful than one that says
"'22' is missing", because the first is true and the second sends someone to add a row to
the wrong screen.

**Latent, not live.** One OH job exists (`OH21 IS-1`) and it is not scrap. Seven scrap jobs
exist and none is OH. So nothing is blocked today.

**What settles it:** whether the tender pays anything for a scrapped Overhauling unit at
all. Clause 35.0 says "for uneconomical units, no repair charges are payable" and pays
Rs 500 for the inspection; whether a scrapped OH unit is that case, the E.E.(TR) scrap case
that codes '22' and '0' describe, or neither, is not settled by A/T 1819. Related to O45.

---

### O47. The 5% oil filtration loss is credited on guarantee-period jobs, which the tender disallows

**A wrong number, not a silence — which is why it is separate from O46.**

Clause 27.0 of A/T 1819 allows a maximum **5% loss** towards filtration, impregnation and
wastage for oil filled into failed transformers, and then disallows it in **two** cases:

> No filtration or impregnation loss allowed for transformers failed in guarantee period,
> or where fresh oil is given.

**The app handles the fresh-oil case and not the GP case.** `OilInward.tsx:356` and `:371`
set `filtrationLossPercent: formData.oilType === "Fresh" ? 0 : 5`, which is the second
exception correctly applied. Three other sites apply 5% unconditionally, with no test of
either exception:

```
oilBalance.ts:165   return lessOil + oilRecd * 0.05;
OilInward.tsx:314   return gross - gross * 0.05;
OilInward.tsx:476   const filterLoss = oilRecd * 0.05;
```

`isGpJob()` has existed in `estimateCalc.ts:22` since the GP billing work and is called
from nowhere in the oil path.

**MEASURED EXPOSURE, not estimated.** Of 64 live jobs, 6 are GP. Three of those carry a
STORED `netShortage` on the inspection, and `jobOilShortage` returns a stored value
untouched — so the 5% is never applied to them. The other three fall through to the
computed branch:

```
MSBT-10    MEGHA   200 KVA   cap 323  less 0    16.15 L
MSBT-6     MEGHA    63 KVA   cap 240  less 0    12.00 L
MSBT-112   MEGHA    63 KVA   cap 240  less 0    12.00 L
                                       total    40.15 L
```

**40.15 litres credited across three jobs that the tender says get none.** All three are
MEGHA, all under a 2020 AT. The `oilTransactions` collection holds one document and it is
not linked to a job, so the transaction path contributes nothing today — the whole exposure
is through `jobOilShortage`.

⚠ **THE STORED-VALUE BRANCH IS WHY THIS IS SMALL AND WHY IT WILL GROW.** Half the GP jobs
escape only because someone typed a `netShortage` on the inspection, not because of any
rule. Every GP job whose inspection omits that field takes the 5%, so the exposure tracks
how consistently a field gets filled in.

**Fix shape when it is built:** `jobOilShortage` and both `OilInward` computations take the
job and consult `isGpJob`, in one predicate rather than three copies of the rule. The fresh-oil
test already in `OilInward` should move into the same predicate so the two exceptions are
stated once — they are one rule in the tender and are currently one-and-a-half rules in
three places.

---

### O46. The A/T's contractual obligations the app is silent on — seven, recorded together

**One entry, not seven, because they share a shape.** These are not defects in what the
app does; they are parts of the tender it does not model at all. A defect produces a wrong
number. Silence produces no number, and the operator is left to satisfy the clause by hand
without the app either helping or hindering. Splitting them into seven entries would make
the app look seven times more broken than it is, and would hide the one fact that matters
about the group: none of them has ever been attempted.

Read from A/T 1819 (`1819AT.md`), but almost all of these are standing UGVCL terms rather
than 2026 novelties, so they apply to the 2020 tender's jobs too.

1. **Guarantee months are free text on a signed certificate.** `BillingSystem.tsx:125`
   holds `certMonthsText` as `useState('Twelve/Eighteen')`, printed at `:3159` into "the
   above Transformers are guaranteed by ___ months". Clause 38.2 is determinate: 18 months
   for 11 KV CRGO and for 11/22 KV amorphous, 12 for 22 KV CRGO, 6 for SDT/PAT. The app
   holds voltage class and core type and could compute it. A bill mixing 11 KV and 22 KV
   jobs cannot be right with one figure either way. Clause 14.0 adds that the OUTAGE period
   extends the guarantee, and clause 20.0 that it runs from the DISPATCH date — neither is
   computed.

2. **Repair count is not stored anywhere.** No `repairCount` field exists. Clause 20.0
   requires it on the welded nameplate (item 9) and as a painted colour strip (1st yellow,
   2nd white, 3rd red, 4th blue); clause 31(a) makes it change the loss tolerance — no
   tolerance on a first repair of 5-100 KVA, +10% on second and subsequent. ⚠ IT CANNOT BE
   DERIVED FROM THIS APP'S DATA: it counts repairs across the transformer's whole life,
   including repairs by other agencies under earlier tenders. It has to be entered.

3. **Penalties are not modelled.** Clause 37.0: 30 days from estimate approval (OGP) or
   receipt (GP), a 15-day notice, then 1/2% per week on the repairing cost — 45 days
   effective. The load-bearing qualifier is "for transformers with no oil pending to issue
   to the agency": THE CLOCK DOES NOT RUN WHILE THE DIVISION OWES OIL. The app already
   tracks oil per division, so it holds half the input. The same clause requires the
   estimate within 2 DAYS of joint inspection; the app has both dates and never compares
   them.

4. **Clause 46.0 has no validation.** "No transformer shall be converted from copper
   winding to aluminium winding." Internal inspection records winding type; nothing compares
   received against delivered. The consequence in the tender is contract cancellation.

5. **Clause 45.0's three recoveries.** A GP failure scrapped for core damage recovers the
   FULL last repairing bill; after six months from installation, NOTHING; if UGVCL finds the
   core or coils disturbed by the agency, 50% of the cost of a new transformer. Three
   different amounts selected by two facts. None is modelled.

6. **The Rs 275 GP transport recovery** (clauses 10.0 / 36.0), a lump sum per transformer
   recovered against to-and-fro transport on guarantee-period failures.

7. **The test certificate is not a precondition on the bill.** Clause 11.0: "No payment
   without test certificate", and the repairer must certify on the bill that the materials
   billed were actually fitted. No such gate exists in `BillingSystem`.

**What these have in common, and why it is worth one entry.** Every one is an obligation
with a consequence attached — cancellation, recovery, or non-payment — and every one is
currently carried entirely in somebody's head. The app's existing gates (rate errors, the
allotment refusal, the circle-limit check) all guard against producing a WRONG DOCUMENT.
None of these seven is about a document being wrong; they are about the contract being
breached while every document looks perfect. That is a different class of risk and the app
has not been built for it at all.

**Not proposed for building.** Recorded so the gap is a known one rather than a discovery.

---

### O45. Uneconomical units and scrap may be two different Rs 500 payments

Clause 35.0 pays **Rs 500 for inspection of uneconomical units**, and says that for such
units **no repair charges are payable** — the repairer reseals by tack welding at six
places and reassembles the internals in position first.

The app has one Rs 500 flat charge: the scrap "inspection & dismantling charges of damaged
transformer declared as scrap by E.E. (TR)", item code `22` for CRGO and `0` for the
fixed-rate sections (`estimateCalc.ts:38-42`). That one cites E.E.(TR) declaring scrap,
which is clause 4.0's ">30% of new cost" route.

**Uneconomical and scrap are not obviously the same state.** Schedule-A also prices item 6,
"sealing of uneconomical", at 312 — so an uneconomical unit does attract at least one
payable line, which sits oddly beside "no repair charges are payable". Whether an
uneconomical unit should bill Rs 500 + 312, or Rs 500 only, or the same single scrap line
the app already has, is not settled by the document.

**Not a defect yet — an unanswered question.** Recorded because the app currently cannot
express the difference, so if they ARE two states, no existing job is recorded as the
second one and the distinction cannot be recovered later from the data.

---

### O44. A deleted rate template leaves an AT pointing at nothing, and three screens absorb it

**Not reachable today, and recorded before it is.** `firestore.rules:456-459` grants
`get`, `list`, `create` and `update` on `published_ats` and **no `delete`** — so deletion is
denied to everyone including the super admin, and there is no `deleteDoc` against that
collection anywhere in `src/`. The admin register is read-only. A template can only be
removed from the Firebase console or by an admin-SDK script.

**If one were removed, pricing would be fine and the reporting would not.** Adoption COPIES
the five sections onto the AT, so the rates keep working. But the AT's
`ratesSource: 'published:<id>'` then names a document that does not exist, and all three
displays **absorb the dangling reference into a healthy-looking state** rather than naming
it:

| screen | what it does |
|---|---|
| Admin register | Iterates `publishedAts`, so the template vanishes and its adopters are counted nowhere. **The AT becomes invisible to the one screen built to show who is on what.** |
| AT rates summary (`AgencySettings:267`) | `tpl` is `undefined` → `behind` falsy → tone **`ok`**, label *"From template v1"*, detail *"Copied from **a published template**"*. Reports health, names nothing. |
| Estimate Master banner (`:2477`) | Prints *"Copied from published template **&lt;raw document id&gt;** v1"*, then — `drifted` being falsy — **"This is the current version of that template."** Which is false about a template that no longer exists. |

**The last one is the worst, because it is confident.** A missing template and an up-to-date
one produce the same green banner and the same sentence.

**This is the deleted-AT shape.** A job whose `atId` names a removed tender was handled by
saying so; here the same situation resolves to a fallback that reads as normal. The audit's
own rule applies: an absent thing must be reported as absent, not defaulted into looking
present.

**The fix is a fourth state, not a guard.** `ratesSource` has three today —
`inherited-agency`, `published:<id>`, and hand-entered. The missing one is *"the template
this was copied from no longer exists"*, and the sentence for it already exists on the
neighbouring branch at `AtSettings:795`, which gets hand-entered rates right: **"They were
entered by hand for this tender and exist nowhere else. Nothing recreates them."** A deleted
template puts an AT in exactly that position — the rates are now the AT's own, and nothing
recreates them — so it should say so.

**Left open deliberately.** Building the state before deletion is reachable would be
speculative, and adding a delete button is a separate decision nobody has asked for. What
must not happen is deletion becoming reachable *first*.

---

### O42. The tender's witnessing and sequencing rules: transcribed, present, and enforced nowhere

The 2026-28 tender text carries three conditions on how work may proceed:

- inspection must be **witnessed by a UGVCL representative**
- transformers **must not be opened in their absence**
- repair **may only begin after the estimate is approved**

**The app records none of the first two, and does not enforce the third. Both halves are
worse than "not implemented", because both are already half-present.**

#### Half one: the rule is in the codebase and rendered nowhere

`ugvclSchedules.ts:278` holds it verbatim:

> `estimateApproval: 'Repairing cost is capped at 25% of the cost of a NEW transformer.
> Failed transformers may not be opened before approval of the estimate, except in the
> presence of an authorised UGVCL representative.'`

**`SCHEDULE_NOTES` is referenced by nothing but the schedule registry** — the definition, and
the two `notes:` fields in `SCHEDULES`. It appears on no screen and no printed document.
Somebody transcribed the tender's own condition into the code, and no reader of this app has
ever seen it.

That is the F50 shape at document scale: the information exists, is correct, and is not
where the person who needs it is looking. An operator about to open a transformer has no
way to learn from the app that they may not.

**What DOES exist is two printed signature LINES, and neither is a record.**
`NewJob.tsx:2957` prints *"DISCOM Representative / Driver Signature"*; `TestingReport.tsx:610`
prints *"TESTING SUPERVISED / WITNESSED"*. Both are ink-on-paper rules. There is no field, no
name, no date, no boolean, nothing queryable. **Asked "who witnessed the opening of this
transformer", the app cannot answer for any job** — the answer exists only on a printed sheet,
if anyone signed one.

#### Half two: approval is recorded and gates nothing

`approvalNo` and `estimateApprovalStatus` **are** written — `EstimateGenerate.tsx:756` and
`:772` — so the app knows which estimates were approved and under what number. The
sequencing rule is therefore *representable*.

**Neither inspection screen reads either field.** `InternalInspection.tsx` — which is the
dismantling record, the thing the tender forbids before approval — contains no reference to
`approvalNo` or `estimateApprovalStatus`, and neither does `ExternalInspection.tsx`. An
internal inspection can be completed, saved and priced at any time, in any order, regardless
of whether the estimate exists, was sent, or was approved.

So the constraint is not missing for want of data. **The data is there and nothing consults
it** — the same shape as O29's `approvedAmount` and F48's `externalData.kv`, and the third
instance of it in this audit.

#### Why this is worth an entry rather than a fix

**Enforcement is a decision nobody has made, and the wrong enforcement is worse than none.**
Blocking internal inspection on `estimateApprovalStatus === 'Approved'` would stop work in a
yard whenever a DISCOM is slow, and the tender itself provides an exception — opening IS
permitted before approval when a UGVCL representative is present, which is precisely the
fact the app does not record. So the gate cannot be built before the witnessing capture, and
the witnessing capture is a new field on a printed form this audit has repeatedly been told
not to disturb.

**What the app can say truthfully today: nothing.** It cannot report that a transformer was
opened without approval, because it does not know when it was opened relative to approval;
and it cannot report that a witness was present, because it has never been asked.

---

### O43. Two Clause 4.0 cells that reverse the pattern — suspected transcription errors

**In the shipped Clause 4.0 limits, two cells run the wrong way**, and both sit in the same
capacity region:

| | |
|---|---|
| **4-Star below 3-Star at 10 kVA** | 3-Star **8,716**, 4-Star **7,707**. Every other capacity has 4-Star above 3-Star: 5 (5,422 / 6,206), 16 (8,696 / 11,729), 25, 63, 100, 200, 500. **One reversal in eight.** |
| **3-Star's 10 kVA above its 16 kVA** | 8,716 at 10 kVA against 8,696 at 16 kVA — a sanction ceiling that falls as the transformer gets larger. The row is otherwise monotonic: 5,422 · **8,716 · 8,696** · 10,124 · 20,423 · 24,609 · 47,170 · 148,260. |

**Recorded as suspected TRANSCRIPTION errors, not tender quirks.** One anomaly could be a
tender oddity; two, adjacent, in a table that is otherwise perfectly ordered, points at the
entry rather than the source. The operator reports the same 4-Star reversal appears on the
2026-28 paper, which is consistent with either reading — a quirk carried across two tenders,
or a transcription repeated from the same misread column.

**Awaiting the paper.** These are not corrected here: a limit is the Superintending
Engineer's sanction authority and correcting it from inference is exactly the fabricated-rate
pattern this audit exists to prevent. Two cells that look wrong are not evidence of what the
right ones are.

#### What it costs if they are errors

**Every 10 and 16 kVA job has been checked against a wrong ceiling since the schedule was
entered.** Nine jobs sit at those capacities today:

| job | kVA | estimate | limit used | |
|---|---|---|---|---|
| `SU-22` | 10 | 4,485.31 | 8,716 | 51.5% |
| `KLL-8` | 10 | 6,832.18 | 8,716 | 78.4% |
| **`SU-5`** | 10 | **9,077.15** | **8,716** | **OVER — the only flagged job in the database** |
| `SU-23` | 16 | 5,070.83 | 8,696 | 58.3% |

*(The other five are Amorphous or Wound Core, which carry no limit — see the fixed-rate
exclusion.)*

**`SU-5` is the one that matters.** It is the single job in the entire database flagged as
exceeding its circle limit, it is a 10 kVA unit, and the ceiling it was measured against is
one of the two suspect cells. If 8,716 is wrong, the one "over limit" finding the app has
ever produced rests on a mistyped number — and it prints
**"REPAIRABLE (&gt; CIRCLE LIMIT)"** on the estimate that goes to the circle office.

**Nothing is safe to conclude from that until the paper is checked**, which is the point of
recording it rather than acting: the direction of the error is unknown. A higher true limit
means `SU-5` was never over; a lower one means it is further over than reported.

---

### O41. The circle limits are not versioned by tender, and Schedule-A now is

**Rate schedules became per-tender at `ugvclSchedules.ts`; the sanction ceiling they are
measured against did not.** Schedule-A and Schedule-B live in `SCHEDULES`, keyed by
`ScheduleId`, and an AT names which one prices its jobs. The Clause 4.0 circle limits live
somewhere else entirely — `estimateMasterCircleLimits`, a **master section** on the agency
or the AT, resolved by `getCircleLimitsEstimateMaster` and read by `checkJobCircleLimit`.
Nothing keys it by schedule, so **every tender is measured against the same ceiling.**

**Why that now matters.** UGVCL-2026 raises Schedule-A by roughly 0.85% across nearly every
row. If the Clause 4.0 limits are reissued with the tender and are not transcribed alongside
it, a 2026 job costs ~0.85% more and is checked against the 2020 ceiling — so jobs cross the
limit **earlier than the tender says they should**.

**It is not hypothetical, and the margin is thin.** Across 47 CRGO/OH jobs with a resolvable
limit:

| job | kVA | estimate | limit | % of limit |
|---|---|---|---|---|
| `SU-5` | 10 | 9,077.15 | 8,716 | **104.1% — already over** |
| `SU-7` | 200 | 47,115.02 | 47,170 | **99.9%** |
| `SU-10` | 200 | 46,422.69 | 47,170 | 98.4% |
| `SU-6` | 200 | 45,222.21 | 47,170 | 95.9% |

`SU-7` has **Rs 54.98 of headroom on a Rs 47,170 ceiling.** A 0.85% rise adds about Rs 400,
so it crosses. At 2% a second job joins it. *(These are test records, so the closeness of
`SU-7` is partly luck — but the mechanism does not depend on it: any job in the top few
percent of its band crosses on a rate rise the ceiling does not follow.)*

**AND THE ERROR REACHES PAPER, ADDRESSED TO THE AUTHORITY IT IS WRONG ABOUT.**
`EstimateGenerate.tsx:1007` prints **"REPAIRABLE (> CIRCLE LIMIT)"** in the Condition column
of the estimate sent to the circle office. So the document tells the Superintending Engineer
that his own sanction power is exceeded — using a limit from a superseded tender, on an
estimate priced from the current one.

**The direction is conservative and that is not the same as harmless.** Over-reporting sends
an estimate for higher sanction that did not need it: delay and correspondence, not
overcharging. But it is a false statement on an issued document, and the reader is the person
who would know the current limit.

**Held, not fixed — the Clause 4.0 pages for AT 1819 have not been supplied.** Two shapes are
available once they are: move the limits into `ScheduleSet` beside Schedule-A and B, or key
the master section by schedule id. The first is more honest about what they are; the second
preserves the per-agency override that exists today. Deciding without the pages would be
guessing at whether the limits even changed.

**Adjacent, same shape, also not fixed: the circle-limits section is freely editable.** It is
not in `REFERENCE_SECTIONS`, so any agency can type over the Superintending Engineer's
sanction powers — the same "someone else's decision offered for editing" argument that locked
the Amorphous and Wound Core rates. The difference is that those repair rates were read by
nothing, so locking them changed no figure; these **are** read, on every estimate, so locking
them is a behaviour change and needs the same ruling the fixed-rate sections got: is this the
tender's fact or the agency's?

---

### O40. The Schedule-B extras exist, are priced, and cannot reach an estimate — O16 follow-on

**Rows 3-6 of the Amorphous / Wound Core master are real tender charges with real rates, and
there is no path by which any of them reaches an Amorphous or Wound Core estimate.**

| row | charge | rate | reaches an estimate |
|---|---|---|---|
| `3` | Tank replacement, same size & thickness | Rs 54/kg | **no** |
| `4` | Conservator tank replacement, same size | Rs 54/kg | **no** |
| `5` | Complete radiator replacement | Rs 1,057 | **no** |
| `6` | Sealing of an uneconomical unit by welding | Rs 189 | **no** |

They are the same items as `SCHEDULE_B_EXTRAS` in `ugvclSchedule2020.ts:215`, whose own
comment states the rule: *"Charged extra, only when the UGVCL engineer demands replacement
instead of repair. Old material must be credited to the divisional store."* The fixed-rate
branch emits exactly two lines — the repairing charge and, on per-coil rows, labour — and
has no mechanism for adding any of these.

**So an agency that replaces a tank on an Amorphous unit, at an engineer's instruction, has
no way to bill for it.** Not a wrong figure; no line at all.

**This is the other half of O16.** That entry found the bill *itemising* Amorphous repairs
and adding rows 2-6 to every one of them whether the work was done or not — the bill
charging extras nobody had performed. The estimate has the opposite defect on the same rows:
it cannot charge them when they *have* been performed. Both come from one cause, which O16
names: the estimate and the bill were computing the same job by two different models. F57
resolved that by making the bill delegate to the builder, which was right — and it means the
bill inherited the estimate's silence about the extras along with everything else.

**What it needs is a decision, not a patch.** Schedule-B is a fixed all-inclusive rate; the
extras are conditional on an engineer's demand, which is an observation nobody currently
records. There is no field for "the engineer required tank replacement", and inventing the
quantity is the fabricated-quantity pattern this audit exists to prevent. Closing it means
capturing the demand on an inspection first.

**Read-only makes the display honest and leaves this standing.** The rows now say they are
tender rates shown for reference, which is true. It does not say the tender charges them and
this app cannot — the section looks complete, and is.

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

### F43a. A template may carry the tender's percentage — and F43 still stands

**Both are true, and the difference is PROVENANCE rather than behaviour.** Recorded together
because the second looks like a reversal of the first and is not.

**F43 removed a CARRY-FORWARD.** A new AT pre-filled its three percentages from the previous
AT, and the reasoning against it was already written in the code that did it: last year's 8%
"looks deliberate and would price a whole tender wrongly while appearing configured". A field
already holding a plausible number is submitted unread, and a wrong percentage is invisible
on the finished document because no line says which was used. **That has not come back.**
`openAddForm` still opens empty, and the previous AT's figures are still available only
behind `copyPercentagesFromPreviousAt`, a button.

**F43a adds a STATEMENT BY THE TENDER.** Some tenders quote one accepted rate to every
agency — A/T 1819 clause 2.0 accepts 7.00% above for CRGO / Amorphous, the same figure for
all — and some let each agency bid. Live data shows both: ZENITH and ADMIN both run 7/7/7 on
UGVCL-2026, while on the SAME 2020 schedule MEGHA runs 4/-8/-4 and suchit 5/-2/4. So the
percentage cannot be derived from the schedule; it is a fact about the tender that only
sometimes exists.

`PublishedAt` therefore carries the three percentages **optionally**, beside the dates it
already carries as suggestions. Filled when the tender sets one rate for everyone; blank
otherwise, in which case the AT form's fields stay blank and required.

**THE LABEL IS THE WHOLE JUSTIFICATION.** A pre-filled figure with no source is a default,
and a default is precisely what F43 removed. The same figure labelled "7% from the tender
(UGVCL/…/AT/1819). Confirm against your acceptance letter." is something an operator can
check against the paper in their hand. A labelled fact can be confirmed; a silent default can
only be missed. Remove the label and this becomes F43 again.

**OPTIONAL AND NOT REQUIRED, deliberately.** A required field makes an admin who does not
know type something, and a wrong percentage propagated to every adopting agency is worse than
a blank each of them answers from its own acceptance letter. The publish form says so:
"Fill these only if the tender sets one rate for every agency."

**CREATION ONLY.** `adoptPublishedAt` does not write percentages onto an existing AT — it
writes `ratesSource`, `scheduleId` and the five rate sections, and nothing else. Changing a
tender's percentages as a side effect of taking its rates is the shape that made re-adoption
on save dangerous, and is the same reason the template's dates are a suggestion at creation
rather than an update.

**No backfill.** Both existing 1819 ATs already carry 7/7/7, typed at creation before any of
this existed. Verified against live data; no script was written.

---

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

> **The agency fact this correction rests on has changed (2026-09-11) - see O20.** The correction
> was right on the answer given at the time: with S.E. on one winding and without on the other,
> from one inspection, was wrong either way. What changed is the answer. S.E. conductor is used, so
> "without S.E." is no longer a constant - it is one of two values an input has to select.

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


## G26. Eleven wordmarks, one version literal, and two subtitles that disagreed

The site went live at **transregister.com** while the interface still said `TR REP AGENCY v2.5`.
Renaming it meant finding every place the app names itself, and the count mattered more than
the rename: a product name is the one string that is *supposed* to be duplicated, so there is
no compiler and no test that finds the site you missed.

**Eleven sites, in four different registers.** A wordmark on the landing page and another in
its footer; a `©` line; a Terms of Service clause; three `alt` attributes; the sidebar `<h1>`;
the `<title>`; and the manifest's `short_name` and `name`. Only the first two look like
branding. The other nine are the ones a rename misses — an `alt` attribute is read by exactly
the users who cannot see the mark it describes, and the manifest is what the name on a phone's
home screen comes from.

**Three of the eleven are outside the bundle.** `index.html` and `manifest.json` are static
files; no TypeScript constant can reach them. So a `PRODUCT_NAME` export would have covered
8 of 11 sites while *appearing* to cover all of them — which is worse than none, because the
next renamer would trust it and ship a stale `<title>`. **A constant is only worth extracting
when it can cover every instance; a partial one relocates the bug into a false guarantee.**
The subtitle went into a constant precisely because both its sites are `.tsx` — 2 of 2.

**`v2.5` existed in exactly one place, hardcoded, and no release process updated it.** Not in
`package.json`, not in the manifest, not derived from anything. It was deleted rather than
re-sourced. A version number on a login page tells a customer nothing even when it is true —
they cannot choose a version, and it does not tell them whether the thing works. **A literal
that only ever gets more wrong is not a fact, and wiring it to a real source would have made
it accurate without making it useful.**

**`Dashboard:544` fell back to the product name in a slot that means "the agency you are in".**
`{activeAgency?.name || 'TR REP AGENCY'}` — the sentinel shape this audit keeps finding: a
plausible value standing where a missing one belongs, so the failure renders as a fact. With
no agency selected the honest answer is `No agency selected`.

**And the drift.** `AppLayout` said *Transformer Repair Portal*; `LandingPage` said
*Transformer Overhaul ERP* — on the two screens a user sees first. Both were wrong in ways
that outlived whoever wrote them: "overhaul" appears nowhere else in this app or in the A/T,
which say **repair** throughout, and "ERP" claims a category this is not — it prices and bills
transformer jobs, it does not do payroll, inventory or ledgers.

The rule, and it is the same one G25 drew about the mark: **a string that must be identical in
two places will not stay identical, and the drift is invisible because no screen shows both.**
Nobody sees the landing page and the sidebar at the same moment. There was no bug report and
could not have been one — the app was simply describing itself two different ways to the same
person, ninety seconds apart.

**What the two descriptions record.** `index.html` had no `<meta name="description">` at all
and the manifest had no `description`, so a search result and an install prompt were both
quoting whatever the crawler chose. The meta description was **measured against the ~155
characters a search result shows** rather than written blind: the first draft ran 172 and would
have been cut at `…priced from the tend`. Both lead with what the app does rather than what it
is, because the name is already rendered in bold directly above them.

**The verification is the part worth keeping.** `print-subtree-hashes.js --compare HEAD`
reported **13 printed subtrees, 13 byte-identical, 0 changed** — proving the rename reached no
A4 document. That is the invariant at the top of `ui.ts` (*nothing here is imported by a
printed document*) checked rather than asserted, and it is the right check for a rename
specifically: UGVCL receives a **contractor's** bill, and the letterhead carries the agency's
name and address. The software's name has no business on it. A rename that leaked onto a
printed document would not fail a build, a typecheck or a test — only a hash of the rendered
subtree catches it, and only if someone runs it.

The app mark was left alone throughout, and that was the point of G25's decision to ship it
**without a wordmark**: carrying no letters is exactly what let one icon survive a rename of
every name around it.


## G27. A rule that read like a check, and a payments screen that invented its own data

Payment work started with six questions and none of them was answered by building. Four defects
turned up first, and all four had the same property: **they were visible, validated, and wrong.**

**`firestore.rules` granted the world read on `system_config`.** The line was

    allow get, list: if isSuperAdmin() || isSignedIn() || true;

and the `|| true` short-circuits everything to its left. Not "any signed-in user" — anyone on
the internet holding the project id, no account required. The two checks before it could never
be reached, and **they are precisely what made the line scan as authorised.** A reader's eye
stops at `isSuperAdmin()`. `public_config` carried the same shape (`isSignedIn() || true`),
where the outcome was intended; it now says `if true` and says why, because a grant that has to
be reverse-engineered from a short-circuit will be misread by whoever adds the next field.

The Admin Panel's payment tab wrote `keySecret` to `system_config/razorpay`. **The first Save
would have published an API secret to the open internet with no error and nothing on screen.**
The live database shows no such document — it was never pressed — so nothing leaked and no key
needs rotating. That is luck, not design, and it is the wrong thing to conclude the incident on:
**the defect was never the tab.** It was that a document holding whatever anyone adds to it next
was public behind a rule that looked like a check.

`isValidSystemConfig` would not have stopped it either. Every clause is `!('x' in data) || ...`,
so **a field the validator does not name passes unchecked.** A validator that enumerates
permitted fields cannot refuse an unexpected one — it is an allowlist that defaults to allow.

**The same pattern, one collection over, defeated the entire payment gate before it was built.**
`agencies` validated `subscriptionStatus`, `subscriptionExpiresAt` and `subscriptionPlan` — on a
document the OWNER may update. One `updateDoc` from a browser console sets `status: 'active'`
with an expiry in 2099. The fields were type-checked the whole time, and that is the trap:
**validation on a field the wrong party can write is not a boundary, and reads like one.**

And the two spellings disagreed. The rules said `subscriptionExpiresAt`; the TypeScript said
`subscriptionExpiryDate`. Under `!('x' in data) ||`, **the app's own spelling passed completely
unvalidated** — the validator was guarding a field nothing wrote and waving through the one that
mattered. Collapsed while zero documents carried either.

The general rule, and it is the one that governs the whole payment design: **Firestore rules
cannot express "only a function may write this."** The Admin SDK bypasses rules rather than
satisfying them as a privileged principal, so there is no predicate that distinguishes a server
write from a client one. The only durable guarantee is structural — **the field a gate reads
must live in a document no client can write at all.** Subscription state moves to
`subscriptions/{agencyId}` with `allow write: if false`, and that is not a preference between
two workable shapes; it is the only shape.

**Fourth, and the one a person would actually have acted on.** The Admin Panel's agency table
read `subscriptionStatus || 'active'`, `subscriptionExpiryDate || (Date.now() + 365 days)` and
`subscriptionPlanAmount || 3999` — against a database where **not one agency carries any of the
three.** Every agency rendered as ACTIVE PAID at ₹3,999/yr, expiring one year from whenever the
page happened to load: an expiry date that changed daily and had never been true of anyone. The
headline metric counted an agency with no subscription field as active — `|| !a.subscriptionStatus`
— so the panel reported twelve paying subscribers where there were none.

This is the sentinel shape recorded throughout this audit — a plausible value standing where a
missing one belongs, so absence renders as fact — and **on a payments screen it is the worst
version of it.** The one person deciding whether to chase twelve unpaid accounts was shown
twelve paying customers. Every other instance of this pattern misled a reader about state; this
one would have misled the owner about revenue.

**The price was wrong in nine places, not four.** The app advertised ₹3,999/yr against a real
price of ₹5,900: the tab label, two panel headings, a save confirmation, the announcement banner,
a table fallback, a fake Key ID string, and — worst — **twice on the support form, where a
customer reads it and would quote it back.** Nine literals of one fact is how they drift. It is
now `SUBSCRIPTION_INCLUSIVE_INR` in `lib/pricing.ts`, with the GST carved out by subtraction so
`taxable + tax` foots to the rupee, because an invoice that is out by a paisa is not a valid tax
invoice. **The price is displayed and never edited:** a price editable from a browser can
disagree with an invoice already issued, and a tax invoice is corrected by a credit note, never
by editing it.

**One check worth keeping as a habit.** Narrowing a read is the change that breaks quietly, so
the one non-admin reader of `system_config` was traced before the rule was tightened:
`AgencyContext` reads `estimate_master` there as the *second* branch of the rate chain, reached
only when `public_config/estimate_master` is absent. It is present — verified against the live
database, six populated sections — so no ordinary client reaches the collection at all, and if
one ever did, the read sits in a try/catch that falls back to shipped defaults and says so on
screen. **A tightened rule with an unexamined reader is an outage; the same rule with the reader
traced is just a fix.**


## G28. Twelve agencies shown as paying customers, and the person misled was the one deciding whether to chase them

Recorded separately from G27, which listed it as one of four defects found before the payment
work. It deserves its own entry: **it is the sharpest instance of the sentinel pattern in this
codebase**, and the pattern is the single most repeated finding in this document.

`AdminPanel:841-843`, three lines:

```js
const subStatus = (agency as any).subscriptionStatus || 'active';
const expiryMs  = (agency as any).subscriptionExpiryDate || (Date.now() + 365*24*60*60*1000);
const planAmt   = (agency as any).subscriptionPlanAmount || 3999;
```

Against a database where **no agency carried any of the three fields.** Not some. None — verified
against the live database, twelve of twelve. So every `||` fell through, every time, for every
row, and the table rendered:

- **ACTIVE PAID**, in green, on all twelve
- **₹3,999 / yr**, a price nobody had ever been charged and which was not even the right price
- **an expiry one year from page load** — a date that was different every day the page was
  opened, and had never been true of anyone

And the headline metric above it:

```js
const activeAgenciesCount = allAgencies.filter(a => a.subscriptionStatus === 'active'
                                                 || !a.subscriptionStatus).length;
```

`|| !a.subscriptionStatus` — **an agency with no subscription field counted as an active paying
subscriber.** Absence was read as consent. The card said `12 Active Paid`.

**WHY THIS ONE IS WORSE THAN THE OTHERS.** The pattern recurs throughout this audit: a plausible
value standing where a missing one belongs, so the absence renders as a fact. `Dashboard:544`
fell back to the product name where an agency name belonged (G26). `CircleLimitCheck.finalAmt`
was named for a figure it did not hold. In every previous instance the harm was **a reader
believing something false about state they could go and check.**

Here the reader was the vendor, the subject was revenue, and there was nothing to check against —
the screen was the check. The one person deciding whether twelve agencies needed chasing for
payment was shown twelve agencies that had already paid. A defect that misreports state invites
a wrong action; **a defect that misreports revenue invites no action at all**, which is the
failure mode with no error message and no moment of discovery.

It would also have survived the payment integration. Once real subscriptions existed, some rows
would carry real fields and the rest would keep falling through to the invented ones — and the
fabricated rows would look *more* credible, not less, because they would sit beside genuine ones
in the same column with the same styling.

**THE RULE, and it is the same one every time this appears.** `||` is not a default; it is a
claim. `a || b` asserts that when `a` is absent, `b` is a true statement about the world. That is
sometimes right — a display string, a formatting choice, an empty list. It is never right for a
**fact about what happened**: a payment, an expiry, a status, an amount, an owner. For those the
honest fallback is not a plausible value but the admission that there is none, and the screen has
to be built to render that admission rather than hide it.

Both now say what is true: `NOT BILLED`, and `Nothing has been billed yet`. The price column
still shows ₹5,900/yr, labelled *"the rate, not a charge made"* — because the rate is a real fact
and the charge is not, and a screen about money has to keep those apart.

**A note on how it was found.** Not by a test, a type error or a bug report — none of which could
have caught it, since every value was well-typed, non-null and plausible. It was found by reading
the live database first and the screen second, and noticing they disagreed. That is the only
method that finds this class, and it is why the six payment questions were answered by a live
read before any of them was answered by building.


## G29. Two collections no client may write, and a trailing space that proved the guard works

**THE COLLECTIONS.** `subscriptions/{agencyId}` and `entitlements/{uid}`, both `allow write: if
false`, both readable by the party they concern.

`allow write: if false` is not a stricter version of an ordinary rule; it is a different kind of
thing, and the reason is worth stating plainly because it constrains every later design decision
about money. **A Firestore rule cannot express "only a Cloud Function may write this."** The
Admin SDK does not satisfy rules as a privileged principal — it bypasses them entirely — so
there is no predicate available that distinguishes a server write from a client one. The only
construction that yields the guarantee is total client denial: everything the rules can see is
refused, and the only writer left is the one the rules never evaluate.

This is why subscription state could not stay on the agency document behind a tighter condition
(G27). The agency is owner-writable; a validated field there was forgeable by exactly the party
with an incentive to forge it. There is no clever predicate that fixes that — **the field a gate
reads has to live where no client can write at all.**

Read is granted deliberately and is not a weakening. An owner must be able to see what they have
paid for and when it expires; a paywall that will not tell you your own expiry date generates a
support ticket per customer per year. **Reading cannot forge anything. Only writing can.**

Two shape decisions worth keeping:

- **The subscription document id IS the agency id**, which is what makes the ownership check
  possible at all: the rule can `get()` the agency at a known path and compare `ownerId`. A
  random subscription id would leave nothing to check against without a query, and rules cannot
  query. The id carries the relationship the rule needs.
- **Entitlements are keyed by uid, not by agency**, because at the moment agency creation is
  gated there is no agency id yet — the document is about to be made. Keying it by agency would
  be unusable at precisely the moment it is consulted.

**THE TRAILING SPACE.** The grant script's first draft classified agencies by name, listing nine
to grant and three to exclude. It refused, and the refusal was initially confusing rather than
clarifying: two agencies appeared as UNCLASSIFIED *and* as NAMED-BUT-ABSENT simultaneously.

The database holds `"DYNAMIC TRAMSFORMER "` and `"ZENITH TRANSFORMERS "` — **with a trailing
space**, typed into the creation form and never trimmed. The earlier census printed them through
`padEnd`, which is exactly the formatting that makes trailing whitespace invisible, so the report
that produced the list could not have shown it.

The lesson is not about trimming input. It is that **a display string a human typed is not an
identifier.** It carries whitespace, case, and typos — note that `DYNAMIC TRAMSFORMER` is itself
misspelt in the data — and it can be edited later without anything noticing that a script
depended on it. The document id cannot. The script now keys on ids, carries names only so its
output is readable, re-reads those names live, and flags any that have since been renamed.

**And the guard is what turned a silent mismatch into a stopped run.** The script refuses on any
agency in neither list rather than defaulting. Had it defaulted to "skip the unrecognised", the
two whitespace names would have been silently excluded from the grant and two real customers
would have been locked out eighteen months later, with the script's own output reporting success.
Had it defaulted the other way, an unknown agency would have been granted a free year in silence.
**The refusal cost one confusing message and caught a defect the report that produced the list
could not have shown** — which is the argument for guards that stop rather than choose, in the
same shape as the print-hash tool refusing on a dirty tree.

**THE GRANT ITSELF.** Nine agencies, eighteen months, status `'granted'` and not `'active'` —
a grant and a payment are different facts and must stay distinguishable, since a grant has no
invoice behind it and nothing should ever go looking for one. `planAmount: 0` for the same
reason. It never overwrites an existing subscription: if one exists it was written by a payment,
and a grant must not shorten or extend what somebody paid for.

**The classification is an inference from the name, and the script says so in its own output**
rather than presenting it as a finding. No agency record carries an email or a GSTIN, so nothing
in the data distinguishes a customer from a test record — `ADMIN`, `suchit` and `MEGHA` were
excluded on judgement, not evidence. A script that presents a judgement as a fact is how a wrong
one gets approved, so it prints what it inferred and why, for a person who knows these agencies
to read against what they know.


**WHAT WAS DONE ABOUT IT, AND THE LINE THE FIX WOULD NOT CROSS.**

The creation form now trims **on save, not on change**. That distinction is the whole fix: a
trim in the `onChange` handler would make the field impossible to use, because you could never
type the space in "ZENITH TRANSFORMERS" — it would be eaten the instant it was typed. The edit
form does the same. Division names three blocks above the offending line were *already* trimmed,
so the knowledge was in the file; it had simply never been applied to the field that names the
agency.

The two stored names are cleared by `scripts/admin/trim-agency-names.js`, and that script sits
deliberately outside a boundary the app cannot cross. **G1 removed `isSuperAdmin()` from every
agency write** on the stated reasoning that a vendor who can edit a customer's rates, estimates
or bills is a liability rather than a capability — *if the figures are wrong, the customer cannot
say it was not us.* The Admin SDK bypasses rules, so this script does what the rules forbid.

It is justified because **that restraint is about substance.** Rates, estimates, bills, figures a
customer would dispute. A trailing space is none of those: nobody typed it deliberately, no human
can see it, it does not change what the agency is called, and **it is our defect rather than
their data** — the form should never have stored it.

**The spelling is a different matter and is not touched.** "DYNAMIC TRAMSFORMER" is misspelt, and
it is the agency's own name as they gave it; it prints on their documents. Correcting a
customer's name because it looks wrong to us is precisely the substance G1 says is not ours to
touch. **The whitespace is ours. The spelling is theirs.** That line is the useful one, because
it is a rule about *whose data a defect belongs to* rather than about how big the change is —
and the trailing space is the smaller edit of the two.

The script's scope is drawn to match: one field, on the documents that actually differ, with
`update()` rather than `set()` so nothing else can be touched even by accident, and every value
printed **JSON-quoted** before and after. A diff whose entire content is invisible whitespace
cannot be reviewed any other way — and printing through `padEnd` is exactly what hid the defect
to begin with.


## G30. The two payment functions, and the four things a browser is not allowed to say

`createSubscriptionOrder` and `verifySubscriptionPayment`, in `functions/subscription.js`. The
client opens Razorpay's checkout with an order id it was handed and passes back what checkout
returns. **Nothing it says about the outcome is believed.**

Four inputs a browser might plausibly supply are refused on principle, and each is a real
vulnerability rather than defensive habit:

**1. The amount.** Taken from a constant in the function, never from the request. An order
endpoint that accepts an amount is the most common form this bug takes, and it is total: the
customer names their own price. `PRICE_INCLUSIVE_INR` is duplicated from `src/lib/pricing.ts`
because a deployed function ships only what is under `functions/` — the same constraint that
produced `app-config.json` and its predeploy sync. **The copy is safe here in a way the database
id was not, because this one is authoritative:** the charge is whatever this function tells
Razorpay, and the client's figure is only a label. If they drift the customer is charged this
number and shown the other, which is a display bug. The reverse arrangement — the client naming
the amount — is the one that must never exist.

**2. What the payment was for.** `payment_orders/{orderId}` records the kind and the agency
*before* the customer pays; verification reads them back from there. Without it a browser could
present a renewal order and redeem it as a slot to create a new agency — same payment, different
entitlement, and every signature check would pass, because **the signature proves the payment is
genuine and says nothing about what it was for.**

**3. That the payment succeeded.** Only `razorpay_signature` establishes that, being
`HMAC-SHA256(order_id + "|" + payment_id)` under the key secret. The other two fields checkout
returns can simply be invented. Compared with `timingSafeEqual`, **length-checked first because
that function throws on a length mismatch rather than returning false** — an exception that would
surface as a server error instead of a rejected payment, which is the wrong outcome dressed as
the wrong kind of failure.

**4. That it has not already been counted.** `payments/{razorpay_payment_id}` is an idempotency
key, not a log. A checkout callback arrives twice for ordinary reasons — a retry, a double-click,
a refresh — and the transaction uses `create`, which fails if the document exists, so the second
attempt loses the race rather than both succeeding. Without it a single payment extends a
subscription by two years.

**RENEWAL EXTENDS FROM THE EXISTING EXPIRY, NOT FROM TODAY**, whenever that expiry is still in
the future. Renewing early must not cost a customer the days they already hold — and with
eighteen-month founding grants outstanding, early renewal is the *normal* case here rather than
an edge one. A design that quietly resets to `now + 365` would take months from every founding
agency, and would look correct in every test written against a lapsed subscription.

**THE INVOICE IS DELIBERATELY NOT ISSUED IN THIS FUNCTION**, and it is the decision here most
likely to be mistaken for an omission. Two requirements collide:

- A GST invoice number must be sequential and **gap-free** within a financial year. The SAC code
  is not settled, so an invoice cannot be rendered correctly today, and **allocating a number to
  an invoice that cannot be rendered puts a permanent hole in the sequence** — a filing defect,
  not a missing feature.
- The money has already left the customer's account by the time this function runs. **Refusing
  the payment over incomplete invoice configuration would lose a payment already taken**, which
  is categorically worse than a late invoice.

So a verified payment always records the subscription and flags `invoicePending: true`. Invoices
are issued afterwards, in order, once the SAC code is set. Nothing is lost and no number is
burned. The function returns `invoicePending` to the caller so the screen can say so plainly
rather than implying a document is arriving in the next few seconds.

**The two configuration values are separated on purpose.** `RAZORPAY_KEY_SECRET` is a Functions
secret; `RAZORPAY_KEY_ID` is a deploy param, because it is publishable by design and switching
test to live should be configuration rather than a code change. The key id is handed to the
client **with the order** rather than duplicated in the bundle, so the two cannot disagree about
which mode the app is in. When either is unset the refusal **names which one and which mechanism
configures it** — "payments are not configured" sends the reader to the wrong place half the
time.


## G31. Checkout, and the state between "money left" and "the server knows"

`src/lib/subscriptionClient.ts` and `src/components/SubscriptionPanel.tsx`. The browser opens a
checkout with an order id it was handed and passes back what Razorpay returns. It does not
choose the price, does not decide what the payment buys, and **its report that a payment
succeeded is not what activates anything.**

**THE FAILURE THIS CODE EXISTS TO HANDLE CORRECTLY** is the window between the card being
charged and the server recording it. Razorpay takes the money before our handler runs. If
verification then fails — a dropped connection, a closed tab, a cold start timing out — **the
customer has paid and the subscription is not active.** That is a real state, not a hypothetical.

The instinct is to show a payment failure. That is the one thing that must not happen: it tells
the customer nothing was charged, which is false, and which they will discover from their bank
statement. `PaymentTakenButUnverified` carries the payment id and says so plainly — *"Your
payment went through, but this app could not confirm it. Nothing is lost. Quote payment
`pay_xxx` to support and it will be applied."* **The payment id is the only thing that lets the
payment be found afterwards, so it belongs on screen rather than in a console.**

Three smaller things in the same family, each a real behaviour of the gateway rather than
defensive habit:

- **`settled` guards against both callbacks firing.** Razorpay calls `ondismiss` when the modal
  closes, which on some flows happens *after* a successful handler. Without the flag a completed
  payment could be reported as a dismissal and the resolve discarded — a paid customer told they
  cancelled.
- **Razorpay's own retry is disabled.** Its retry UI re-opens checkout against a *new* order
  behind the app's back, which would leave a paid order this app never verified. A retry here is
  the customer pressing the button again, which makes a fresh order the server knows about.
- **A dismissal is not an error and shows no message.** Closing a payment window is an ordinary
  thing to do, and an alarm on it trains people to ignore alarms.

**`alreadyProcessed` IS REPORTED AS SUCCESS, NOT AS A FAULT.** The same payment reaching the
server twice is ordinary — a retry, a refresh — and the idempotency key refuses the second
arrival rather than counting it (G30). The screen says *"That payment had already been recorded.
Nothing was charged twice."* Presenting that as an error would send a customer to support over
a system working exactly as designed.

**THE PANEL SHOWS ABSENCE AS ABSENCE**, which is the direct inversion of what it replaces. The
screen it supersedes read `subscriptionStatus || 'active'` against a database where no agency had
ever paid, and rendered twelve customers as ACTIVE PAID on an expiry date that changed daily
(G28). Every state here comes from a document that exists; when there is none it says
`NOT SUBSCRIBED`. It reads `subscriptions/{agencyId}` live and writes nothing — it cannot, the
collection is `allow write: if false` (G29).

**A grant reads as a grant, not as a payment.** `status: 'granted'` renders GRANTED with its
reason, not ACTIVE. Nine founding agencies hold eighteen-month grants, and an operator who
believes they have paid will not expect a renewal notice.

**And the early-renewal rule is stated on the button rather than left to be discovered.** With
those grants outstanding, almost every renewal for the next eighteen months will be early. A
customer who suspects renewing early will forfeit their remaining days will simply wait — and
then renew late, which is the outcome the whole screen exists to avoid. One line: *"Renewing
early adds a year to the date above rather than restarting from today. No days are lost."*

**THE TEST CARD, RECORDED BECAUSE IT COST AN HOUR.**

`4111 1111 1111 1111` is the card Razorpay's own documentation gives, and on this account it is
**rejected as an international card.** The working domestic test card is:

    5267 3181 8797 5449      any future expiry, any CVV

The failure is silent in the way that matters: card details are accepted, the modal closes, and
**no OTP or bank-simulation page ever appears.** That absence is the diagnosis - it is the
visible form of `step: "payment_initiation"`, meaning Razorpay refused before it ever asked a
bank. A failure at the OTP stage looks completely different, because the OTP stage happens.

Two defects in this codebase turned that hour into a blind one, and both are worth more than the
card number:

- **`payment.failed` kept only `error.description`** and discarded `code`, `reason`, `source`,
  `step` and `metadata.payment_id`. The four discarded fields are the diagnostic ones; `step`
  alone would have answered the question immediately. The whole payload is now logged and the
  five fields print on screen.

- **A gateway refusal could render as complete silence.** When a payment fails Razorpay closes
  the modal, so `ondismiss` and `payment.failed` both fire in an order the app does not control.
  Whichever arrived first won, and a dismissal deliberately shows no message - closing a payment
  window is ordinary. So a real refusal could look like nothing happening at all. The dismissal
  verdict is now deferred 600ms; a `payment.failed` in that window wins, because it carries a
  reason and a dismissal does not.

**The general rule: when a third party refuses, keep everything it said.** A gateway's error
object is the only account of why, it is not reconstructible afterwards from anything on screen
or in the database - the server is never called on that path - and the field that turns out to
matter is rarely the one that reads best in a message box.

A latent defect found while diagnosing, which was **not** the cause: the order `receipt` was
built as `renewal:` + a 20-character Firestore id + `:` + a 13-digit timestamp = **42 characters
against Razorpay's 40-character cap.** Over the cap the Orders API returns 400 and no order is
created - a failure *before* checkout opens, so it cannot explain a payment failing after card
entry. Fixed regardless, at 23 characters; the full ids live in `notes` and in `payment_orders`.


## G33. A negative control that silently did nothing, and the gate it was guarding

**THE CONTROL FAILED, AND REPORTED PASS.** `verify-seed-equality.js` compares three
implementations of the agency seed and reports whether they agree. Because a harness that
reports no difference is worthless until something proves it can see one, a negative control was
run by hand: perturb one rate in the compiled artefact, confirm the comparator catches it.

The perturbation was applied with a regex that did not match the generated file's format. It
threw, the shell reported the traceback, and **the comparator then ran against a file nobody had
modified and printed PASS.** The output was indistinguishable from a control that applied its
perturbation and found the comparator working perfectly.

**This is the third harness in this codebase blind to its own subject, and it is the sharpest of
the three.** The print-hash tool compared CRLF against LF and reported 13 changed documents that
were identical. It also could not see an ADDED document, because its "before" pass restored old
files without removing new ones. Both were comparators that answered confidently about something
they were not looking at. **This one was the instrument built specifically to prove the
comparator could see — and it silently did nothing while reporting success.** A broken measuring
device is one problem; a broken calibration of the measuring device is the same problem one level
up, and it is the level nobody checks.

**THE RULE: a negative control must fail loudly if it cannot apply its own perturbation.**
Verify the perturbation LANDED before believing the difference it produces — assert the modified
value is actually present, not merely that the hashes differ. A control that cannot distinguish
"I perturbed it and the comparator saw the change" from "I perturbed nothing and there was no
change" is not a control. Both produce a green result, and the green one you get is the one you
did not earn.

It is now **built into the harness and runs on every invocation**, rather than being a thing
someone remembers to do by hand. It clones the built document, changes one `itemName` to a
sentinel, **asserts the sentinel is present**, and only then asks whether the hash moved. The
harness is in the functions predeploy hook, so a drifted seed — or a comparator that has gone
blind — refuses to deploy.

Same family as the print-hash tool refusing on a dirty tree: **the discipline belongs in the
tool, not in whoever is running it.**

---

**THE GATE ITSELF.** `createAgency` is a callable function, and agency creation goes through it.

A Firestore rule *can* read `entitlements/{uid}.agencySlots > 0` and permit a create. What it
cannot do is **decrement** — rules evaluate a write, they do not perform one. So a rule-only gate
lets one paid slot create unlimited agencies: every create passes the same check against the same
untouched counter. Check-and-decrement has to be one transaction, and only the server can run
one. Identical reasoning to `deleteIfEmpty`: the guard and the act in one call, with no window.

**The vendor exemption is decided from the verified auth token, and the screen gets no say.** The
client sends no flag, and the function would not read one if it did. A boolean the browser sets
and the server trusts is not an exemption — it is a *request* to be exempted, and it is the shape
every "admin mode" vulnerability takes. The identity now has **one definition**,
`functions/adminIdentity.js`: it was a literal in `deleteIfEmpty` and again in `firestore.rules`,
and `createAgency` would have been the third copy. Three copies of "who is the vendor" is where
they begin to disagree, and an exemption that is true in one function and false in another looks
correct in both isolations. It normalises case before comparing, because a provider's token
casing varies and `Shivaminfotech89@Gmail.com` failing a naive `===` would deny the vendor their
own exemption silently.

**Three provenances stay three facts**, which is G28's lesson applied before the defect rather
than after it:

| status | meaning | expiry |
|---|---|---|
| `active` | paid, invoice behind it | one year |
| `granted` | founding agency, predates billing | eighteen months |
| `admin` | vendor-created, no payment | **null** |

`admin` writes `expiryDate: null`, and the panel checks for it **before** the expiry branch —
otherwise `expiry` is 0, `0 < now` is true, and an agency that never had a subscription renders
as one that **lapsed**. A subscription that never existed shown as expired is the same class of
lie as one that never existed shown as ACTIVE PAID. Order is the entire guard.

The year on a slot-created agency runs **from creation, not from purchase**. A slot may sit unused
for months, and starting the clock at payment would sell somebody a year of service for an agency
that did not exist yet.

**`allow create` on agencies is deliberately still open.** Closing it before the replacement is
deployed and proven would lock out creation entirely — including the vendor's — and the rule is
the one part of this that cannot be tested locally. The function ships first, the rule closes
after.


## G34. The same defect as G28, erring the other way

The Admin Panel's agency table hardcoded **`NOT BILLED`** on every row and **never opened the
`subscriptions` collection at all.** That was true when it was written — nothing had been billed —
and it stopped being true the moment the first payment landed, with no code change to mark the
transition and nothing on screen to indicate one was needed.

It is G28's shape exactly: **a screen asserting something about state it is not reading.** The
difference is only direction. G28 overstated, showing twelve unpaid agencies as ACTIVE PAID at a
price nobody was charged. This understated. **Understating is safer and is still an assertion
made without looking** — and the failure it would have produced is the mirror image of G28's: the
person deciding whether to chase twelve agencies for payment would have been told that customers
who *had* paid had not.

There is a second-order point worth keeping. G28's fix wrote the honest thing for the state that
existed *at that moment*, and the honest thing became a lie four commits later. **A hardcoded
truth has an expiry date that nothing enforces.** The correction was not to write a better
constant; it was to make the screen read.

**"NOT READ" AND "NOT BILLED" ARE DIFFERENT ANSWERS AND NOW LOOK DIFFERENT.** If the
subscriptions read fails, `subsByAgency` stays `null` and every row shows an amber `NOT READ`
rather than a grey `NOT BILLED`. Reporting a failed read as an absence of subscriptions would be
a confident claim built on a failure — the same defect one layer down, and the one that would be
hardest to notice, because a table full of "not billed" looks like information.

`null` also distinguishes *not yet loaded* from *loaded and empty*, so the lie does not
reappear for a second on every page load.

**THE VOCABULARY IS SHARED, IN `lib/subscriptionStatus.ts`.** Two screens read a subscription —
the owner's panel ("what do I have, when does it run out") and the vendor's table ("which of
these has been paid for"). They phrase it differently and they must **classify** identically.
This session is a catalogue of what two copies do: two spellings of an agency name, two
subtitles on the two screens a user sees first, two spellings of a subscription expiry field
where only the unvalidated one was ever written. **Which state a payment is in is a worse
candidate for duplication than any of those.**

`hasExpiry` and `wasPaid` come from the classification rather than being re-derived at each call
site, so a badge and the date beside it cannot disagree, and the headline count cannot disagree
with the rows it is counting.

**`wasPaid` IS NOT "NOT EXPIRED".** A grant and an admin-created agency are both current and
neither is revenue. Folding them into a "paid subscriptions" metric would restate G28's error in
a metric instead of a row — a number that looks like income and is not. The card counts only
`wasPaid`.

**And `planAmount` is what was charged, never recomputed from today's price.** A subscription
that recalculated its own amount would rewrite history on a record a GST invoice points at.
Where nothing was charged, the rate is still shown and still labelled *"the rate, not a charge
made"*.

**Verified across all seven states** rather than eyeballed, including the two orderings that
matter:

    no document at all               none      NOT BILLED   hasExpiry false  wasPaid false
    admin, expiryDate null           admin     ADMIN        false            false
    admin, expiryDate absent         admin     ADMIN        false            false
    granted, 18mo ahead              granted   GRANTED      true             false
    active, 1yr ahead, paid 5900     active    ACTIVE       true             true
    active but lapsed yesterday      expired   EXPIRED      true             true
    granted but lapsed               expired   EXPIRED      true             false

The first two lines are the ones that would have gone wrong. **`admin` is tested before expiry**,
because an admin subscription carries `expiryDate: null`, so `Number(null || 0)` is `0`, so an
expiry test reached first would find `0 < now` and render an agency that never had a
subscription as one that **lapsed**. Same class of lie as G28's, erring the third possible way.
The ordering is the entire guard, and nothing about the code makes that visible — which is why
it is asserted in a test and stated in the comment.


## G35. An allowlist that defaults to allow — 176 clauses, and the field it let through

Recorded separately from the stale-notice sweep that found it, because it is not a stale notice.
**It is a rules design that admits every field nobody thought to name**, and unlike a comment
that goes wrong at a moment, this goes wrong **once per new field, forever.**

Every one of the nine validators in `firestore.rules` is built from the same clause shape:

    (!('fieldName' in data) || (data.fieldName is string && data.fieldName.size() <= 150)) &&

Read it plainly: *if the field is absent, pass; if present, it must be the right type.* Which
means **a field the validator does not name is absent from the validator, and therefore passes
unchecked.** The nine of them together carry **176 such clauses** against roughly 20 that
actually require anything:

    isValidAgency            57        isValidPublishedAt        9
    isValidJob               48        isValidSystemConfig       8
    isValidAtMaster          31        isValidSupportTicket      7
    isValidOilTransaction     9        isValidUserRole           4
                                       isValidInspection         3

It reads as an allowlist. It behaves as a **denylist of the fields somebody remembered**, and
the two are indistinguishable until the day they differ — which is the day a new field is added.

**IT HAS ALREADY COST SOMETHING, TWICE.**

`isValidSystemConfig` names six estimate sections, `updatedAt` and `updatedBy`. The Admin
Panel's payment tab wrote **`keySecret`** to that collection, and the validator waved it through
because it had never heard of it. Combined with the `|| true` read grant (G27), the first Save
would have published an API secret to the open internet — **type-checked and permitted by a
function whose entire job is to say what may be written.**

And `isValidAgency` validated `subscriptionExpiresAt` while the TypeScript wrote
`subscriptionExpiryDate`. The validator guarded a field nothing wrote and **waved through the
one that mattered**, so the forgeable field was the unvalidated one. Not a coincidence: an
allowlist that defaults to allow is at its weakest exactly where the code is newest, because a
recently added field is the one least likely to be in the list.

**WHY THE SHAPE IS TEMPTING.** Firestore documents in this app are genuinely sparse — an agency
carries 57 optional fields and most are absent on most documents. Requiring them would break
every existing record. So the `!('x' in data) ||` guard is the correct treatment **for a field
you have decided to allow**. The defect is not the guard; it is that **nothing anywhere states
the closed set.** There is no clause saying *"and no other field may be present."*

**WHAT WOULD ACTUALLY CLOSE IT.** Firestore rules do have the primitive:
`request.resource.data.keys().hasOnly([...])` — an explicit closed set, refusing anything not
listed. Adding it to `isValidAgency` means enumerating all 57 names plus every legacy field on
documents created before the app had a schema, and getting that list wrong locks a customer out
of saving their own agency. So it is not a one-line fix, it is an inventory: **read the live
documents, take the union of every key present, reconcile against the TypeScript type, decide
which of the differences are fields and which are debris.**

That inventory is worth doing and has not been done. It is the same work the estimate-master
census did for rates, and it would answer a question nobody has asked yet: *what is actually on
these documents?*

**THE GENERAL RULE, which is not about Firestore.** A validator that enumerates what is
permitted must also state that the enumeration is complete. Otherwise it is not validating the
document — it is validating the intersection of the document with the author's memory, and
reporting a pass. **The failure is silent, it favours the newest code, and the thing it lets
through is by definition the thing nobody was thinking about.**

Left open deliberately, with the decision recorded rather than taken: closing it wrong is a
lockout, and closing it right needs the inventory first.


## G36. Every shared link was broken, and the ones that mattered most were the help links

The app is client-side routed. Vercel had no `vercel.json`, so any path other than `/` was
looked up as a file, not found, and answered with **404 — NOT_FOUND** before React Router
existed. Refreshing on any screen did it. So did every bookmark, and every URL anyone sent
anyone else.

**THE PART THAT MAKES THIS MORE THAN A REFRESH BUG.** Seven internal links carry a query string,
and five of them are the **setup-gap links**:

    /agency-settings?section=estimate-master     Dashboard, AtMasters
    /agency-settings?section=at                  AppLayout, AgencySettings, NewJob
    /estimates/new?tab=sent                      Dashboard
    /estimates/new?tab=approvals                 Dashboard

Both parameters are genuinely read — `AgencySettings` expands the named accordion, and
`EstimateGenerate` lands on the named stage — so these are not decorative.

Those `?section=` links appear **when an agency has no rates configured**: they exist precisely
because someone is stuck and cannot price a job. Forwarding that URL to ask for help is what a
stuck person does next, and the recipient got a 404 instead of the screen that fixes it. **The
link is generated at the exact moment its recipient most needs it to work.**

Two compatibility routes made the reach wider than the route table suggests. `/estimate-master`
and `/at-masters` are `<Navigate>` entries that preserve `location.search`, kept so old bookmarks
keep working — and a cold load of an old bookmark 404'd before the redirect could run. **The
shims for stale URLs were themselves unreachable from a stale URL.** `AppLayout` also has
`<Route path="*">` sending unknown paths home, which never got the chance to run either.

**THE FIX, AND THE TRAP NEXT TO IT.** One rule:

    { "rewrites": [ { "source": "/(.*)", "destination": "/index.html" } ] }

⚠ **`rewrites`, NOT `routes`.** Vercel evaluates redirects → headers → **filesystem** →
rewrites → 404. Because rewrites run *after* the filesystem check, a path matching a real file
never reaches the rule: `favicon.svg`, `manifest.json`, `robots.txt` and every hashed asset
under `/assets/` are served normally. Exclusions are unnecessary by construction.

The legacy `routes` field — which most older SPA-on-Vercel answers still recommend — runs
**before** the filesystem. `{"src": "/(.*)", "dest": "/index.html"}` would genuinely swallow the
favicon, the manifest and every JS and CSS bundle, returning HTML with a `text/html` content
type wherever a script or an icon was expected. With `routes` you must add an explicit
`{"handle": "filesystem"}` first; with `rewrites` you get that for free.

**And the symptoms would not point at the config.** A blank page, a missing tab icon, an install
prompt that cannot parse its manifest — every one of those reads as a build problem. Someone
would go looking at Vite, at the asset pipeline, at the manifest's contents, and find nothing
wrong with any of them, because nothing is. That is the whole reason this is written down:
the failure mode of the *wrong* fix is a long search in the wrong file.

**No build configuration in the file, deliberately.** Vercel is auto-detecting the Vite setup and
has been deploying successfully; a `vercel.json` overrides only the keys it names, so `rewrites`
alone leaves detection intact. Writing `buildCommand` and `outputDirectory` by hand would replace
something that works and self-updates with something that can silently disagree with
`vite.config` — a second source of truth for no gain, which is the pattern this audit keeps
recording the cost of.


## G37. How agencies are delegated — an access grant labelled "Email Address"

**`agency.email` is a capability, not a contact detail.** `firestore.rules:394` and `:400`:

    allow get, list: … || (('email' in resource.data) && resource.data.email == request.auth.token.email) || …
    allow update:    … || (('email' in existing())     && existing().email     == request.auth.token.email) || …

Any signed-in account whose login email equals that value can **read and write the agency** —
its rates, its estimates, its bills. This is how agencies are handed to customers, it is
deliberate, and **six of twelve live agencies depend on it**:

    DYNAMIC TRAMSFORMER          dynamictransformer@gmail.com
    IDEAL ENGINEERING COMPANY    idealengineering2022@gmail.com
    PATEL ELECTRICALS            patelelectricals83@gmail.com
    ZENITH TRANSFORMERS          zenithtransformers@gmail.com
    UPENDRA                      UTPAREKH@GMAIL.COM
    GUJARAT ENERGY TRANSMISSION  getahm2016@gmail.com

None is the owner's login. `sharedWithEmails` is a second grant of the same kind, used by
nothing.

**IT IS NOT G1 RELAXED, AND THE DISTINCTION IS THE POINT.** G1 removed `isSuperAdmin()` from
every agency write because *a vendor who can edit a customer's rates, estimates or bills is a
liability rather than a capability: if the figures are wrong, the customer cannot say it was not
us.* This mechanism has the opposite structure. **The owner grants access deliberately, to a
named address, on their own document.** The vendor takes nothing and cannot add themselves —
`isSuperAdmin()` is absent from the update rule entirely. One is a party helping themselves;
the other is a party being invited. Both were about who may write an agency, and only one of
them is a hole.

What it shares with G1 is the reason it needed writing down: **it is a permission that lives in
a field, and a field looks like data.**

---

### WHAT IT WAS LABELLED

`Email Address`, placeholder `e.g. info@agency.com`, sitting between the phone number and the
MSME registration number. Nothing on the screen said it granted anything.

So a customer tidying their details could **clear it and lock themselves out**, or **retype it
as their accountant's address and hand over their tender rates** — two irreversible outcomes
from a field that presented itself as a contact detail. The change summary on save said
`Email Address` too, so the last chance to notice said nothing either.

It now reads **Access email — "the login that can use this agency, besides the owner"**, with
the consequences stated: *clearing it removes their access; changing it hands the agency to
someone else.* The value, the state and the write are untouched. Only what the field claims
about itself has changed.

---

### WHO CAN CHANGE IT — and the asymmetry nobody had noticed

The update rule tests permission against **`existing()`**, and constrains exactly one field:
`incoming().ownerId == existing().ownerId`. **`email` and `sharedWithEmails` are not
constrained at all.** So:

| party | can edit the access email? | what happens |
|---|---|---|
| **owner** | yes | may revoke or re-grant freely. **Always safe** — access comes from `ownerId`, which is immutable, so they cannot lock themselves out. |
| **delegated user** | **yes** | they hold write access, so they may rewrite the field that grants it. |
| vendor | **no** | `isSuperAdmin()` is absent from `allow update`. G1 holds. |

**The delegated user is the dangerous case, and it is self-inflicted and irreversible.** The
next write is checked against the *new* value. So a delegated user who edits that field — to
correct a typo, to "update the contact address", to anything — **revokes their own access on
save**, and cannot undo it, because undoing it is another write. Only the owner can restore it.
They can also grant a third party by putting a stranger's address there, or by appending to
`sharedWithEmails`, which nothing constrains.

The owner cannot be locked out by any of this. That asymmetry is correct and is the one thing
the rules already get right here.

**A red warning is now shown to the delegated user only** — not because the owner's edit is
harmless, but because for the owner it is recoverable and for the delegate it is not, and a
warning shown to everyone equally is one nobody reads.

---

### A FRAGILITY WORTH KNOWING ABOUT

**The comparison is exact and case-sensitive.** Firestore rules have `.lower()`; neither clause
uses it. `UPENDRA` stores `UTPAREKH@GMAIL.COM` in capitals, and the grant holds only while that
account's auth token reports the same capitalisation. It reportedly works today — so it does —
but nothing makes it robust: a re-registration, a provider change, or a switch to Google sign-in
normalising to lower case would silently break one customer's access, and the symptom would be
"I can't see my agency" with nothing anywhere to explain it.

Case-folding both sides can only ever **widen** the match — no currently-working grant can stop
working — so it is a safe change whenever it is made. It is exactly the defect
`functions/adminIdentity.js` was written to avoid for the vendor's own email, one file away, and
the same reasoning applies here to six customers.

Not changed here: this entry is a record of the mechanism, and a rules change belongs in a
deploy someone is watching.

**THE TWO RULES CHANGES, AND WHAT THE SECOND ONE REFUSES.**

**Case-folding** (`callerEmailLower`, `emailGrants`) can only widen a match, so no working
grant can break. It closes the fragility above: `UTPAREKH@GMAIL.COM` now matches whatever case
the provider reports.

`sharedWithEmails` **cannot be fully folded** — rules have no way to map over a list, so a
stored entry in capitals cannot be lowered. Both forms of the *caller's* address are tried,
covering a lower-cased entry meeting an upper-cased token; the reverse stays uncovered. Zero of
the twelve agencies use the field, so the gap is theoretical, and removing an unused grant
belongs in its own decision rather than in a case-folding fix.

**The delegate constraint** (`grantsUnchanged`) refuses **exactly one thing that used to be
permitted: a delegated user changing `email` or `sharedWithEmails`.** It refuses nothing else,
and that is checkable rather than hopeful — **every client write to `agencies` is `updateDoc` or
`transaction.update`**, both of which merge, so an untouched field arrives in `incoming()`
carrying its existing value and compares equal. There is no `setDoc` without merge anywhere in
`src/`. A delegated user's ordinary saves — editing details, advancing `lastJobNumbers` on job
creation — are unaffected.

**None of the six could be mid-edit in a way that starts failing**, because the only newly
refused write is one none of them has a reason to make and which, if it succeeded, would lock
them out. The rule refuses the action whose success was the injury.

**Verified by a model, and the limit is stated.** `scripts/admin/model-agency-rules.js`
transcribes the predicates into JavaScript and runs 23 cases across read and update. All behave
as intended. ⚠ **It validates the logic, not Firestore's evaluation of it** — `get(key, default)`
semantics, list equality and short-circuit order are Firestore's, and only the emulator can
confirm those. The emulator needs Java, which is not installed here. Saying which of the two was
checked matters more than the green result: a harness that overstates its reach is the defect
G33 records.


## G38. The slot goes, and two boxes with it

**THE SLOT WAS AN INTERVAL, AND EVERYTHING THAT COULD GO WRONG LIVED IN IT.**

A `new_agency` order used to buy an abstract credit held on `entitlements/{uid}` until it was
spent creating an agency. The defect was not the counter — it was the **stretch of time between
paying and receiving**. A credit can be held for months, leaked by a failed decrement, counted
twice, expire ambiguously, or sit stranded on an account nobody remembers buying it for. Each of
those needed a rule, a screen and a support answer, and none of them was the feature.

Naming the agencies **at purchase** removes the interval. There is no moment where money has
been taken and nothing yet says what for; the invoice can list what was bought; and the
subscription year runs from **the same instant for every agency on the order** rather than from
whenever each credit happened to be spent — which is what makes a single receipt's line items
agree with each other. `entitlements` is deleted outright rather than left empty: an unwritten
collection with a rule and a UI reading `agencySlots` is the hardcoded-truth shape from the
G32–G36 sweep, sitting there reading zero forever until somebody wires it up.

**ALL OR NONE, AND THE IDEMPOTENCY KEY IS WHAT MAKES IT RECOVERABLE.** Up to ten agencies are
created inside the transaction that records the payment — ~150 KiB across 22 writes, against
Firestore's 500-write and 10 MiB limits, so the cap is a **blast-radius limit rather than a
technical one**: ₹59,000 is already a large thing to get wrong, and someone typing thirty names
has misunderstood and should meet a refusal rather than a bill.

The property that matters is the ordering. `payments/{razorpay_payment_id}` is written **inside
the same transaction**, so if creation four of five fails the rollback takes the payment record
with it: the payment is never marked processed and a retry re-runs the whole thing cleanly.
Partial creation cannot happen, and neither can money recorded against agencies that do not
exist. A name clash found inside the transaction **refuses the whole batch rather than skipping
one** — a silent skip would charge for five and deliver four, which is worse than a refusal that
names the clash and leaves the payment retryable.

**NAMES ARE CHECKED TWICE, AND THE SECOND ONE IS THE GUARANTEE.** Before checkout because
refusing after money has moved is not acceptable, and again inside the transaction because
another tab could create a clashing agency in between. Uniqueness is **per owner, not global**:
two unrelated contractors may both legitimately be "PATEL ELECTRICALS", and refusing the second
for a stranger's reason would be refusing a real customer. Within one owner's list two identical
names are indistinguishable in the switcher — nothing tells the rows apart, and their monograms
collide too. Zero collisions exist today, so the rule was closable without touching any record.

**THE TWO BOXES.**

The **standalone Subscription box** answered a question badly. It sat at the top of Agency
Settings and inherited that page's scope — the one agency selected in the context bar — so an
owner with four agencies had to switch between them to learn what they owed. It restated the
context bar's scope in a card twice its size. The **Manage Subscription tab** answers it
properly: every agency the account owns, one row each, **sorted by expiry soonest first** rather
than alphabetically, because the screen's subject is a deadline and an alphabetical list buries
an expiry eleven days away behind four that are not. A summary line — *"4 agencies · next expiry
in 23 days (ZENITH TRANSFORMERS)"* — answers in one line the question that brought the reader
there, instead of making them do the arithmetic across four dates.

The **agency-slots card** sold the credit that no longer exists.

What survives is the **status, inline beside the agency name** — one word, where the name
already is. It renders **nothing while it does not know**: no document, no badge, and a failed
read shows no chip rather than a reassuring one. A status chip is exactly the shape that invites
G28's defect, so it was built to stay silent rather than to guess. The countdown appears only
inside 45 days: a badge reading "310 days left" beside every name is noise that trains the eye to
skip the badge, and then the one saying 9 days is skipped too.

**ADD AGENCY ASKS FOR NAMES AND NOTHING ELSE.** It was a full creation form — DISCOM, GSTIN,
bank details, letterhead, divisions — which made sense when creating an agency was free and
singular. Asking for all of it **five times before a customer is allowed to pay** does not, and
those details are precisely what someone wants to get right slowly rather than inside a purchase
flow. They are entered afterwards, per agency, in the form that already exists for editing one.

**THE VENDOR PATH IS THE SAME SCREEN AND A DIFFERENT SERVER DECISION.** `createAgency` is now
admin-only and refuses everyone else outright — an endpoint that creates agencies for free must
not be reachable by the accounts that are meant to pay. The client sends **no flag** saying who
is calling; the function reads the verified auth token. If the exemption ever moved, the screen
would be wrong and the server would still be right, which is the correct direction for that
mistake to point.

**AND `contactEmail` / `contactPhone` ARRIVE GRANTING NOTHING**, which is the entire reason they
exist separately from `email`. `email` is an access grant (G37): whoever signs in with it can
write the agency. These two are ordinary data for an invoice and a support ticket. **That
nothing in `firestore.rules` reads them is the point**, not an omission.


## G39. A defensive guard that turned a missing dependency into a blank page

Two agencies were created from the admin login. Agency Settings went blank and the previous
agency appeared to be gone. **Nothing was lost.** ADMIN kept all 52 fields, 20 jobs, 21
inspections and 2 AT masters; both new agencies were created correctly, with identical
`createdAt` timestamps proving the batch transaction committed as one write.

The page was blank because **every section of it is gated on `activeAgency`, and `activeAgency`
was null.**

### THE GUARD

`AddAgencyFlow` was written as:

```js
const { agencies, setActiveAgencyId, refreshAgencies } = useAgency() as any;
...
if (typeof refreshAgencies === 'function') refreshAgencies();
```

**`refreshAgencies` has never existed on that context.** The `as any` removed the compiler's
ability to say so, and the `typeof` guard — written to be safe — made the absence invisible at
runtime. The call did nothing, silently, every time.

So the sequence was: the server created two agencies; the context's `agencies` array, populated
once by `getDocs` with no listener on the collection, still held the old two; `setActiveAgencyId`
then pointed at an id that array did not contain; `agencies.find(...) || null` returned null; and
both `{activeAgency && (...)}` regions rendered nothing. **A clean console, a working database,
and a void on screen.**

**THE GUARD IS THE FINDING, NOT THE MISSING FUNCTION.** `typeof x === 'function'` around a
dependency is the sentinel shape wearing a defensive coat: it substitutes a plausible outcome —
"nothing to do" — for a fact it has no way to establish. **It is worse than the crash it
prevents.** A `TypeError: refreshAgencies is not a function` would have named the problem in one
line, on the first run, pointing at the exact call site. Instead the failure surfaced two steps
downstream as an empty page, and cost a diagnosis session to trace back.

The rule: **a guard belongs around a value that may legitimately be absent, never around a
dependency that must exist.** For a dependency, absence is a bug, and the loudest possible
failure is the correct one. `as any` on a context read is the same defect one level up — it
turns a compile-time answer into a runtime silence.

### THE POINTER

`setActiveAgencyId` accepted any id. It also persists to `localStorage`, so the broken pointer
survived reloads — and on the next load it resolved to a near-empty new agency rather than the
one being worked in, which is why ADMIN "disappeared".

It now **refuses an id not present in `agencies`**, and the stored pointer is **validated once
the list is known**, falling back to the first agency. Both cases now *say so* rather than
rendering nothing:

> *The agency last selected is not on this account any more, so ADMIN is selected instead.
> Nothing has been changed or removed.*

Same class as F84, where a stored AT selection that had been superseded was quietly honoured and
the operator was left to work out why every screen showed last year's work. **The app doing
something sensible and silent is not the same as the app being understood.** And the last
sentence of that notice is the one that matters: a person whose twenty jobs have apparently
vanished needs to be told they have not.

### THE SIDE EFFECT

Creation used to select the first agency it made. That is removed.

**Creating an agency is a setup act, and being moved out of the one you are working in is a side
effect nobody asked for** — the same shape as a read causing a mutation, which was removed from
the AT list for exactly this reason. The operator was mid-task somewhere; they did not ask to
leave. The success note now says where the new agencies are, the selector is two lines above it,
and switching is one deliberate act rather than an undo of something that happened to them.

**And the documents now come back from the server** rather than the client rebuilding them. The
client holds the same seed code and would produce an identical object — proved by
`verify-seed-equality` — but local state should be the server's account of what was written, not
the client's assertion about it. Without `createdAt`, which is a `serverTimestamp` sentinel and
would put a `FieldValue` where React state expects a date (A5).


## G40. Three admin actions, and a capability that argued against its own use

**THE LABEL THAT MADE A WORKING PATH UNREACHABLE.** Every row in Manage Subscription offered
"Renew a year" — including rows reading **NOT BILLED**. The path worked:
`createSubscriptionOrder` requires only an owned agency and never checks for a subscription, and
`verifySubscriptionPayment` reads `prev = exists ? data : {}` and then `tx.set`s, which **creates**
the document when none exists. Paying on an unbilled agency has always produced a correct
`active` subscription.

But a row saying NOT BILLED beside a button saying *Renew* tells its reader there is nothing to
renew, and they do not press it. **The capability was reachable and unreachable at the same time,
through wording alone** — and no test, type or rule could have caught that, because every one of
them would have found the path working. It now reads **Subscribe** when `key === 'none'`.

Worth naming as its own class: a defect where the mechanism is correct and the affordance denies
it. It looks like a missing feature from outside and like a working feature from inside, and the
two views never meet.

---

**THE THREE ACTIONS.** Cancel, grant days, mark paid — through `adminSubscriptionAction`,
admin-only from the verified token. They could not be client writes whatever the caller's
privileges: `subscriptions/{agencyId}` is `allow write: if false` for everyone, because that
total denial is the only construction that makes "only the server may write this" true in
Firestore (G29). The buttons that used to stand there wrote to the customer's **agency** document
across accounts, were disabled by G1, and were then relabelled *"Server-written"* — which
described the obstacle rather than removing it.

**CANCEL SETS THE EXPIRY TO NOW AND CHANGES NOTHING ELSE.** `expired` is not a stored value in
this system — it is what `classifySubscription` derives from an expiry in the past — so moving
the expiry *is* the whole of cancelling. Writing `status: 'cancelled'` as well would create a
fifth provenance for something that resolves to an existing state, and the two would disagree the
moment one was updated and the other was not.

**But cancellation is a different axis from provenance, and that is why it is a flag.** `active`,
`granted` and `admin` say how a subscription **came to be**; cancelled says how it **ended**. A
granted subscription that was cancelled is both, so folding them into one field would force a
choice between two facts that are both true. The original status therefore survives a
cancellation — overwriting it would destroy the answer to *"what was this before it ended"* in
order to record that it ended.

`cancelledAt`, `cancelledBy` and a **required** `cancelReason` carry the rest, and the badge reads
**CANCELLED** rather than EXPIRED. Same key, same handling, different word: *a subscription that
ran out and one that was ended are different facts even though both are expired.*

**MARK PAID IS REVENUE AND IS NOT VERIFIED, AND THOSE ARE TWO BOOLEANS.** A cheque is money
received, so `wasPaid` is true and the revenue count includes it. But only a gateway payment has
a record to reconcile against, so `verified` is false. **`wasPaid && !verified` is precisely the
set somebody has to chase through a cheque book**, and a single "paid" flag would erase that — a
loss that surfaces only at a reconciliation nobody can finish. The reference (cheque number, UTR,
"cash, receipt 14") is **required by the server**, because a manual payment without one is a
grant wearing the word "paid". The metric card names the manual share rather than folding it in.

**GRANT DAYS extends from the existing expiry when that is ahead**, identically to a paid
renewal. Two ways of adding time that compute the end date differently would be a defect waiting
for the first person to compare them.

---

**THE BOUNDARY BUG, AND WHY THE TEST FOUND IT.**

`cancel` writes `expiryDate: now`. The expiry test was `expiry < now`. At the instant of
cancellation those are **equal**, so the branch did not fire and a subscription rendered
**ACTIVE at the exact moment it was cancelled**, flipping only a millisecond later.

It was caught because the test case used **the value the code actually writes** — `expiryDate:
now`, `cancelledAt: now` — rather than a comfortable `now - 86400000`. A test written with
yesterday's date passes and ships the defect. **The boundary is the case; anything either side of
it is the easy part.**

Fixed as `cancelled || (expiry && expiry <= now)`. The `<=` corrects the arithmetic; the
`cancelled ||` makes the intent independent of clock arithmetic altogether, which is the more
durable half — an ended subscription is ended, whatever a comparison says about the boundary.
Twelve cases now cover the vocabulary, including a cancelled grant (not revenue) and a cancelled
paid subscription (still revenue).


## G41. Six policy pages, and ten claims that were not true

Razorpay's merchant review checks for policy pages **publicly reachable at their own URLs**. The
site had two documents and no mechanism for a URL.

**THE STRUCTURAL DEFECT WAS THE ROUTER, NOT THE MISSING PAGES.** `BrowserRouter` lived inside the
signed-in branch of `App.tsx`:

```jsx
if (!user) return <LandingPage … />;
return (<ThemeProvider><AgencyProvider><BrowserRouter>…</BrowserRouter></…>);
```

So when signed out there was **no router at all** and every path rendered the landing page.
Combined with the SPA rewrite from G36, `transregister.com/terms` returned HTTP 200 and showed a
marketing page. The Terms and Privacy documents that did exist were **modal state** —
`isTermsModalOpen`, `isPrivacyModalOpen` — with no address at all: nothing to link, bookmark,
send, crawl or hand to a reviewer. **A term you accept by signing in has to be one you can read
without signing in**, and these could not be.

**Public pages are now matched from `window.location.pathname` before the auth check**, rather
than through the router. Three reasons, and the first is the one that matters: a policy page
must not depend on authentication resolving, or on it resolving a particular way — a reviewer
sees the document immediately and identically whether or not they are signed in. Second, it
avoids nesting one `<Routes>` inside another: `AppLayout` has its own router with absolute
paths, and putting the app under a catch-all makes those resolve relative to the parent match —
a subtle breakage across twenty-two routes for no gain. Third, these are **documents, not app
screens**; plain `<a href>` and a full page load is what a reviewer does anyway.

Six pages: `/pricing`, `/terms`, `/privacy`, `/refunds`, `/shipping`, `/contact`.

---

**THE SELLER WAS NOWHERE ON THE SITE.** `MSD CORPORATION` and the GSTIN appeared only in
*comments* in `lib/pricing.ts`; `MEGHA HASMUKHBHAI PANCHAL` appeared nowhere at all. The site
identified its operator as "© TransRegister" and nothing else — no entity, no GSTIN, no address,
no phone. A processor must verify that whoever takes the money is whoever the site says runs it.

**The legal party is the PROPRIETOR, not the trade name**, and on these pages that is not
pedantry. The GSTIN's fifth character is `P`, marking a proprietorship: there is no company, and
`MSD CORPORATION` is a style the proprietor trades under. It cannot be a party to a contract
because it is not a person or a body corporate. Writing it alone would name nobody a customer
could hold to anything — and it would not match the GST registration or the bank account, which
is itself a rejection cause.

**The address and phone are `[registered address]` and `[phone]`, and they render as
`TO BE SUPPLIED` in red.** They cannot be inferred or borrowed from a sample; they are checked
against the registration. `/contact` shows a banner saying it is incomplete. **A page that looks
finished while missing its address is worse than one that admits it.**

---

**TEN FALSE SERVICE CLAIMS, WHERE THE FIRST COUNT SAID TWO.** The report that opened this work
said "on the landing page twice and in Terms section 6". A proper sweep found:

    the top notice bar          "24/7 Technical Support Active"
    the nav                     "24/7 Support"
    the mobile menu             "24/7 Technical Support"
    a statistic tile            "24*7" over "Tech Support"
    a section heading           "24*7 Technical Support & Cloud Reliability"
    a card                      "24*7 Live Helpdesk"
    a heading                   "Enterprise SLA & Support Guarantee", "99.9% uptime"
    a button                    "Read Full Legal Terms & SLA Agreement"
    an FAQ answer               "Our cloud operations and engineering team offer 24*7…"
    the closing line            "…with 24*7 technical assistance"
    the footer                  "24*7 Support"
    Terms §6                    "24*7 support monitoring"

**None of it was true.** Support is one person answering a ticket form; the support panel is
unbuilt by explicit decision; no SLA was ever offered and the Terms now say so; and nobody
measures 99.9% of anything. **A percentage nobody measures is a number invented to look like
one**, and "Enterprise" described nothing at all.

The undercount is worth recording on its own. I grepped for the phrasing I had already seen
rather than for the claim, found two instances, and reported two — the same shape as every
census in this audit that counted what it expected. **The correct question was "where does this
page promise support", not "where does the string 24*7 appear."**

What replaced them says what is **true**, and it is the better claim anyway: the software runs
unattended on Google Cloud and is available at any hour, so a job card can be raised whenever
the work happens. Support is answered by email during working hours. The useful half of the
original claim was the accurate half; the invented half was doing no work.

---

**AND THE PRICE IS PUBLIC FOR THE FIRST TIME.** ₹5,900 existed only behind a login. `/pricing`
shows it with the GST split, the multi-agency arithmetic and the renewal rule — all read from
`lib/pricing.ts`, because a price typed into a policy page would be a tenth literal of a figure
that was already wrong in nine places (G27), in the one place it must never drift.

The stale `Version 2.5 • August 2026` header is gone with the modal: a version literal G26
deleted from the login page for encoding a fact nothing updated, surviving on the document where
being out of date matters most. It is a single "Last updated" date that somebody must change
when they change the text.


## G42. Three answers to how long a repair is guaranteed, and a seed that is not a setting

**THE GUARANTEE PERIOD HAD THREE INDEPENDENT SOURCES, TWO OF WHICH PRINTED ON THE SAME BILL.**

    the certificate    certMonthsText, FREE TEXT defaulting to "Twelve/Eighteen", typed by an
                       operator onto a signed guarantee certificate
    the Guarantee Card agency.gpValidationMonths
    the Dashboard      a hardcoded eighteenMonthsMs

A number that decides whether a repair is free is not a number three screens should each have
their own opinion about. The free-text box is the worst of the three: **a commitment about how
long a repair is warranted, entered as prose**, with nothing checking it against the tender, the
core type, or the two other places the same period was stated.

It is now one resolver reading one source. **The source is the AT, because the guarantee is a
tender term** — A/T 1819 clause 38.2 sets it and another A/T may set another. On the agency it
would survive a rollover and quietly apply the previous tender's terms to this tender's work,
which is the F84 shape. And `job.gpGuaranteeMonths` is still stamped at save, which is what makes
it safe in the other direction: a unit dispatched under 1819 keeps 1819's guarantee after 1819
closes, because the answer travels with the job.

**The Dashboard's flat eighteen went with them.** Leaving it while the guarantee became a tender
term would have kept a third opinion — which is precisely how the first two came to disagree.

---

### THE HARDCODED-TRUTH SHAPE AVOIDED RATHER THAN COMMITTED

The Guarantee Card prints *"18 months for 11 KV and 12 months for 22 KV"*. The obvious move was
to derive a single number from the job's core type and print that. **It would have been wrong.**

**This app has no voltage field on a job.** `InternalInspection` renders *"(assumed — voltage
class not set)"*. So printing one number asserts 11 KV for a transformer whose voltage was never
recorded — a figure that is right only while an assumption holds, on a signed document, with
nothing to catch it when the assumption fails.

The sentence as it stands is accurate, matches clause 38.2 exactly, and says nothing false. It
is kept. **This is the shape the stale-truth sweep exists to remove, recognised before it was
created rather than after** — and worth recording as such, because every other instance in this
audit was found afterwards.

### LSTC / PAT DEFERRED, WITH THE COST OF DOING IT WRITTEN DOWN

Clause 38.2 gives SDT/PAT six months. **This app has no such core type.** LSTC exists only as a
job-number prefix; no live division has a `prefixLSTC`; not one of the 64 live jobs carries it.
A six-month default keyed to something nothing can select **would be a setting that does
nothing** — the sweep's whole subject, arriving new.

What it would take, so this is a decision and not an omission: LSTC as a real core type in the
intake form and the pricing paths, a prefix field on the division form beside the existing
three, and then the six-month default follows from the core type it attaches to. Said on the
form itself, not only here.

---

### WHAT THE MOVE CHANGED FOR LIVE DATA — MEASURED FIRST, AND THE SAMPLE IS SMALL

`gpValidationMonths` decides whether a GP job may be **saved**, so moving its source changes what
is acceptable at intake. Measured before moving:

- **All fourteen agencies were on 18** — twelve explicitly, three by fallback. **Not one on
  anything else.**
- **All six live GP jobs** pass identically before and after. **Zero changed.**

**⚠ AND THAT SAMPLE IS SIX GP JOBS IN ONE AGENCY — `MEGHA`, a test record excluded from the
founding grant.** The result is real and it is not "verified across 64 jobs". The live GP path
has only ever been exercised on test data, and this entry says so on purpose: a later reader
finding "zero changed" should know what it was zero across.

**TWO GP JOBS HAVE NO ANSWER AND NEVER DID.** `MSBT-6` and `MSBT-12` carry no
`prevDeliveryDate` and no `gpGuaranteeMonths`. The window was never evaluated for them and no
term was stamped, so *"was this repair within its guarantee?"* has **no stored answer** — not a
wrong one, none. They predate the validation, this change neither caused nor worsened it, and
they are the records that would be unanswerable if anyone ever asked. Recorded because a gap
nobody has written down is a gap nobody will find.

---

### THE STARTING JOB NUMBER IS A SEED, AND THE −1 IS REAL

`lastJobNumbers[key]` holds the **last used** number; `predictNextJobNo` returns `last + 1`; an
absent counter reads 0 so the first job is 1. **An agency joining a tender part-way and starting
at 47 types 47 and the code stores 46.** Storing 47 would make its first job 48.

That conversion lives in `seedFromStartingNumber` and nowhere else, because an off-by-one that
appears in two places is the kind that ships.

**It is inert once the counter has moved, and the field says so.** The save recomputes
`lastJobNumbers` from the real job numbers it writes, monotonically, so after the first job a
starting number cannot change anything. The input **disables itself**, shows the last issued
number, and explains in its tooltip that a starting number only seeds an unused counter.
**A control that quietly stops working is read as broken** — a disabled field that explains
itself is better than an editable one that does nothing.

A wrong starting number cannot corrupt anything: the counter only moves forward, and a
suggestion that collides with an existing job number is refused at save (`NewJob:1286–1343`,
with a deliberate exception for a GP unit returning under guarantee).

**⚠ AND THE COUNTER KEY COMES FROM `getCounterKey`, NOT A SECOND COPY OF IT.** The first draft
derived `${div}_${ct.toUpperCase().replace(' ', '_')}` by hand, which produces the identical
string for all four core types today. That is exactly the parallel-implementation shape
`AgencyContext` warns about three lines above `getCounterKey` itself — and the failure it would
cause is silent: a seed written under a key nothing reads, and numbering that restarts from 1.

---

### THE PRINTED DOCUMENTS: TWO SUBTREES MOVED, NOT ONE

The prediction was one — the certificate. **Two changed**, and the second was foreseeable:

    CHANGED  BillingSystem.tsx#1   1997 -> 1981 bytes   the guarantee certificate
    CHANGED  BillingSystem.tsx#2  22840 -> 23574 bytes  the tax invoice, which carries the
                                                        Guarantee Card
    byte-identical 11   changed 2   new 0   removed 0

The second moved because the Guarantee Card's expression changed from
`activeAgency?.gpValidationMonths || 18` to `certGuaranteeMonths`. **Both render 18 today** — no
AT carries `guaranteeMonths` yet and every agency was on 18 — so the printed output is unchanged
in value while the source is not. The harness hashes source, which is why it reported the change
correctly and why the prediction was wrong: I counted the documents whose *text* I was editing,
not the subtrees whose *source* I was touching.


## G43. A used field with no reachable purpose, and one core type that is two things at once

### THE DEFECT: THIRTEEN AGENCIES CONFIGURED SOMETHING THEY COULD NEVER USE

**Thirteen agencies and five ATs carry real LSTC job-number prefixes** — `ZTLSTC`, `LSU`, `LPLN`,
`KLLSL`, `DTLSTC`, `LS21 IS`, `L21 IS`, `LAAR`. Deliberate, agency-specific values, typed by
operators into an input that exists on the division form and always has.

**Not one job can ever carry that core type**, because `NewJob`'s core-type select offered three
options: CRGO, Amorphous, Wound Core. Zero live jobs have an LSTC core type, and none could.

This is a different shape from anything in the stale-truth sweep. Those were **claims that went
false** — a notice saying "not built yet" about something built, a count of subscriptions nobody
had. This is **configuration that was correct, deliberate, saved, read by `getJobNoPrefix`, and
connected to nothing.** A used field with no reachable purpose.

It is also invisible from either end. From the division form the field works: you type a prefix,
it saves, it comes back. From intake, LSTC simply is not among the options, and nothing suggests
it should be. **Only someone holding both screens at once could see it**, which is why it
survived — and it is the same structural blindness as the two subtitles in G26, where no screen
showed both.

I reported this wrongly first, and the correction matters more than the original claim: I said
*"no live division has a `prefixLSTC`"* and *"a field that is saved and can never be set."* Both
false. I had grepped the section of the file I had just written rather than the file. **The
field renders at `AtDivisions:411` and thirteen agencies had filled it in.**

---

### LSTC / PAT IS TWO THINGS AT ONCE, AND BOTH ARE THE TENDER'S DOING

**It prices as CRGO.** Schedule-A's own header reads *"ITEM-WISE RATE FOR REPAIRING OF DAMAGED
11/22 KV, 5 to 500 KVA CRGO (STACK/Wound/DRY/PAT/SDT) / Amorphous Core DIST. TRANSFORMERS"* —
PAT and SDT appear there as **sub-types of CRGO**, not as a separate core. Clause 48.0 says it
again: *"UGVCL reserves the right to repair SDT, PAT and PLMT in line with CRGO rates and
conditions."*

⚠ **So the absence of an LSTC pricing branch is the tender's instruction, not a gap.** It falls
through to CRGO deliberately. A reader who finds LSTC missing from a core-type switch and "fixes"
it by adding a branch will have introduced a divergence the tender forbids. That is the specific
mistake the note in `classifyCoreType` exists to prevent, and it is prominent there rather than
being a passing remark.

**It numbers and guarantees as itself.** Its own prefix and counter, and **six months** rather
than CRGO's eighteen, because clause 38.2 names it: *"11 / 22 KV SDT / PAT, various ampere
ratings — 6 months"*.

**⚠ AND THOSE TWO CLAUSES ARE IN TENSION — AN AMBIGUITY IN THE TENDER, NOT IN THE APP.** 48.0
says *"CRGO rates **and conditions**"*, and CRGO's condition is eighteen months. 38.2 names
SDT/PAT explicitly at six. The specific clause beats the general one, so six stands. But the
disagreement is real, it is in the document, and being able to point at it later is worth more
than the sentence costs.

**One label, not two.** The tender says SDT/PAT/PLMT and the app says LSTC, and the tempting
split — tender's word on print, app's word on screen — is exactly what G26 was about. An
operator would select "LSTC" at intake and read "SDT/PAT" on the estimate for the same
transformer minutes later. `LSTC / PAT` everywhere: LSTC because thirteen agencies have already
typed it, `/ PAT` because that is the tender's word and makes the connection legible on a
document.

---

### OVERHAULING HAS NO GUARANTEE, VERIFIED TWICE

- **`1819AT.md`**: the word "overhaul" **appears nowhere**. Clause 38.2's table lists four types
  and overhauling is not among them.
- **`schedule-a-ugvcl-2026.md`**: Sr. No. 21 is *"Overhauling of transformer including outside
  cleaning and painting"* — a rate row with KVA-band prices. Searching the entire schedule for
  "guarantee", "warrant" or "month" returns **nothing, for any item**.

38.2's own framing supports the silence: it guarantees *"the whole unit irrespective of parts
repaired or replaced"* — a warranty on a **repair**. Overhauling replaces nothing.

So `guaranteeMonthsFor` returns **`null` for OH, not `0`**. Zero months reads as a guarantee that
has expired; null is the absence of one, and on a signed certificate that difference is the whole
meaning.

**Three consequences, each a decision:**

- **The certificate lists one clause per core type on the bill**, and names overhauling as
  carrying none. It previously took its period from `selectedJobsData[0]` — so an MR with an OH
  job first would have certified "no guarantee" across an otherwise-CRGO bill.
- **It lists rather than stating the shortest.** The shortest would understate the guarantee on
  every unit that is not the shortest: a claim against oneself, but a **false** one. A
  certificate that says less than the truth is not the safe option, it is a different wrong
  number.
- **An all-overhauling bill prints no Guarantee Card at all.** A card headed "Guarantee Card"
  saying "no guarantee" is worse than its absence — the heading is the claim, and a reader takes
  the card's presence as the fact.
- **A GP booking on an OH job is refused before the window is computed**, with that reason.
  Previously it was measured against eighteen months like everything else and would usually have
  passed — booking a free repair under a guarantee that does not exist.

---

### THE SECOND SILENT COUNTER BUG, CAUGHT THE SAME WAY AS THE FIRST

`getCounterKey` tested `type === 'OH'` **exactly**, while `classifyCoreType` next door tested
`type === 'OH' || type.includes('OVERHAUL')`. **Two spellings of one question, agreeing until
something passed the long form** — and the new divisions table does exactly that: its row label
is `"Overhauling"`, which fell through every branch to `${div}_CRGO`. An overhauling starting
number would have seeded the **CRGO** counter.

That is the same failure as LSTC falling to `else`, in a branch that already existed. Both were
found the same way: **a table of every core type against the key it produces**, run rather than
read. Nine cases now, and the check is the reason two silent defects became two lines.

---

### THE LAYOUT

One table per division, **core types as rows**: prefix, starting number, guarantee. Core type is
the row because **it is the axis that gains members** — this change alone added the fifth. Rows
grow downward without reflowing; columns do not.

It replaced three separate blocks in three different column orders, none of which shared an axis:
the guarantee had no division dimension at all. Answering *"what is SABARMATI's Amorphous
setup?"* meant reading a prefix in one block, a starting number in another and a guarantee in a
third.

The guarantee stays **read-only in each row with a single editor above**, because it is per-AT
and not per-division. An editable field repeated on every division would imply it varies by
division — which is the confusion G42 corrected.


## G44. A one-rupee proof, and the document deliberately not written

Razorpay approved the account, so the next deploy moves real money. The question was how to
verify the live configuration without inventing a customer.

**THE ANSWER WAS TO WRITE NOTHING.** A `live_check` order charges ₹1, verifies the signature, and
writes **only** the `payments/{razorpay_payment_id}` record. No subscription, no entitlement, no
agency touched.

The obvious design was a ₹1 payment marked as a test and excluded from the revenue count. That
would have needed **a flag on the document, a branch in `classifySubscription`, a case in the
metric card, and a row on the admin table saying "ignore me" — four things that can later be got
wrong, against zero for a document that is never created.** Same lesson as deleting
`entitlements` rather than leaving it empty (G38): the record you do not write cannot be
mis-filtered.

It works because of a fact the measurement established rather than assumed: **revenue is counted
only from `subscriptions`.** `AdminPanel` filters `subsByAgency` by `wasPaid`, and **no client
screen reads `payments` or `payment_orders` at all.** So a payment record with no subscription
behind it is invisible to every figure the vendor looks at, by construction rather than by
filtering.

**What it actually proves:** the keys authenticate against the Orders API, checkout opens against
the deployed key pair, the HMAC verifies with the deployed secret, and the idempotency write
lands. **What it does not prove:** that a ₹5,900 subscription writes correctly — already proven
in test, and the code path is identical from `verifySubscriptionPayment` onward. Naming both
halves matters: a check whose reach is overstated is the G33 defect.

### `invoicePending: false`, and why the queue only works if everything in it is real

Every other verified payment sets `invoicePending: true`, and that queue is the **forcing
function** for the unresolved SAC-code decision — it grows until somebody issues the invoices.

A ₹1 gateway check must not enter it. A GST invoice sequence is gap-free by law, so a fake line
in the queue becomes either a hole in a real numbering or an invoice for a rupee nobody can
explain. **And the queue stops working as a forcing function the moment it contains something
that does not need acting on** — one entry that can be safely ignored teaches the reader that
entries can be safely ignored.

### NO TEST_MODE SWITCH, DELIBERATELY

Razorpay's mode is the key pair: an order created with `rzp_live_` keys is real and one created
with `rzp_test_` keys is not. There is no runtime selector, and **none was added.**

A `TEST_MODE` flag would put *"does real money move?"* behind a value someone can change, and its
failure mode is **believing you are testing** — the worst possible direction for that particular
mistake. The key pair being the mode is a stronger guarantee than any flag, because nothing in
the application can confuse the two and no code path can get it wrong.

The consequence is accepted rather than worked around: going live means every payment is real.
The ₹1 check is what makes that acceptable — it is a better test than test mode, because it
tests the thing you actually want to be true.

### THE PAYMENT ID NOW COMES BACK ON SUCCESS

`payWithRazorpay` carried the payment id only on `PaymentTakenButUnverified`, where it is
desperately needed. It is now on the success result too.

**A verification whose result cannot be found afterwards has verified nothing anybody can point
at.** The check's entire output is an id to look up in the dashboard — which is also how the
operator confirms *which mode it landed in*, independently of what this application claims.

### ADMIN-ONLY, FROM THE VERIFIED TOKEN

`live_check` is refused for anyone but the vendor, decided from `request.auth.token.email` by the
same `isSuperAdmin` the other privileged paths use. The client sends no flag. An endpoint that
charges its caller must not be reachable by the accounts that are supposed to be charged
properly.

The amount is `LIVE_CHECK_PAISE = 100`, a server constant. **No amount is read from the request
anywhere in this file** — verified by grep, not by memory — because an order endpoint that
accepts an amount is the most common form of the worst bug in a payment system.


## G45. An `else` that was correct while there were two kinds

The ₹1 gateway check failed with **"No agency names were given."**

`createSubscriptionOrder` branched on kind as:

```js
if (kind === 'renewal') { … } else { validateNames(…) }
```

written when `else` meant exactly one thing. Adding `live_check` gave it an entry in
`ORDER_KINDS`, an admin guard, its own amount, its own receipt shape and its own verification
branch — **and left this two-way test alone.** So the new kind inherited name validation written
for `new_agencies`, and the client's honest `agencyNames: []` tripped a check it should never
have reached.

### THE FAILURE MODE IS INHERITANCE, NOT ABSENCE

This is why it is harder to see than a missing case. **A missing case does nothing, and nothing
is conspicuous. A case that falls into `else` does something — and something plausible.** The
error message named a real check, referred to a real field, and described a real requirement.
It just belonged to a different kind.

Nothing in it said *"this branch was not written for you."* Every part of the failure looked
like a correctly working validation, which is exactly what it was.

### TWO LISTS THAT MUST AGREE, AND NOTHING MADE THEM

`ORDER_KINDS` and the branch list are two enumerations of the same set, maintained by hand, with
no mechanism connecting them. **Adding to one without the other is silent** — the array accepts
the kind, the switch quietly hands it someone else's behaviour.

The fix is not the missing branch. It is the **terminal `throw`**: a kind listed in `ORDER_KINDS`
with no branch of its own now announces itself by name rather than borrowing whichever branch
happens to be last. A disagreement between the two lists is loud instead of invisible.

**And `verifySubscriptionPayment` already ended that way** — `throw new HttpsError(…, \`Order
${orderId} has no usable kind.\`)`. The two halves of the same file disagreed about how to handle
an unrecognised kind, one throwing and one falling through. **The order function was the odd one
out, and nobody noticed because with two kinds the `else` happened to be right.** A safety
property that holds by coincidence looks identical to one that holds by design, until the
coincidence ends.

### THE TELL WAS TWO LINES BELOW, AND I WROTE IT

Adding `live_check`, I changed

```js
const quantity = kind === 'renewal' ? 1 : agencyNames.length;
```

to

```js
const quantity = kind === 'new_agencies' ? agencyNames.length : 1;
```

**for exactly this reason** — a binary test is unsafe once there are three kinds, so name the one
you mean. The reasoning was correct, it was applied deliberately, and it was applied to **one of
the two binary tests in the same function**, two lines apart. I fixed the instance I happened to
be editing and did not look up.

That is worth more than the bug. **Recognising a hazard is not the same as searching for it**,
and a correct piece of reasoning applied to the site in front of you is how a codebase ends up
with one fixed instance and one live one — which is the parallel-implementation shape this audit
keeps recording, in miniature, inside a single function.

### SCOPE, MEASURED RATHER THAN ASSUMED

- `renewal` has its own explicit branch and never reached `validateNames`. **Renew a year and
  Subscribe worked throughout; a customer could always pay.**
- `new_agencies` reached the `else`, where the validation was the right one.
- **Only `live_check` was broken**, and it failed *before* an order was created — so no money
  moved and no partial state exists. A refused order is the safest failure available here.
- The client was correct throughout: `createOrder('live_check')` sent `kind: 'live_check'`.

A check now asserts that every member of `ORDER_KINDS` has a branch in **both** functions, and
that both end in a throw. Three kinds, six branches, two terminal throws.


## G46. A rule that worked because nobody had six agencies

`subscriptions` was readable by its owner via a lookup on the agency:

```
allow get, list: if isSuperAdmin()
                    || (isSignedIn()
                        && exists(/databases/$(database)/documents/agencies/$(agencyId))
                        && get(/databases/$(database)/documents/agencies/$(agencyId)).data.ownerId == request.auth.uid);
```

**Two document-access calls per row, against a Firestore limit of ten per query evaluation.**

`ManageSubscription` runs a LIST. So the tab worked at four agencies (eight calls) and **failed
entirely at six** — not a truncated result, not a partial page: the whole query denied, every row
rendering `NOT READ`. The screen whose purpose is answering *"what do I owe and when"* would have
answered nothing, for the customers with the most to owe.

**Live counts when it was found:** 4, 3, 2, 1, 1, 1, 1. The largest owner was two agencies below
the ceiling.

### THE SHAPE

**A rule whose correctness depends on how much data exists.** It is not wrong today and it was
never right — it had a capacity, nothing declared it, and nothing would have announced crossing
it except a customer reporting that their subscriptions had disappeared.

That is the same shape as the hardcoded truths in the G32–G36 sweep, one level down: not a claim
that goes false at a moment, but a **guarantee that holds only while a quantity stays small.**
And it is harder to see than a stale notice, because there is nothing to read — the rule says
what it means, does what it says, and has a limit that appears in neither.

The tell was available and unremarkable: **`get()` inside a rule that serves a list.** A
per-document lookup is fine for a `get` and a trap for a `list`, and nothing in the syntax
distinguishes the two.

### THE FIX, AND WHY IT IS SAFE RATHER THAN MERELY CHEAPER

    allow get, list: if isSuperAdmin()
                        || (isSignedIn() && resource.data.ownerId == request.auth.uid);

Zero document-access calls. Every row is decided on its own data, so **the verdict cannot depend
on the number of rows** — the ceiling is not raised, it is removed.

The obvious objection is that this reads a **copy** of ownership rather than the authoritative
value, and a copy is a second source of truth. It is safe here for one specific reason:
**`agencies.ownerId` is immutable.** G1 pinned it — `incoming().ownerId == existing().ownerId` on
every update, and the rules refuse an agency delete outright. **A value that can never change
cannot be denormalised wrongly.**

⚠ **So this depends on G1 and must be reverted if G1 is.** If `ownerId` ever becomes mutable, a
subscription's copy becomes capable of being stale and the lookup has to come back. That coupling
is noted on both sides, because a one-way note is only found by whoever happens to read the right
entry — which is never the person about to break it.

**Checked against live data before changing, because this narrows access:** all 13 subscriptions
carry an `ownerId`, and **every one equals its agency's**. Zero missing, zero disagreeing. A
single subscription without the field would have locked its owner out.

**And a LIST now requires the query to filter on `ownerId`** — which `ManageSubscription` already
does, and the Admin Panel's unfiltered list is covered by `isSuperAdmin()` above it. Both readers
checked rather than assumed.

Six cases added to `model-agency-rules.js`, including an owner with **six** subscriptions — the
count that used to fail. The model cannot count Firestore's calls, so what it asserts is that the
predicate needs no lookup at all.


## G47. A blank page with no error, latent for two weeks, exposed by fixing the routing

`/agency-settings` rendered the tab bar and nothing below it on refresh. No console error, no
network failure, no thrown exception visible anywhere — and the data was fine throughout.

**`AgencySettings.tsx` called three hooks after an early return.**

```
103:  if (loading) return <Loader2 … />;
125:  const [estimateOpen, setEstimateOpen] = useState(false);
183:  const [settingsParams] = useSearchParams();
184:  useEffect(() => { … });
```

React requires the same hooks in the same order on every render. The render that took the
loading branch called fourteen; the next called seventeen; React threw **"Rendered more hooks
than during the previous render"** — minified **#310**. The component died *during render*, so
nothing below it mounted.

### WHY IT LOOKED LIKE THREE DIFFERENT BUGS

The symptom was indistinguishable from an agency that would not load, and it was diagnosed
twice against the wrong cause:

- first as the **missing SPA rewrite** — ruled out by `curl`: `/agency-settings` returns
  `200 text/html`, and a missing rewrite gives a Vercel 404, not a blank page;
- then as the **`activeAgency` gating from G39** — ruled out by probing the *deployed* bundle for
  `registerCreatedAgencies`, which is present;
- then as the **8-field new agencies lacking a field some section gates on** — ruled out by
  reading every gate: `EditAgencyForm` guards all twenty-odd fields it reads, and Region B's
  "no AT period" notice is the correct render for an agency without one.

Every one of those was a real, plausible mechanism for a blank page. **The wrong diagnoses were
not careless; they were the available hypotheses, and each cost a round trip.** What ended it was
the console — and the console only spoke because the operator went and got it.

⚠ **The lesson is about the "no console error" report.** That was true and it was the most
misleading fact available: a minified React error is not a red `TypeError` with a stack in
application code, and it is easy to look at the console, see nothing recognisable, and report it
clean. **"No error" and "no error I recognised" are different claims**, and diagnosis proceeded
for two rounds on the stronger one.

### WHY IT SURVIVED TWO WEEKS

The early return is from the initial commit (11 Aug); both later hooks arrived on 26 Aug. So this
was broken for a fortnight.

**It only crashes when the branch is taken on the first render.** Navigating to Agency Settings
in-session finds `loading` already `false`, so the first render calls every hook and stays
consistent forever. A **cold load** renders once with `loading` true and once without.

⚠ **And a cold load of that URL was impossible until G36.** Before the SPA rewrite, refreshing
`/agency-settings` returned a Vercel 404 and never reached React at all. **Fixing the routing
exposed a render bug that the routing had been hiding** — the previous defect was masking this
one, and repairing the outer one was what made the inner one reachable.

That is worth holding onto: **a fix can promote a latent bug to a live one**, and the new failure
looks like a regression in the thing just fixed. It was blamed on `vercel.json` first for exactly
that reason.

### THE CHECK, AND ITS OWN FALSE START

`scripts/admin/hooks-after-return.js` finds hooks that follow an early return in a component
body. It runs clean now and fails loudly on a reintroduced offender.

⚠ **The first two attempts at this check were worse than useless.** A grep for returns and hooks
reported **nine files**; matching on two-space indentation still reported nine. Both counted
returns inside module-level helpers, inside `useMemo` callbacks and inside event handlers —
`atPercentageHint`, `inheritedScheduleRate`, `scopedJobs`. Of nine, **one was real.**

A check that reports eight false positives gets switched off, and switching it off is a rational
response to it. So the working version tracks brace depth from each component's opening brace and
considers only statements at depth 1 of that function — and its **negative control inserts a
`useState` directly after the early return and asserts the inserted line is present before
believing the failure**, which is G33's rule applied rather than remembered.


## G48. A price with no route to what it buys, and a terms clause nothing enforced

### WHAT A FIRST-TIME USER SAW

Signed in, no agency. `AppLayout:553` fires and every screen shows the same thing:

> **No Active Agency** — You need to select or create an agency before you can manage jobs.
> [Go to Settings]

**The full sidebar is visible and nothing is hidden** — twelve modules, all clickable, all
landing on those eight words. Agency Settings then offers *One agency, ₹5,900 for the year*.

So the app showed **twelve module names, one sentence repeated twelve times, and a price.** Not a
screenshot, not a document, not a number. **The most informative thing a prospect saw was the
sidebar — a list of words.**

⚠ **And `/pricing`, the one public page that says what the money buys, was linked from nowhere
inside the signed-in app.** It exists, it is reachable, it carries the price and the GST split —
and a person being asked for ₹5,900 had no route to it. That is not a missing feature; it is a
missing link, and it went unnoticed because the page was built for a payment processor's reviewer
rather than for a customer.

Fixed in three places: the interstitial now says what an agency IS and links to the walkthrough,
and the Add Agency cards carry *"See what you get"* beside the price.

### THE DOCUMENTS COME BEFORE THE PRICE

The walkthrough leads `/pricing` — above the figure, not below it. A prospect reaching that page
has already been asked for ₹5,900 and has seen nothing the software makes; leading with the
number asks them to judge it against nothing.

**The printed A4 output is the product**, which is an unusual property and worth exploiting. A
contractor's real question is *"will this produce the bill my division accepts?"*, and a picture
of the bill answers it better than a live demo would — with no login, no fabricated data and no
cleanup. The order is estimate → invoice → guarantee → inspection, which is the sequence a job
moves through and the sequence a contractor recognises.

**A missing screenshot renders as a named gap**, saying which file it wants, rather than as a
broken image. Same rule as the placeholder address on `/contact` (G41): a page that looks
finished while half its images are absent invites shipping it.

⚠ **AND THE EXISTENCE CHECK TESTS THE CONTENT TYPE, NOT THE STATUS CODE.** The SPA rewrite (G36)
sends every unmatched path to `index.html`, so a missing screenshot **does not 404 — it returns
200 with `text/html`.** `r.ok` alone would report every absent file as present. That is the
rewrite behaving exactly as designed and breaking a naive existence check, and it applies
anywhere else in this codebase that asks *"is this file there"*.

The spec lives in `docs/`, not beside the images: **everything under `public/` is served**, and a
file at `/walkthrough/README.md` listing which fields were blurred is a small favour to anyone
curious about what was hidden.

### THE TERMS CLAUSE

`/terms` §2 read: *"When a subscription lapses, access to that agency's workspace may be
suspended."*

**Nothing enforces it.** Checked every working screen — `NewJob`, `EstimateGenerate`,
`BillingSystem`, `MrLedger`, `DispatchChallan`, `AppLayout`, `Dashboard` — and **not one reads a
subscription.** An expired subscription changes nothing; the app works identically. All nine
founding grants expire in March 2028 and nothing will happen then either.

That is the stale-truth shape from the G32–G36 sweep, **in a document a payment processor
reviewed, written by the same hand that recorded the pattern** — three commits after cataloguing
it. Recognising a shape does not immunise against producing it.

**Reworded rather than enforced**, and the reasoning is the operator's: a clause describing
unbuilt behaviour is the worst of both. It does not warn a customer accurately, because *"may be
suspended"* describes something that cannot happen; and it does not bind the vendor usefully,
because a right reserved and never exercised is not a right anybody relied on.

⚠ **It also does not reserve the right "in future"**, which was the tempting middle — that is the
same defect with a tense change, another sentence about behaviour that does not exist. It now
says what happens: the subscription is no longer current, you are asked to renew, and your work
stays readable, printable and exportable. All true today, and updatable under the thirty-day
notice clause if suspension is ever built.


## G49. A 72-hour trial, and the clock it is measured against

A prospect could not see the app before paying ₹5,900 (G48). The trial is the answer, and
**nothing about it existed**: no working screen read a subscription, so an expired one changed
nothing.

### 72 HOURS, NOT THREE DAYS

"3 days" from a signup at 11pm is a different trial from one at 9am — calendar days would give
one prospect 73 hours and another 96. The expiry is a **timestamp**, computed on the server, and
the screens show that timestamp rather than a count of days. A customer can check it against
their own memory of when they started; "expires soon" gives them nothing to check.

### THE CLOCK, WHICH IS THE PART THAT WOULD HAVE GONE WRONG QUIETLY

The comparison is `Date.now()` — the **device's** clock. A machine an hour fast ends a 72-hour
trial an hour early, 1.4% of it, and the customer has no way to know why. For an eighteen-month
grant that is noise. For three days it is a prospect cut off mid-task.

**There is no server time already on hand**, which is worth recording because every obvious
candidate fails:

- `serverTimestamp()` is a **write-only sentinel** — it resolves during a write and is not
  readable as a value without performing one;
- the subscription's `expiryDate` **is** server-derived, so the *endpoint* is trustworthy — it is
  the comparison that is not;
- Firestore snapshots carry no server time;
- the auth token has a server-issued `issuedAtTime`, but reading it does not say when it was
  issued *relative to now* without forcing a refresh, which is a network call.

So the anchor is the one thing every HTTP response already carries: the **`Date` header**, which
is CORS-safelisted and therefore readable. One HEAD request at startup measures the offset;
midpoint of the round trip, residual error in milliseconds against a 72-hour window. Measured
against the live site while writing this, a correctly-set machine differed by **one second**.

**And when the probe fails, the comparison leans the customer's way** by an hour. Erring towards
a free hour costs nothing; erring the other way costs the customer. The favour applies **only**
when unanchored — a blanket hour of grace on a measured clock would just be a 73-hour trial
described as 72.

### A SOFT GATE, SAID PLAINLY

The gate runs in the browser and the rules do not enforce it. That is a choice, and the
alternative was costed rather than dismissed:

**A rule enforcing it needs `get(/subscriptions/$(agencyId))` — one document-access call per
document written. Firestore allows twenty per transaction or batched write. `NewJob` writes an
entire MR in one transaction, and the largest live MR is eighteen jobs.** So a rules-level gate
would work today and refuse a twenty-transformer intake — **the exact ceiling removed in G46,
reintroduced on purpose.**

And the person it defends against does not exist. Someone who bypasses a paywall through the
Firestore console was never going to spend ₹5,900. **The gate would buy real security against
nobody and cost a hard cap on real work.** Written into `trialGate.ts` in as many words, so
nobody later assumes it is a boundary.

⚠ **It defaults to ALLOWING writes while loading and on a failed read.** A gate that refuses
while it does not yet know locks out paying customers on a slow connection. The two errors do not
cost the same: a trial leaking a few writes costs nothing; a paid customer refused at Save loses
work. **Absence of an answer is not an answer** — G28's rule for display, applied to a decision.

### THE ENTRY POINTS WERE MEASURED, NOT GUESSED

Eleven components write, with no service layer. The first list of save handlers had **six of ten
names wrong** — `handleSave` where the code said `handleSubmit`, one name where
`EstimateGenerate` has three write paths and `MrLedger` has five. Probing produced **seventeen
entry points across ten files**; editing the guessed list would have gated four screens and
silently missed thirteen paths, **which is worse than not gating at all because it would look
done**.

The guard sits at the **top of each handler, before any work**, not at the write: a trial ending
while a form is half-filled must not take the entry and then discard it.

**Agency Settings, AT Settings, Divisions, Allotments and Estimate Master stay writable** —
verified, not assumed. A trial that refuses to let someone finish configuring the thing they are
evaluating is worse than no trial.

### 'trial' IS A FIFTH PROVENANCE

Not `granted` with a reason. They differ in duration (72 hours against eighteen months), in
meaning (a prospect who has bought nothing against a vendor commitment to an existing customer),
and in a number that will be wanted: **how many trials became payments is answerable with a
status and unanswerable with a free-text reason.** And `grant_days` on a trial would silently
convert it to a grant, losing the fact that it started as one.

⚠ **Tested before the expiry branch, as `admin` is** — not for `admin`'s reason (a trial *has* an
expiry) but so an ended trial keeps saying **TRIAL ENDED** rather than collapsing into the generic
**EXPIRED**. Those are different facts: a prospect who never paid against a customer whose renewal
lapsed — and only the second is still allowed to write. Placed after the expiry branch, `canWrite`
would come from the wrong branch and the gate would let an ended trial through. Thirteen cases
assert it, including a trial ending at the exact instant of comparison.

### ONE TRIAL PER ACCOUNT, AND A HOLE LEFT OPEN ON PURPOSE

Checked server-side: **ever**, not "one active" — an expired trial still counts, and agencies
cannot be deleted by a client so the record cannot be cleared. Plus no trial for an account that
already owns an agency.

Those two checks look redundant and are not: an account with no agency normally has no
subscription either, **but `deleteIfEmpty` lets the vendor remove an agency and does not remove
its subscription**, which would otherwise leave the account eligible for a second trial.

⚠ **A fresh Google account defeats all of it, and that is accepted rather than defended.**
Stopping it needs a card on file or phone verification, both of which defeat the point of a
trial. The friction of a new account plus re-entering an AT, divisions and rates already exceeds
what a second 72-hour look is worth. **A defence that does not hold is worse than a stated
limit** — it invites reliance on something that is not there.

### A COMPOSITE INDEX AVOIDED

The first version queried `where ownerId == uid AND where status == 'trial'` — two equality
filters, which needs a **composite index**. This project has no `firestore.indexes.json`, and a
missing index fails at **runtime** with `FAILED_PRECONDITION` and a console URL. **The first
prospect ever to click Start Trial would have met an error nobody had seen.** One equality filter
now, with the status checked in code: an account holds a handful of subscriptions, and the check
depends on no configuration.


## G50. The mechanism is hours, the wording is days

The trial runs on a 72-hour timestamp and every string a customer reads says **"3 days"**.

Hours are right for the **mechanism**: calendar days would give an 11pm signup 73 hours and a 9am
signup 96, which is a different product depending on when someone happened to sign up. That is
why the expiry is a timestamp and not a date, and it stays.

But it is **the vendor's reasoning, not the customer's.** "3 days free" is what a person compares
against every other trial they have seen; "72 hours" makes them do arithmetic to reach the same
number and reads like a parking meter. **The precision that matters to them is not the duration —
it is the moment it ends**, and that is shown exactly.

Five user-facing strings changed: the trial card, its sub-line, the price line, and both banner
forms. `hoursLeft` survives — but only to **decide**, choosing between the calm banner and the
urgent one at 24 hours. Its comment now says so, because a field named `hoursLeft` is an
invitation to render it.

### "TOMORROW" IS A CALENDAR COMPARISON, NOT AN HOUR COUNT

The banner says *"ends tomorrow at 4:15 pm"*, and getting that from an hour count would be wrong:
something ending in 20 hours is *tomorrow* if it is now evening and *today* if it is now
midnight. A customer reads the calendar the way they read a wall, and **saying "tomorrow" when
they would say "today" is the small wrongness that makes a person distrust the rest of the
message** — including the deadline itself.

`describeEnd` compares start-of-day to start-of-day. Checked across the cases a customer actually
meets, including the awkward one: an 11:30pm signup with 20 hours to go correctly reads **"today
at 11:30 pm"**, because the end is on the same calendar day even though it is twenty hours away.

### THE TRIAL IS PER LOGIN, AND NOW SAYS SO

Confirmed in the code rather than from memory. Both server checks key on **`ownerId == uid`**:

```
const ownSubs = await db.collection('subscriptions').where('ownerId', '==', uid).get();
const hadTrial = ownSubs.docs.some(d => (d.data() || {}).status === 'trial');
```

plus a second refusal if the account already owns any agency. **One trial per login, ever,
regardless of how many agencies they go on to create.**

⚠ **The wording had to be fixed too, and this is the part that was actually wrong.** "3 days
free" on a page about *buying agencies* reads naturally as *"each agency comes with 3 days"* —
the offer was accurate and its placement made it ambiguous. It now says **"One free trial per
login — not one per agency"** on the Add Agency card and on `/pricing`, and the server's refusal
says the same thing in the same words: *"The trial is one per account, not one per agency."*

That last point matters more than it looks. **The refusal is the only place a customer meets this
rule while it is being enforced against them**, and a message that merely says "already used"
invites the reply *"but this is a different agency."*


## G51. A fix validated against the population that cannot exhibit the bug

Creating an agency left Agency Settings empty — "nothing is linked up". **Nothing selected the
first agency an account ever created.**

G39 removed the automatic switch after creation, on reasoning that was right: *creating an agency
is a setup act; being moved out of the one you are working in is a side effect nobody asked for*
— the read-causing-a-mutation shape removed from the AT list for the same reason.

**That reasoning was applied to one case and generalised to all.** It holds for an operator who
already has an agency. It does not hold for an account with **none**, because there is nothing to
be moved out of. For them the removal did not preserve a selection; it left `activeAgencyId` null,
and every section of Agency Settings is gated on `activeAgency`. Their first agency was created
correctly, entered the list correctly, and rendered an empty page.

### THE SHAPE: VALIDATED AGAINST A POPULATION THAT CANNOT SHOW THE DEFECT

Every existing user has an agency. Every one of them was **unaffected** — the bug is not merely
hard to see for them, it is **impossible** for them, because the branch that fails is guarded by
a condition none of them satisfies.

So the change was tested, reviewed and shipped against a population in which it is provably
correct, and it is **fatal to the only population it was actually built for: a new customer.**
Every trial would meet it on the first click — the click that decides whether they ever come back.

That is worth naming as its own hazard, because it is not carelessness and it will recur. **A
change is naturally exercised against the data that exists, and the data that exists is the data
of people who already got past the step being changed.** The onboarding path is uniquely exposed:
it is the one code path that, by definition, nobody in the current database has taken recently.

The tell was present and unremarkable — *"stay on the agency you were working in"* is a sentence
with a presupposition in it, and the presupposition was never checked.

### THE FIX, AND THE SECOND HALF IT CLOSES

`registerCreatedAgencies(docs, selectIfNone)` decides both in one place. **The test is whether
the account had ANY agency**, so G39's property survives intact: an operator who has one is still
never moved out of it.

⚠ **And reading `agencies` from the closure is CORRECT here, which is worth stating because the
same read was the bug in G39.** There the guard asked *"is this id in the list"*, and the list had
not caught up with the id just created — a stale answer to a question about the new agency. Here
the question is *"did this account have any agency BEFORE this call"*, and the pre-update value is
exactly the right answer. **Same variable, opposite correctness, depending on which moment is
being asked about.**

That closes the stale-closure window flagged in G39 and left unfixed: `setActiveAgencyId` carries
G39's guard and would have refused the very agency just registered, because `agencies` has not
updated at that instant. The pointer state is set directly instead — the id came from the server
and needs no validation against a list it was just added to.

⚠ **And not inside the `setAgencies` updater**, which was the first attempt. It would have closed
the window too, at the cost of an **impure updater**: React may invoke an updater more than once,
and a state setter inside one runs with it. Correct-looking, and the kind of thing that produces a
duplicated write under StrictMode and nowhere else.


## G52. A fix that was diagnosed, proposed, and never built — then reported as done

Creating an agency produced: *"That agency could not be selected because this session does not
have it loaded. Nothing has changed. Reload to pick it up."*

That is G39's own guard, refusing an agency the session **had** just loaded.

`AgencyContext.fetchData`:

```js
setAgencies(enrichedAgencies);          // queued, not applied
…
setActiveAgencyId(enrichedAgencies[0].id);   // guard reads `agencies` from the closure → []
```

The guard compares against `agencies` from the render's closure. On a cold load that is `[]`, so
**every freshly fetched id is refused**, `activeAgencyId` stays null, and the user is told the
agency does not exist while looking at a database that contains it.

### THE PART WORTH RECORDING IS NOT THE BUG

**This was diagnosed in G39.** The report named the call site, named the cause — *"`setAgencies`
queues a state update; it does not change `agencies` synchronously"* — and proposed exactly the
fix now applied: *"Give `fetchData` the list it just fetched. `setActiveAgencyId(id,
enrichedAgencies)` — an optional second argument naming the list to validate against."* It was
option (2) of three, chosen with reasons.

**Then it was not built.** The conversation moved to a different symptom, and the proposal was
left as prose.

**And G51 then reported it closed.** G51 fixed the *other* stale-closure window — the one in
`registerCreatedAgencies` — and its summary said the fix "closes both". It did not. One was fixed
and one had been *described*, and a description that reads like a decision is easy to file as a
completed thing.

⚠ **So the hazard is: a correct diagnosis is not a fix, and a proposal written in the past tense
reads like one.** The G39 report says "the guard is right in intent and wrong in what it validates
against" and then describes the remedy fluently enough that revisiting the file feels redundant.
Nothing in the repository disagreed — the code was not marked, no check covered it, and the only
record that it remained undone was a paragraph in an audit entry about something else.

This is the second time in this session that analysis has been mistaken for work. The first was
the negative control that reported PASS without perturbing anything (G33). Both share a shape:
**the artefact that was supposed to prove the work happened was itself the thing that did not
happen.**

### THE FIX

`setActiveAgencyId(id, knownAgencies?)`. A caller reacting to a click passes nothing and is
validated against state, which is correct — the list on screen is the list in state. A caller that
has just fetched or created agencies passes what it holds.

The guard keeps its teeth: an id absent from the supplied list is still refused, and clearing the
selection is still always allowed. Modelled across both moments rather than reasoned about.

`addAgency` carried the identical shape and is **dead code** — `AddAgencyFlow` replaced it in G38,
and nothing calls it. It was given the parameter anyway rather than left alone: an unreachable
function with a latent stale read is a trap for whoever wires it back up, and "nothing calls it"
is a fact with a shelf life.


## G53. A field that was a cap, not a figure - and the difference decided the change

Amorphous and CRGO Wound Core transformers have **one limb per phase and no separate LV
winding**: HV is at most three coils, LV is zero. That is a physical fact about the machine,
supplied by the operator, and the app did not know it.

`hvCoilLimb` - HV coils per limb - **defaulted to `'4'` for every job regardless of core type**,
which is the stacked-CRGO figure. Six of the seventeen live single-winding jobs carry a hand-typed
`1`: the default had been fighting the operator, and the operator had been winning six times out
of seventeen.

The default is now `1` for those two core types, at all four sites that produce it - the load
fallback, the fresh form, the Excel export and the printed sheet.

### WHAT THE FIELD ACTUALLY DOES, WHICH IS NOT WHAT ITS NAME SUGGESTS

`hvCoilLimb` reaches money **nowhere**. The chain is `totWt = totCoil x wtOfCoil` with
`totCoil = damR + damY + damB`; the limb count is not in it. What the field does is three other
things:

1. cap entry per phase (`renderIntegerField`'s `max`) - and it **rejects rather than clamps**, so
   a cap change never silently rewrites a stored number;
2. feed a **save-time range check**;
3. print on the inspection sheet.

So "force it to 1" moves no figure on any live job. **Rs 0.** That was worth establishing rather
than assuming, because the obvious worry - that a count and a weight were compensating for each
other - is real elsewhere in this same area and simply does not apply to this field.

### THE COST WAS NOT A FIGURE. IT WAS A LOCK.

The save-time range check reads the **stored** limb and refuses `damR/Y/B` above it. Had the
forced `1` been applied to existing records, **ten of the eleven stored-`4` jobs would have
stopped saving** - ASU-1, ASU-3 and SBT-31 read 4/4/4 - and the check aborts **the whole MR, not
the offending job**, so a CRGO job merely sharing an MR would have been locked out with them.

Nothing would have been corrupted and nothing would have been mispriced. The records would simply
have become unopenable, which is a worse outcome than the wrong number they currently hold,
because the wrong number is at least visible and fixable.

**So the change is a default, not a migration.** A record holding a value keeps it. The ten stale
counts stay wrong, on purpose, and stay listed here:

    AMKLL-9 2/2/2   AMSBT-2 2/2/2   AMSBT-3 1/2/2   ASU-1 4/4/4   ASU-2 2/4/4
    ASU-3   4/4/4   MWSBT-1 0/0/4   MWSBT-2 1/2/2   SBT-31 4/4/4  WSU-1 0/0/2

    (AMSBT-1, at 1/1/1, is the one stored-4 record already consistent with a limb of 1.)

### WHY THE COUNTS CANNOT BE CORRECTED YET

The tempting follow-on - cap the count at 3 and be done - **would underbill by exactly the factor
the bug overbills by.** On the stored-`4` records, `wtOfCoil` is a per-SECTION weight that the
operator divided the winding into and the calculation multiplied back up: ASU-3 reads 4/4/4 at
2.36 kg for 28.32 kg total, which is about right for a 200 kVA winding. ASU-4, at limb `1`, reads
12.5 kg - a whole-limb weight. **The same field holds two different meanings across the
population.** Capping the count without redefining the weight would cut the charged kilograms
fourfold on precisely the jobs where the kilograms are currently correct.

Count and weight move together or not at all. That is held pending the 2026 tender's amorphous
section, because the schedule and the physical fact disagree and the schedule has not been read:

- Schedule-A's heading covers both constructions in one table - "CRGO (STACK/Wound/DRY/PAT/SDT) /
  **Amorphous Core** DIST. TRANSFORMERS" - and item 13 (LT coil) carries no qualification.
- The amorphous clause text, verbatim, includes "Re-insulation/replacement of **all the LV
  windings**".
- And an explicit note: "In case of damage of **LT coil** if any, the damaged coil should be
  replaced at the same cost i.e. without any extra charge."

**All three are 2020 text.** The 2026 block reuses `AMORPHOUS_ESTIMATE_TEXT` from 2020 and it
prints only on the fixed-rate path, so it has never appeared on a 2026 estimate. **2026's own
amorphous wording has not been seen, and 2020's is not evidence about it.**

Under 2026 there is no Schedule-B, so these core types take the **itemised** path, where item 13A
fires from `totWtLv > 0` with **no core-type condition at all**. No live job has been charged it -
all seventeen sit on `UGVCL-2020`, which is fixed-rate - so the exposure is **latent and armed**,
not realised. Fifteen of the seventeen already carry an LV per-coil weight, and nine have an LV
coil marked damaged, on a winding that does not exist.

### AND THE COMMENT SAID SIXTEEN

`SingleJobEstimateReport:462` asserted "All 16 Amorphous and Wound Core jobs in the database carry
[an internal inspection]" - a census that was true when written and is 17 now. It is corrected.

**A count in a comment is a measurement with no expiry date printed on it.** That line exists
specifically to stop a reader believing the branch is independent of inspection data, so it is a
comment that reasoning gets hung on - and the number in it drifts silently while the sentence
around it stays true. This session has now found the same shape three times: a stale census, a
negative control that proved nothing, and a diagnosis filed as a fix.


## G54. The mark was never too detailed - it was too small in its own frame

G25 replaced the badge with `public/favicon.svg` and measured its **elements**. It did not measure
the **frame**: the artwork used **48% of the tile's width, with 26% padding on each side** (16.5u
of 64). Each thin element in G25's table was thin partly because the whole mark was drawn at half
the size its tile allowed.

**So the redraw is a rescale first.** Same file, same path: the tab icon, the manifest and all 8
`APP_MARK` sites follow with no code change.

1. **Artwork scaled to a 10% safe area** - 1.65x across: 31u to 51u, 6.5u padding per side.
2. **Tank outline only.** The fill was 1.41:1 on the tile and changed no pixel by 3:1 at any size;
   that is recorded on its own as G55.
3. **Six pins kept**, now 5u, recoloured `#60A5FA` to `#93C5FD`, the tank stroke's own colour. The
   old pin blue sat **1.41:1 against the stroke it joins** - too close to separate from it, too far
   apart to merge with it.
4. **Bolt redrawn, fill only, thinnest limb at least 6u.** Its `#F59E0B` outline was 1.29:1 against
   its own fill and made up 69% of the bolt's ink at 16px, 82% at 64px.

### MEASURED, BEFORE AND AFTER

Rasterised with skia (`@napi-rs/canvas`, the engine Chrome draws tab icons with), natively at each
size. **"Reads" counts the pixels an element changes by 3:1 or more** - render with it, render
without it, compare - the WCAG non-text threshold. Peak ratio in brackets.

| | 16px | 28px | 32px | 64px |
|---|---|---|---|---|
| artwork width (31u -> 51u) | 7.8 -> 12.8px | 13.6 -> 22.3px | 15.5 -> 25.5px | 31 -> 51px |
| padding per side (16.5u -> 6.5u) | 4.1 -> 1.6px | 7.2 -> 2.8px | 8.3 -> 3.3px | 16.5 -> 6.5px |
| tank stroke (3u -> 5u) | 0.75 -> 1.25px | 1.31 -> 2.19px | 1.5 -> 2.5px | 3 -> 5px |
| pin, thick x protrusion (3x6u -> 5x6.5u) | 0.75x1.5 -> 1.25x1.6px | 1.3x2.6 -> 2.2x2.8px | 1.5x3 -> 2.5x3.3px | 3x6 -> 5x6.5px |
| bolt, thinnest limb (3.05u -> 6.76u) | 0.76 -> 1.69px | 1.33 -> 2.96px | 1.52 -> 3.38px | 3.05 -> 6.76px |
| bolt outline (1.5u -> none) | 0.38px -> - | 0.66px -> - | 0.75px -> - | 1.5px -> - |
| **pin pixels that read** | **0 (1.68) -> 8 (4.71)** | 8 (4.07) -> 30 (5.74) | 24 (3.00) -> 40 (5.74) | 60 (4.07) -> 144 (5.74) |
| tank stroke pixels that read | 12 -> 28 | 71 -> 108 | 76 -> 156 | 250 -> 566 |
| bolt pixels that read | 5 (5.91) -> 8 (5.78) | 18 (8.18) -> 20 (6.21) | 24 (8.38) -> 32 (6.21) | 93 (8.76) -> 126 (6.21) |
| tank fill pixels that read | 0 of 48 -> no fill | 0 of 118 -> - | 0 of 165 -> - | 0 of 509 -> - |

Thinnest limb treats the bolt as what its six vertices make it, two overlapping triangles, and
takes the smaller inscribed-circle diameter.

**At 16px the old mark had no pin pixel reaching 3:1.** G25 already named the pins the weakest
element at 28px; in the browser tab they were not there at all.

### 1.65x FITS ACROSS, NOT DOWN

The scale was taken from the width. Down, the old artwork was 39u with its pins, and **1.65x would
make it 64.4u in a 64u tile.** So the safe area is held on all four sides and the vertical gives:
the pins protrude 6.5u rather than a scaled 9.9u, and the tank's outer proportion goes from 1.15:1
to 1.34:1.

### WHAT IT DOES NOT BUY

- **The bolt barely moved on count at 28px** - 18 to 20 readable pixels - and its peak fell from
  8.2:1 to 6.2:1, because the old bolt sat on the dark fill and the new one sits on the tile. It is
  now thick enough to survive, every limb over 1.6px at 16px, but it was never the weak element the
  pins were.
- **At 16px the bolt is a yellow mass, not a zig-zag, and that is accepted.** A first draft leaned
  into a diagonal bar; three upright drawings followed, and all three resolve to the same mass in
  the roughly 5 x 5 pixels available. Attempts that converge are a limit of the size, not of the
  drawing. A yellow mass in the right place still separates this mark from a generic tile, and
  from 28px up the shape reads as a bolt.
- The tank stroke's inner edge drops from 8.1:1 to 5.7:1 without the fill behind it (G55).
- `public/` is not content-hashed (see `APP_MARK` in `ui.ts`), and browsers keep favicons in a
  cache of their own. An open tab may show the old mark until that expires.


## G55. A fill no size reveals - 36 solid pixels that carried nothing

Until G54 the tank was filled `#1E293B` on the `#1E3A8A` tile: **1.41:1.** At 16px the fill path
paints **36 fully solid pixels**, a 6 x 6 block and the largest single shape in the mark, and not
one pixel it touched ever moved 3:1 from what it would otherwise have been.

| | 16px | 28px | 32px | 64px |
|---|---|---|---|---|
| solid pixels the fill path paints on its own | **36** | 120 | 168 | 672 |
| pixels it changes in the finished mark | 48 | 118 | 165 | 509 |
| ...of those, changed by 3:1 or more | **0** | **0** | **0** | **0** |
| strongest change it makes anywhere | 1.41:1 | 1.41:1 | 1.41:1 | 1.41:1 |

(48 exceeds 36 at 16px because antialiased edge pixels change too. Once the stroke and bolt are
painted over it, 12 pixels at 16px show pure fill.)

### WHY NOTHING FOUND IT

G25's table measured stroke width, pin size and bolt outline, and **all three are faults of size**:
each improves as the render grows, so each is found by asking what the mark looks like smaller.
Contrast between two flat colours is not a fault of size. **The fill's strongest effect is 1.41:1
at every size in the table**, because the ratio does not depend on how many pixels carry it.

So the habit that finds thin strokes - enlarge it and see what is there - **cannot find this
class**. Enlarged, the fill is still present, still looks like a deliberate dark panel, and still
draws no edge the stroke does not already draw. It did not fail by disappearing when small. It
did nothing at any size, and a larger view presents that as design.

It was not entirely inert: behind the stroke it raised the inner edge from 5.7:1 to 8.1:1. That is
extra contrast on a stroke that already reads at 5.7:1 against the tile on its outer edge, which is
where G54 now leaves it.

**The check that finds it is the one G54's table uses: remove the element, re-render, and count the
pixels that moved by 3:1.** An element that fails that at its largest size fails it at every size.
For a mark of five paths it is five renders.


## G56. Agency Settings in four tabs - and the edits a tab would have thrown away

Agency Settings had a two-tab bar (Agency setup / Manage subscription) with AT periods and
Estimate Master stacked below the agency form. That long page is why Estimate Master was collapsed
and the AT list sat behind "Expand & Manage". The bar now carries four tabs:

1. **Agency setup** - profile, DISCOM, bank, letterhead
2. **AT / Tender periods** - AtSettings, with divisions and allotments nested per AT
3. **Estimate Master** - the rate sections
4. **Manage subscription**

The agency and AT selectors moved above the tabs, because tabs 2 and 3 are scoped by them. They
are hidden on Manage subscription, which is about the account (G38).

### THE URL DECIDES THE TAB

The tab is derived from `?section=` on every render (`lib/settingsLinks.ts`), never held in state.
react-router re-derives search params only when the query string changes, so a tab held in state
cannot follow a link to the URL already in the address bar. Every deep link already used this
vocabulary: `at` / `divisions` / `allotments` go to tab 2, `estimate-master` to tab 3, the new
`subscription` to tab 4, and anything else to tab 1. A tab click replaces the whole query, so a
consumed `atId` does not reopen its AT on a refresh.

### WHAT CHANGED ABOUT COLLAPSING, AND WHAT DID NOT

- **Estimate Master's outer collapse is removed.** Its stated reason was that most visits to the
  page were not about rates - a reason about sharing a page.
- **Its five sections still open closed.** Their reason was the screen's own: the frequent case is
  reading one rate in one section. A refusal that names a section now opens it with `?open=`.
- **"Expand & Manage" is removed.** It was a page-length collapse, and users had already reported
  not finding where to create a tender.
- **One AT open at a time is kept.** Its reason was never length: an operator partway through a
  change could not tell which tender they were changing. With no `atId` in the link, the booking AT
  now opens on arrival.

### A MARKER ON THE TAB FOR EVERY REFUSAL, FROM THE FUNCTION THAT REFUSES

Moving a warning into a tab hides it from the other three tabs. A tab whose content can clear a
refusal says so on the tab itself, and **it asks the same function the refusing screen asks, with
the same arguments, so the marker and the refusal cannot disagree.**

| Tab | Marked when | Function | Refused by |
|---|---|---|---|
| Agency setup | details missing | `missingForEstimate`, `missingForTaxInvoice` | estimate print, tax invoice |
| AT / Tender periods | intake not open | `isIntakeOpen(activeAtMaster, agencyAts, viewingAllTenders)` | New Job |
| Estimate Master | **any AT, closed included,** has no rates | `atRatesReadiness` | estimates, bills |
| Estimate Master | any AT holds the wrong schedule - the section is named on the tab | `validateEstimateMaster` | estimates, bills |

- **Every AT, not only the active one, and closed ones too.** Estimates and bills price from the
  job's own AT (`atForJob`), so an older tender without rates refuses work while the active one
  looks fine. Closing a tender does not close its jobs. The Estimate Master tab lists every tender
  the marker counted, so arriving always explains the marker that sent you.
- **The wrong-schedule check runs only on ATs that have rates.** That is the refusals' own order:
  they return on no rates before asking about sections.

**Not marked:**
- **Scrap charge and circle limit.** Neither needs Estimate Master loaded, but both are questions
  about one job - a scrap job's core type and kVA (`resolveScrapCharge`), an inspected job's rating
  (`checkJobCircleLimit`). A tab bar has no job to ask about.
- **Subscription.** TrialBanner already stands on every screen.

### STAYING MOUNTED WAS NOT ENOUGH

Tabs mount on first visit and are then only hidden, so a tab click unmounts nothing. The old
Estimate Master collapse did unmount - hiding it discarded unsaved rates.

**That was half the guarantee.** Three editors re-seeded their fields whenever a context object
changed identity, and `updateAgency` / `updateAtMaster` replace those objects on every save
anywhere:

| Editor | Keyed on | So this discarded unsaved edits |
|---|---|---|
| EstimateMaster loader | `activeAgency`, `selectedAt` | saving the profile, or any change to the AT being edited |
| EditAgencyForm sync | `agency`, `activeAtMaster` | saving rates or a percentage on the active AT |
| AtDivisions | `at`, `activeAgency` | saving that AT's rates, or the profile |

On the long page this needed Estimate Master expanded at the time. With tabs - type rates, go to
Agency setup, save, come back - it would have been the ordinary workflow. **Each is now keyed on the
data it copies:** `loadKey` (agency id, tender id, the rate rows), the 38 profile fields the sync
effect copies (checked against the setters: 38 copied, 38 listed), and the prefixes. A save that
changes those rows still reloads, which is what clears `editedSections` after Save, by design.

The same shape was in the URL parameters. `at`, `open`, `atId` and the inner-tab section were
re-applied on every re-render while they stayed in the URL, which snapped a choice back after any
tender save. Each is now applied once per value.

### DEEP LINKS THAT LANDED WRONG

- **NewJob's prefix gaps.** The no-AT branch built its link from `activeAtMaster.id` inside
  `if (!activeAtMaster)`, so it threw before the dialog could open. **It was reachable:** the OGP
  save calls it before `handleSubmit`'s own no-AT guard. The two branches also had each other's
  links. No-AT now sends `?section=at`; no-prefix sends `?section=divisions&atId=…`.
- **The trial banner's Subscribe button** was `<a href="/agency-settings">`: a full reload of the
  app, landing on Agency setup. Two defects in the control that takes payment. It is now a router
  link to `?section=subscription`.
- **Four rate refusals now name their tender.** They checked the job's AT but linked to plain
  `?section=estimate-master` - the right tab, on whichever AT was active. `estimateMasterLink` adds
  `at=`, plus `open=` when the refusal names a section. The scrap-charge link opens no section,
  because the missing charge can belong to more than one job's section.

### THE DIVISIONS COPY IS REMOVED

EditAgencyForm's Divisions & Prefixes tab was a pointer to the real grid, which is now one tab away
- two places for one fact, and its "below" was wrong. Its state also fed the save's division
circle offices; that derivation moved into the save unchanged, from the same live prefix list with
the same fallback.

### VERIFIED, AND NOT

Passed:
- `tsc --noEmit`
- `vite build`
- `scripts/admin/hooks-after-return.js`
- 12 assertions on `settingsTabFor` and `estimateMasterLink`
- the built CSS hides `[hidden]` with `display:none!important`

**Not run in a browser.** The app needs a signed-in session, so tab switching, the markers and the
unsaved-edit paths are verified by reading, not by use.

### DECIDED ON REVIEW

- **Closed ATs are marked.** The first cut marked open ATs only. But a closed tender still refuses
  bills for its own jobs - neither `atRatesReadiness` nor `validateEstimateMaster` reads status - so
  omitting it hid a live refusal because the tender was retired, while its jobs were not. Both
  checks now run over every AT of the agency. The tab's list says which are closed, and that
  Estimate Master shows them read-only until reopened.
- **Section faults on core types an agency never books stay marked.** The marker probes all four
  sections, while a refusal asks only about the core types on the MR in hand. A stored fault is a
  stored fault, and suppressing it would mean the app deciding which core types an agency "really"
  uses. Instead the marker names the section - "Wrong schedule: Wound Core" - so someone who does
  not book that type can dismiss it knowingly rather than be puzzled by it.
- **Switching tender discards unsaved edits. Recorded here, not fixed.** It predates this change,
  and it is a different problem: a tender switch changes what the editor is editing, so keeping the
  edits would be worse. **But it does not warn.** None of the controls that change what Estimate
  Master shows asks first:
  - its own "Rates for" selector (`setSelectedAtId`);
  - an "Open it" link, or any link carrying `at=`;
  - the context-bar and sidebar AT selectors, "Book jobs against this AT", and creating a tender.
    These change the active AT, which Estimate Master follows unless a tender was picked in its
    own selector.

  The screen's only two `confirm()`s guard deleting a row and adopting a template. **Queued as
  O55**, with what each half would take. The first estimate made here was wrong: it said
  `editedSections` already knows whether anything is unsaved. It reports edits that do not exist,
  which is recorded as its own defect in O56.


## G57. Estimates and bills priced from rates nobody had saved - held off by a reload G56 removed

### THE SCREEN AND THE TENDER HELD THE SAME OBJECTS

Every Estimate Master edit handler copies a section's array shallowly, then changes its rows in
place: `const data = [...getSectionData(section)]; data[index].rates[kva] = ...`. Saving handed
context the screen's own arrays: `updatePayload.estimateMasterCRGO = crgoData`, into
`updateAtMaster`, which keeps `{ ...a, ...atData }`.

**From then until something replaced the screen's rows, the screen and the tender in context were
the same objects.** The next keystroke changed the tender's in-memory rates before anyone saved it:
- **Estimates and bills in the same session priced from them.** `getEstimateMasterForCore` reads
  the AT's rows from context; it copies each row but keeps its `rates` object.
- **The stored-vs-showing band and the publish plan read them as stored.**

Nothing reached Firestore, and a page reload undid it. **This is a data path, not a display bug:**
a figure on a printed estimate or bill could be one nobody saved.

**Apply had the same sharing towards the tenders it wrote.** Its payload was the screen's rows for an
edited section. `applyRatesToOwnAts` put them into each target AT in context, so later keystrokes
changed other tenders' in-memory rates. No reload ever stood in that path; it existed from the
day apply between ATs shipped.

### G56 REMOVED A RELOAD THAT WAS ACCIDENTALLY PREVENTING IT

Before G56 the loader was keyed on object identity, and every save replaces the context object. So
every save reloaded the screen from fresh copies, and shared rows never lasted long enough to be
edited. **That reload was wrong for its own reasons** - it discarded unsaved edits whenever
anything anywhere was saved - **and G56 was right to remove it. But it was load-bearing, and
nothing recorded that.**

G56 keyed the reload on `JSON.stringify` of the rows. A save that changed nothing no longer reloaded,
so the screen kept the arrays it had just handed to context. The window was narrow. The first save
in a session usually still reloaded, because rows saved from the screen serialise in a different
key order from rows fetched from Firestore. **A comparison bug in one direction was masking a
sharing bug in the other.**

**The rule now, and where it is enforced.** Rows enter the screen only through `seedSection`, which
always returns copies. They leave it only through `cloneRows`, in two places:
- `saveRatesToActiveAt`;
- `publishPlanFor`, whose payload Apply writes into other tenders and Publish into templates.

### FIXED TOGETHER, BECAUSE THEY SHARE A CAUSE

Fixing any one of these alone leaves the symptom reachable by another route - which is how a
partial fix reads as done.

| Defect | Cause | Now |
|---|---|---|
| **Cancel restored the agency's rows, not the tender's** | `handleCancelSection` read `activeAgency.estimateMaster*`; it predates F73 and never moved with the rates. Save All, Apply and Publish then carried those rows onward. | Cancel seeds through the loader's own `seedSection`, tender first (`rateHolderFor`) |
| "Edited" reported edits that did not exist (O56) | a flag set by an act, cleared only by a reload | `sectionIsEdited`: the screen differs from what was loaded, by `sameContent` |
| Saving one section discarded unsaved edits in the other four | any change re-seeded all five sections | `planReseed` re-seeds only sections whose stored rows moved |
| `JSON.stringify` in the reload | key order read as change | `sameContent`, as `compareSections`' header requires |
| The stored-vs-showing band's `differs` | `JSON.stringify(stored) !== JSON.stringify(data)` - true whenever key orders differ | `sameContent` |

- **"Changed this session"** - what Apply refuses without, and what it sends - is now the sections
  saved on this tender this session plus those differing now. A no-change save does not count. It
  is keyed on agency AND tender; keyed on agency alone, switching tender and applying could send
  sections saved on a different tender.
- **The seeding moved to `lib/estimateMasterSeed.ts`** with the four normalisers. The normalisers
  moved unchanged: 176 lines, compared mechanically with the committed file.
- **The publish guard narrowing** (O56's third lead) is a different cause. It narrows on genuine
  edits too, and is G58.

### A HOOK ORDER FAULT THE GUARD COULD NOT SEE

EstimateMaster had `if (!activeAgency) { return (...) }` at line 687, with three hooks after it:
`useState` at 733, `useRef` at 748 and `useMemo` at 1429. That is the React #310 shape G47 recorded.
`scripts/admin/hooks-after-return.js` reported "None", for two reasons:
- **It recognises an early return only on the same line as its `if`**, not a braced block.
- **Its hook pattern, `use[A-Z]\w*\s*\(`, does not match a hook with type arguments** -
  `useState<Record<string, boolean>>(`.

The fault was latent, not live: Agency Settings renders Estimate Master only while an agency is
selected. The first two hooks went with `editedSections`, and `applyCandidateAts` moved above the
return. A scan with both blind spots closed finds no other instance in `src/components`. **The guard
itself is unchanged and still has both blind spots** - recorded here, not fixed.

### THE CENSUS: NO AT SHOWS SIGNS OF A CANCELLED SECTION

Read-only, against the live database, 2026-09-11.
- **13 ATs across 7 owners.** Apply needs a second AT under the same owner: **3 owners and 9 ATs
  could have received one.**
- **No AT's last rates write is an apply.** An apply stamps `ratesSource: 'own'` and
  `ratesUpdatedAt`, without the edit stamp a save writes.
- **Six ATs carry the migration stamp** from 2026-08-26 06:48 UTC, 26 minutes before apply between ATs
  shipped, and have had no rates write since.
- **The limit: an apply followed by a save or an adoption leaves no stamp.** Three exposed ATs had
  such a later write, so they are covered by content comparison instead:
  - SAMOR 2026-27 and ADMIN 2026-28/AT/1819 adopted templates, which rewrite all five sections;
  - SAMOR 25903 was saved, and all five of its sections match a template, its agency and its
    sibling AT.
- **The one Save-after-Cancel candidate, PATEL 1087** (a single-AT owner, so Apply could not reach
  it). Its CRGO equals its agency's. Both templates differ from it only in 17 cells at 100 kVA, and
  both were published after its last save.

All of it is test data, wiped before launch.

### VERIFIED, AND NOT

Passed:
- `tsc --noEmit`, `vite build` and the hooks guard - though see its blind spots above.
- **25 tests on `lib/estimateMasterSeed.ts`:**
  - tender first, and Cancel restoring the tender's rows;
  - the same loaded content as the pre-G57 loader, on seven fixtures;
  - no shared row or `rates` object in any section;
  - save then keystroke;
  - single-section reload, key order, and cross-tab saves;
  - "edited" as a comparison.
- **Negative controls.** Four broken copies of the module each fail the suite: the agency read
  first, `JSON.stringify` in the reload, reload-all-on-any-change, and a `cloneRows` that shares.
  G33 is why that was checked.

Not verified:
- **The tests are not in the repository.** It has no test runner; they were bundled with esbuild and
  run from outside it.
- **The component wiring is checked by reading, not by running:** that every save and payload goes
  through `cloneRows`, and that `editedNow` tracks the screen. The app was not run in a browser; it
  needs a signed-in session.
- **Still open: O55** - switching tender discards edits without a word. Its Half 1 is now unblocked.


## G58. The publish guard checked the sections you touched; the template carries all five

`handlePublishTemplate` guarded `touchedSections()` whenever there were any, and all five sections
only when there were none. The template it publishes is built by `buildFullTemplatePayload`, which
**always carries all five**. So editing one section narrowed the check to that section, and an
untouched section that was fallback-resolved went into the template unguarded:
- **An empty stored section.** `publishPlanFor` had nothing stored to publish, so it published what
  was on screen - rows substituted from another section or the shipped defaults.
- **A stored section holding the wrong schedule** was published as stored.

A template is adopted wholesale, onto every AT that copies it. That is the blast radius the guard
exists for.

**It now guards all five, always.** Apply is unchanged: it sends only the sections that changed, so
it guards only those.

This was O56's third lead. It is a different cause from G57 - genuine edits narrowed it, not only
stale ones - so it is a separate change.

**It refuses nothing live.** Read-only, 2026-09-11, using the guard's own functions
(`storedSectionForRates`, `checkMasterSection`): **0 of 13 ATs would be refused.**
- **How it ran outside the browser.** `estimateCalc` pulls in the estimate report component, pdf.js
  and the Firebase client, so it was replaced by the one thing the check imports from it:
  `SCRAP_ITEM_CODE_BY_CORE_CLASS`, lifted verbatim from the source.
- **Any refusal it adds is one a publish with nothing touched already met.**

`tsc --noEmit`, `vite build` and the hooks guard pass. Not run in a browser.


## G59. The hooks guard was blind to its own subject, and reported clean

`scripts/admin/hooks-after-return.js` exists because of G47: a hook below an early return throws
React #310 on a cold load. **It reported "None" while EstimateMaster carried three hooks below
`if (!activeAgency) { return (...) }`** - `useState` at 733, `useRef` at 748 and `useMemo` at 1429
(G57). That is the exact crash shape, in a file the guard exists to protect.

It had two blind spots, both in its pattern matching:
- **It counted an early return only on the same line as its `if`** - never a braced block, and never
  a `return` on the line after its `if`.
- **It matched a hook only as `use[A-Z]\w*\s*\(`**, so a hook with type arguments -
  `useState<Record<string, boolean>>(` - was not a hook.

This is the third check in this project blind to its own subject, after the negative control that
perturbed nothing (G33) and the comparator that read a field which did not exist. **A guard in that
state is worse than none. It does not stay silent: it reports clean, and the report is read as
evidence.**

### REBUILT ON THE PARSER, NOT ON PATTERNS

It now reads each file with the TypeScript parser `tsc` uses, instead of counting braces:
- **A component** is a capitalised function - declared, or assigned to a capitalised const,
  including through `memo` or `forwardRef`.
- **An early return** is any top-level statement of the body that contains a `return` outside a
  nested function, wherever the `if` and the `return` sit on the page.
- **A hook** is a call to `useX` or `React.useX`, with or without type arguments.

It also scans every `.tsx` under `src/` (47 files), not only `src/components`, because components
live in `src/lib` and `src/App.tsx` too. It accepts file paths as arguments.

### IT PROVES IT CAN SEE BEFORE IT SAYS "None"

Every run starts with a self-test, and exits 1 without scanning if any part fails:
1. **Five synthetic components:**
   - a braced return, then a typed hook;
   - a same-line return;
   - a `return` on the line after an unbraced `if`;
   - an arrow component through `memo`, then `React.useRef<T>`;
   - one that must NOT be flagged, whose returns sit only inside callbacks.
2. **A probe in every real component** that has an early return with code after it - 26 today. The
   probe is a typed hook, inserted on the line below the returning statement. The self-test asserts
   the inserted line is where it was put, then asserts the guard reports it.

**Both parts are needed; the real probes alone would not have been enough.** Two blinded copies of
the new guard, each reintroducing one old blind spot, both fail the self-test. But the copy blind to
braced returns failed only the synthetic cases, never a real probe. No real component has a braced
early return today, so a guard blind to them finds no return to plant a probe beneath. **A
self-test built only from the current code can only test the shapes the current code contains.**

### VERIFIED

- **Current tree:** the self-test passes (5 synthetic cases, 26 probes), and the scan reports
  **None in 47 files**, in about 1.5 seconds.
- **The pre-G57 EstimateMaster (`a103263~1`):** it reports the early return at line 688 and **hooks at
  733, 748 and 1429** - the three the old guard missed - and exits 1.
- **Two blinded copies, one per old blind spot:** both exit 1 with SELF-TEST FAILED.
- **Not wired into anything.** Like every harness here, it runs when someone runs it; the project
  has no CI.


## G60. A test runner, not a gate - and two ways a pass could have meant nothing

The project had no test runner and no test files. It now has one. Its first suite is the 25 G57
seed tests, in `src/lib/estimateMasterSeed.test.ts`.

### NODE'S BUILT-IN RUNNER, WITH TSX - NO NEW DEPENDENCIES

`npm test` runs `scripts/run-tests.js`, which runs Node's built-in test runner with `tsx` loading
TypeScript. `tsx` was already a devDependency that nothing used.
- **Tests sit beside the module they test**, as `*.test.ts`.
- **Nothing imports them**, so `vite build` never bundles them.
- **`tsc --noEmit` type-checks them** with everything else.

**Vitest was the alternative, and was not taken.** Vitest 5 fits the project (Vite 6.4.3, Node 24)
and would reuse the Vite config. But a dry-run install added 30 packages, removed 25 and changed 123
- a lockfile reshuffle for a capability nothing needs today. It earns its place when component
tests are wanted, which would also bring jsdom and Testing Library - not before.

### ⚠ "tests 0" IS A PASS, AS FAR AS NODE IS CONCERNED

There were two ways the suite could report success having tested nothing, and both were found by
trying them:
- **The pattern matches nothing.** `node --test "src/**/*.test.ts"` exits 0 and prints "tests 0".
  Rename a file, move a folder or mistype the pattern, and the suite passes.
- **A test file contains no tests.** Node reports the file itself as one passing test, named by its
  path - "tests 1, pass 1". The wrapper's first version counted tests and passed this.

So the wrapper finds the test files itself and fails when there are none. It reads the run's own
TAP report and fails when no test ran, or when a file appears as its own result. This is the same
failure as G33 and G59: a check that reports clean because it cannot see its subject.

| Negative control | Result |
|---|---|
| One assertion flipped - "the tender's rows come first" told to expect the agency's figure | exit 1, and that test fails |
| A folder with no test files | exit 1 |
| A test file containing no tests | exit 1 - the wrapper's first version passed it |

### ⚠ NOT A GATE - A DECISION, NOT AN OMISSION

Nothing runs `npm test` automatically - not `vite build`, not a Vercel or Firebase deploy, not a git
hook. It runs when someone runs it.

**Why:** a gate over 25 tests covering one module would give false confidence about the other forty
in `src/lib`. A green gate reads as "the app is tested"; this suite shows only that Estimate Master
seeding is.

**What would change it:** the suite covering the code that decides money - pricing (`estimateCalc`,
the estimate builder, rate resolution) and bill totals. Not merely more tests. That waits on O57,
because pricing cannot be imported by a test today.

**Where a gate would go is also undecided.** Vercel builds the frontend on push, and the Firebase
predeploy covers only Functions. So a gate most likely means `build` running the tests, or a CI the
project does not have.

### `scripts/admin` STAYS SEPARATE

29 of its 33 scripts read the production database with a service key, and several write to it:
migrations, deletes, backfills. **A test run must never be able to reach them**, and the boundary is
clearer as two things than as one with exceptions.

The four that touch no data stay as they are too, because none is a test in shape:
- the hooks guard (G59);
- `verify-seed-equality.js`, already the Functions predeploy gate;
- `model-agency-rules.js`;
- `print-subtree-hashes.js`.

What changes is new work only. A pure-logic check becomes a test, not another script that compiles
real modules through esbuild by hand.

### VERIFIED

- `npm test`: 25 tests in 1 file pass.
- The three negative controls above.
- `tsc --noEmit`, `vite build` and the hooks guard pass.


## G61. HV S.E. is an answer on the inspection now, not an agency constant

The operator's answer that these agencies do not use super-enamelled conductor has changed (O20, F47):
S.E. conductor is used. The estimate priced every HV coil from the without-S.E. row, 12A-b or 12A-a,
as a hardcoded constant.

### WHAT WAS BUILT

1. **One field, `hvSeConductor`, on the internal inspection** - blank / S.E. / Not S.E. - in its own
   column after Condition and before Est. vs Circle Limit.
   - **Blank is a real, selectable option, and nothing defaults it** - unlike Winding Type beside it,
     which pre-fills AL. A pre-filled answer is submitted unread, and this one moves the most
     expensive line on the estimate by Rs 50/kg.
   - **It has its own select**, because `renderSelectField` offers no blank option: a controlled
     select whose value matches no option shows the first option while holding `''`, so an
     unanswered field would have looked answered.
2. **The save boundary.** The form refuses to save a blank answer. An inspection saved before the
   field existed prices without S.E. - exactly as before - and the estimate says so on screen.
   Today that is 43 of the 77 live jobs.
3. **The issued-document warning.** Before saving, the form asks for confirmation when all three hold:
   - the job carries an issued document (`issuedMarks`, the app's one definition);
   - it has an HV coil weight;
   - the answer changes what the HV coil prices at. Unanswered prices without S.E., so answering
     "Not S.E." on an old inspection changes nothing and is not asked about.

   It lists each job and its documents. Estimates recompute rather than reproduce, so a figure
   changing under an issued document has to be chosen, the way consent to repair within the limit
   is.
4. **Pricing, in both tenders.** S.E. selects 12A-b1 / 12A-a1: 213 / 407 under UGVCL-2020, 215 / 411
   under UGVCL-2026. An unrecognised value blocks rather than guesses.
   - **⚠ The S.E. lookup names no master code.** The master's `12A(b)` row holds the without-S.E.
     figure, and `resolveRate`'s copy test compares a master cell against the baseline of the row
     being priced. A copied 163 would differ from 12A-b1's 213, read as a genuine override, and price
     S.E. work at 163. Verified with a real override: 170 in `12A(b)` prices Not S.E. at 170 and S.E.
     at 213.
5. **The wording follows the answer.** An answered HV line reads "Aluminium SE" or "Aluminium".
   - An unanswered one keeps the wording this estimate has always printed - "Aluminium SE", whatever
     the rate - so an issued estimate reprints unchanged.
   - The on-screen notice says plainly that the old wording does not mean the S.E. rate was used.
6. **The printed inspection sheet carries the column, and it has been printed** - a real MR through
   `triggerUniversalPrint` in headless Chrome, before and after G61. See PRINTED below.
   - Print-subtree hashes against HEAD: 12 of 13 printed documents are byte-identical, and the only
     change is this sheet.
   - This entry first rested the fit on stated widths alone, and the report of it said the sheet had
     29 columns. It has 26 (25 before); the comment above `CHUNK_SIZE` said 27, and is corrected.

### WHY THERE IS NO LV FIELD - A DECISION, WITH A STATED LIMIT

**The tender prices LV S.E. too.** 13A-a1 and 13A-b1 - and 13B-a1 / 13B-b1, originals missing - are
transcribed in both schedules. **But LV is never super-enamelled in practice**, so one HV answer is
what the inspection records, and those rows stay unused.

The field went one → two → one on the way here. The tender's separate rows, and an agency that set
the HV rate and left LV alone, argued for two; the practical fact decided one.

> **⚠ STATED LIMIT:** if an LV S.E. transformer ever arrives, the tender prices it at 13A-b1 and
> this app has no way to say so - its LV coil prices without S.E. The line to change is the LV coil
> in `SingleJobEstimateReport`, and the rows it needs are already in Schedule-A.

**No S.E. rows were added to the estimate master** - a decision recorded in O20 and at the coil rows
in `scheduleItemMap.ts`. Pricing reads Schedule-A when the master has no row.

### GUJARAT ENERGY TRANSMISSION, AND THE ORDER

On 2026-09-11 the agency's own account typed 213 - the with-S.E. rate - into AT 2020-21/01/1049's
`12A(b)`, the without-S.E. row, at five capacities. All four of its jobs were inspected the same day,
none has an issued document, and nothing records whether the work is S.E. The agency is being asked
whether it is, and whether it is HV only.

`scripts/admin/revert-at-1049-12Ab.js` puts the five cells back to 163, the agency's own figures. It
ships in dry-run mode and **refuses to apply while 21GETS-45, -46 and -47 have no HV S.E. answer**
(the scrap job is excluded).

The order:
1. this field is deployed;
2. the answers are recorded on those inspections;
3. the operator runs the revert.

Until then the typed 213 still prices those jobs' HV coils whatever the answer - verified - which is
exactly why the revert waits for the answers.

### NOT DONE

- **The Excel export of the inspection sheet has no HV S.E. column - recorded, not built.** Who reads
  it, as far as the repository can say:
  - **Nothing in the app sends it anywhere.** `handleExportExcel` writes
    `Internal_Inspection_MR_<n>.xlsx` to the operator's machine. No email, upload or covering letter
    names it.
  - **The document made for UGVCL to sign is the printed sheet.** It carries the joint-inspection
    signature block - Inspected by (Junior Engineer), Executive Engineer, and the agency's signatory
    - and tender clause 4.0 makes the internal inspection joint with UGVCL's engineers. The
    estimate's covering letter, "submitting you inspection reports and estimates", goes to the circle
    office. The printed sheet carries the column.
  - **The Excel file has no letterhead and no signatures**, so it is not the signed report. Whether an
    agency emails it to a division office anyway is not something the code can show - **that is the
    agency's answer to give**, and it decides how much the gap matters.
  - **Why it was missed is structural.** The export rebuilds its rows from the form data rather than
    serialising the page - the second half of *"an export that serialises the page cannot disagree
    with it; one that rebuilds always can"* - so a column added to the page cannot reach it by itself.
- **The estimate header's "Aluminium SE"** (`windingTypeStr`) still prints for every aluminium job,
  whatever the rate. It is pre-existing and left alone; only the HV line's wording now follows the
  answer.
- **`scripts/hv-coil-se-exposure-console.js`** still states the old answer in its header. It is a
  historical measurement script.

### VERIFIED, AND NOT

Passed:
- `tsc --noEmit`, `vite build`, the hooks guard, and `npm test` (25).
- **Regression:** all 77 live jobs priced by HEAD's builder and by the working tree's - **0 moved**.
  No inspection records the field yet.
- **Positive control, 20 checks:**
  - unanswered, Not S.E., S.E. and an unrecognised value, under both tenders;
  - copper under both tenders;
  - LV untouched;
  - the override case;
  - AT 1049 as it stands.

**⚠ THE FIRST REGRESSION RUN WAS BLIND.** The harness stubs every bare import, and its test treated
the builder's absolute Windows path, `C:/…`, as one. Both "builders" were therefore stubs: all 77
jobs returned no estimate, and the run reported "0 moved". It was caught only because the positive
control then crashed on the same missing estimate. The harness now fails if no job produces an
estimate - the G33 / G59 / G60 failure again, in a check written the same day as G60's. That
assertion is now the stated default shape for every such script, in the pattern *a harness that
reports "no difference" must contain a case that MUST differ*.

The harness lives in the session's scratchpad, not the repository. **The app itself was not run in
a browser**: the form and the confirmation are verified by reading and by the harness, not by use.
The printed sheet was rendered from the component's own source text, below.

### PRINTED

MR 85558 was printed five ways through the app's `triggerUniversalPrint`, in headless Chrome, at the
`@page` size that function writes. The MR is MEGHA's: 18 jobs, two sheets, and a full-A4 letterhead
with a 64mm header, 25mm footer and 12mm side margins.
- **The sheet was not re-typed.** The harness cuts the component's print branch out of
  `InternalInspection.tsx` and asserts that the cut contains, byte for byte, the subtree
  `print-subtree-hashes.js` hashes.
- **It asserts something printed before it judges fit.** Checked: two sheets on screen and two PDF
  pages, all 18 rows, the letterhead drawn, the column present only after G61 and directly after
  Condition, and every perturbation present in every row.

On the tightest sheet of each print:

| Print | Narrowest the table can be | Spare of 1,031.8px printable | Rows taller than before |
|---|---|---|---|
| before G61 | 758.6px | 273.2px | - |
| G61, today's data (column blank) | 794.7px | 237.1px | 0 |
| G61, every row "Not S.E." | 798.1px | 233.7px | 0 |
| before G61, longest real value of every field in every row | 765.6px | 266.2px | - |
| G61, the same, "Not S.E." | 805.1px | 226.7px | 0 |

- **The column takes 40px.** It comes out of the four columns that had room - Job No, Trans S.No, Make
  and Type / Core, each about 9% narrower.
- Nothing is past the margin, no cell clips its text, "Not S.E." stays on one line, and no row got
  taller.
- **The spare is width that unbreakable text can still use** - roughly 40 more characters of job number
  at 9.5px monospace. Serial and Make break anywhere, so a longer one costs height rather than width.
- **The live database is mostly test entries.** Its longest serial is 12 characters and its longest make
  16, so the stress print is the longest this data holds, not the longest an agency will type.

**⚠ THE FIT CHECK WAS BLIND ON ITS FIRST RUN - the rule above, in the harness written to follow it.**
- **What it did:** it asserted that rows printed, then measured fit against the page box and the cell
  widths.
- **What it missed:** it reported "signature yes" and "nothing below the page" for a stress sheet
  whose picture showed the signature block cut off. The text is in the DOM and inside the page; it is
  `PrintableA4Page`'s `overflow-hidden` body that cuts it.
- **What caught it:** a picture of each sheet.
- **Now:** it measures every element against its nearest clipping container, and that cut-off pre-G61
  stress sheet is its positive control.

**What it found is not G61's, and is recorded as O58.** On this letterhead, nine two-line rows leave
27.6px under the table, and the last sheet's signature block is cut off by 43.8px. It is identical
before and after G61.

**Also seen, also not G61's.** MEGHA's letterhead image carries its own "For MSD Corporation /
Authorized Signatory" and "Page 1 of 1" inside the picture, above the 25mm footer the agency set.
- They print through the table's lower rows.
- The report reads "Page 1 of 1" on each of two sheets.

That is the agency's image and footer setting, and nothing in the app detects it.


## G62. The coil lines print the Schedule-A row they were priced as

Point 5 of the S.E. request, which G61 did not build. Verifying G61, the HV coil line's Sr. No. read
"20" - its position on the sheet. A division office needs the tender row: whether that coil was
priced at 12A-b1 (with S.E., 213) or 12A-b (without, 163) is not visible anywhere else on the page.

### WHAT CHANGED

**Each coil line carries `scheduleSr`, the Schedule-A row its rate was selected from, and the Sr. No.
cell prints it in place of the position:**

| Line | Row printed |
|---|---|
| HV Coil | 12A-b / 12A-b1 aluminium; 12A-a / 12A-a1 copper - by the HV S.E. answer |
| LV Coil | 13A-b / 13A-a |
| Re-insulation LV Coil | 14-ii / 14-i |
| Labour HV Coil | 12C-b / 12C-a |
| Labour LV Coil | 13C-b / 13C-a |

- **The row is named once and used twice** - to look up the rate and to print - so the code cannot name
  a row other than the one the builder read.
- **Every other line keeps its position.** `sr` is unchanged, because pagination and row keys use it,
  so a sheet's numbering now skips where coil lines sit: 19, 12A-b, 13A-b, 14-ii, 23.
- **Itemised sheet only.** Coil lines never appear on the fixed-rate sheet. The cell does not wrap: a
  code split at its hyphen would make the row taller than `layoutEstimatePages` budgets for.
- **12B (originals missing) cannot print**, because nothing reaches it (O21).
- **A master override prints its row too.** AT 1049's typed 213 in `12A(b)` prints as 12A-b @ 213 until
  its revert - a code and rate the division can now see disagree.

### ⚠ WHAT IT CHANGES ON DOCUMENTS ALREADY ISSUED

Estimates recompute, so a reprint shows the codes. **One issued estimate carries coil lines: STD-1,
sent 2026-09-10.** Its positions 20, 22 and 27 reprint as 12A-b, 14-ii and 12C-b; every figure is
unchanged. ASTD-1 carries an issued bill, which prints no estimate lines, and no issued estimate.

**⚠ AND AN UNANSWERED LINE NOW CONTRADICTS ITSELF.** G61 kept "HV Coil(Aluminium SE)-N" on aluminium
jobs with no S.E. answer, so that issued estimates would reprint unchanged. That line now prints
**12A-b - the without-S.E. row - beside the words "Aluminium SE"**. The reason for keeping the
wording was reprint stability, and G62 changes those reprints anyway. Not changed here: it is wording
on a document UGVCL reads, and is a decision.

### NOT BUILT

- **The multi-job estimate sheet.** Its rows are master items across up to five jobs, and one row's
  jobs can have been priced from different rows - one S.E., one not. One Sr. cell cannot name both.
  Splitting such a row by schedule row, or printing the code per column, is a decision.
- **The estimate Excel export**, for the same reason. Its SR column prints the master item code
  (`12A(b)`).
- The Word export serialises the printed page, so it carries the codes without a change.

### FOUND, NOT G62's

- Copper labour coil lines price at the aluminium rate (O60).
- Every estimate prints a hardcoded 2020-21 order number, whatever its tender (O61).
- SU-5's one-page estimate is cut off below its Final Amount (O58).

### VERIFIED, AND NOT

Passed:
- `tsc --noEmit`, `vite build`, the hooks guard and `npm test` (25).
- **Print-subtree hashes against HEAD:** 12 of 13 byte-identical; the itemised estimate
  (`SingleJobEstimateReport#1`) changed.
- **The builder, 8e2e5e7 against the working tree** (a detached worktree):
  - 77 live jobs, 77 estimates, **0 moved** with `scheduleSr` set aside;
  - 54 estimates carry codes, none on a non-coil line;
  - all 136 charged coil lines carry the row their material and S.E. answer select.
- **A synthetic 63 kVA job under both tenders**, aluminium and copper, each S.E. answer, with no master
  anywhere: every line's code and rate are the same row - except copper labour, whose wrong rate is
  identical on 8e2e5e7 (O60).
- **Printed through `triggerUniversalPrint` in headless Chrome**, before and after: MSBT-8 (full-A4
  letterhead, two pages) and SU-5 (no letterhead, one page), and MSBT-8 answered S.E.
  - It asserts first that the pages match the PDF, all 28 lines printed, all five coil lines were
    found, and the S.E. answer landed.
  - Then: same pages, same lines per page, every description, rate and amount identical, non-coil
    numbers unchanged, no row taller, no Sr. No. cell on two lines, no description newly wrapped,
    nothing newly cut off.
  - The Sr. No. column went 26.7px to 30.4px, taken from the description column (404.9 to 402).
  - Answered S.E., MSBT-8 prints `12A-b1 HV Coil(Aluminium SE)-N 10.00 @ 213.00 = 2,130.00`.

**Two of the checks were wrong on first run, and both said so rather than passing:**
- **The print harness refused the right commit.** Its test that the old source lacked `scheduleSr`
  matched `scheduleSrForMasterCode`. It now tests for the field's declaration.
- **The builder check blamed G62 for the copper labour rates.** It assumed an AT with an empty master
  prices from Schedule-A alone. An empty AT section falls back to the agency's master, and then to the
  built-in default. It now empties both, and separates a rate G62 introduced from one 8e2e5e7 already
  produced by pricing the same inputs on both.

Not verified: the app run in a browser, and a physical printer.
