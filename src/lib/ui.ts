/**
 * SHARED PRESENTATION TOKENS (AUDIT G9).
 *
 * ⚠ SCREEN CHROME ONLY. Nothing here is imported by a printed document. The A4 layouts -
 * SingleJobEstimateReport, EstimateGenerate's forwarding letter, BillingSystem's tax invoice,
 * DispatchChallan, TestingReport, ExternalInspection, InternalInspection, LetterheadHeader -
 * are matched to what UGVCL expects and to a real reference sheet, and two of them were just
 * fitted to a single page against it. They keep their own literal classes and must render
 * byte-identically. If a token ever appears inside a `PrintableA4Page`, that is the bug.
 *
 * WHY TOKENS RATHER THAN PER-SCREEN CLASSES. Dashboard alone carried seven card treatments -
 * emerald border, blue border, slate-900 hero, three tint levels of the same colour, and two
 * radii - which is not a style so much as an accumulation. One vocabulary means a later screen
 * cannot drift, and it makes the direction reviewable in one file instead of eleven.
 *
 * THE RULES THIS ENCODES:
 *
 *  1. ⚠ COLOUR IS NEVER THE ONLY SIGNAL. These screens are printed and photocopied, and an
 *     operator may be colour-blind. Every tone below pairs a colour with a WORD and an icon at
 *     the call site; `TONE[x].dot` exists so a shape survives greyscale even when the text is
 *     read at a glance. Same rule as GP_TEXT_CLASS in jobDisplay.
 *
 *  2. DENSITY BEATS WHITESPACE. This is read on a workshop floor, often standing, often on a
 *     small screen. Padding is deliberately tight and radii small; the information-to-chrome
 *     ratio is the thing being maximised, not the calm.
 *
 *  3. NUMBERS ARE TABULAR. `NUM` sets `tabular-nums`, so a column of figures aligns on the
 *     decimal instead of dancing. On a screen whose content is quantities this is the single
 *     biggest legibility gain available, and it costs nothing.
 *
 *  4. ACCENT ON ONE EDGE, NOT ALL FOUR. A fully coloured border around every card makes six
 *     cards shout at each other. A 2px left edge says the same thing and lets the eye find the
 *     one card that is actually a warning.
 */

/** Card surface. Accent tones come from `cardTone` below. */
export const CARD = 'bg-white border border-slate-200 rounded-lg';

/** Standard card padding — tight on purpose. */
export const CARD_PAD = 'p-2.5 sm:p-3';

/** Section heading inside a card. */
export const CARD_TITLE = 'text-xs font-bold text-slate-900 flex items-center gap-1.5';

/** Small uppercase label above a value. Recedes so the value reads first. */
export const LABEL = 'text-[10px] font-bold uppercase tracking-wider text-slate-500';

/** Secondary line under a heading. */
export const SUBLABEL = 'text-[11px] text-slate-600';

/**
 * Any figure IN A TABLE OR A METRIC. Tabular so columns align; mono for digit width.
 *
 * ⚠ NOT FOR RUNNING PROSE - use NUM_INLINE. Mono digits inside a sentence read as code:
 * "Live Workshop Dashboard · 37 Units (12 MRs)" in a mono face looks like console output on a
 * screen that is otherwise plain English.
 */
export const NUM = 'font-mono tabular-nums';

/**
 * A figure INSIDE A SENTENCE. Keeps the body face, so it reads as text, while still fixing
 * digit width so a value that ticks up does not shuffle the words after it.
 *
 * `tabular-nums` alone, deliberately: the alignment benefit of a mono face only exists in a
 * column, and there is no column here.
 */
export const NUM_INLINE = 'tabular-nums';

/** The big number on a metric card. */
export const METRIC = `${NUM} text-2xl sm:text-3xl font-black tracking-tight leading-none`;

/** A quiet divider inside a card. */
export const RULE = 'border-t border-slate-100';

/** Footer link at the bottom of a card. */
export const CARD_LINK =
  'mt-2 pt-1.5 border-t border-slate-100 text-[11px] font-bold flex items-center justify-between hover:underline';

/**
 * SEMANTIC TONES. `text` is for the figure, `dot` is the shape that survives greyscale,
 * `chip` is a labelled pill, `edge` is the card's left accent.
 *
 * ⚠ NOT A PALETTE - A VOCABULARY. `warn` means "a person must look at this", not "amber".
 * Picking a tone by how it looks is how a colour ends up meaning two things on one screen.
 */
export const TONE = {
  neutral: {
    text: 'text-slate-900', dot: 'bg-slate-400', edge: 'border-l-slate-300',
    chip: 'text-slate-700 bg-slate-100 border-slate-300',
  },
  good: {
    text: 'text-emerald-900', dot: 'bg-emerald-500', edge: 'border-l-emerald-500',
    chip: 'text-emerald-800 bg-emerald-50 border-emerald-300',
  },
  info: {
    text: 'text-blue-900', dot: 'bg-blue-500', edge: 'border-l-blue-500',
    chip: 'text-blue-800 bg-blue-50 border-blue-300',
  },
  warn: {
    text: 'text-amber-900', dot: 'bg-amber-500', edge: 'border-l-amber-500',
    chip: 'text-amber-900 bg-amber-50 border-amber-300',
  },
  bad: {
    text: 'text-rose-900', dot: 'bg-rose-500', edge: 'border-l-rose-500',
    chip: 'text-rose-800 bg-rose-50 border-rose-300',
  },
} as const;

export type ToneName = keyof typeof TONE;

/* ------------------------------------------------------------------------------------------
 * THEMES
 * ------------------------------------------------------------------------------------------
 *
 * ⚠ EVERY TOKEN ABOVE IS MEASURED AGAINST `bg-white`, AND THAT IS THEME-INDEPENDENT.
 *
 * It is worth stating why, because the obvious assumption is wrong. The app has 15 themes, but
 * `ThemeConfig` has NO per-theme card colour - only `sidebarCardBg`, which is the sidebar's.
 * Content cards are `bg-white` under every theme, so `LABEL`, `SUBLABEL`, `TONE[*].text`, `TH`
 * and `TD` sit on white always. Mapping them through the theme would be churn that changes
 * nothing and adds a way for them to drift.
 *
 * ⚠ THE REAL GAP IS NARROW: exactly ONE theme (`isDarkWorkspace: true`, `mainBg #030712`) has
 * a dark content area. It only matters for a token placed DIRECTLY ON THE PAGE, outside a
 * card - today nothing is, which is why nothing is broken. `onPage` exists so the first screen
 * that needs it has an answer rather than inventing one.
 *
 * (A previous note in this session recommended "theme variables" broadly. That was overstated:
 * the fault it came from was in the SIDEBAR, whose background genuinely varies and which does
 * not use these tokens at all. Measured rather than assumed, the mapping is not needed.)
 *
 * ⚠⚠ FOUR COLOUR SETS ARE EXCLUDED FROM THIS VOCABULARY, AND THEY ARE EXCLUDED FOR TWO
 * DIFFERENT REASONS. The distinction matters, because only one kind is detectable by a tool.
 *
 *   CONTRAST-COMMITTED (1-3 below): the colour was MEASURED against specific backgrounds. A
 *   substitution fails a contrast check - so an automated audit would catch it, eventually,
 *   on a screen someone thought to test.
 *
 *   MEANING-COMMITTED (4 below): the colour CARRIES A DISTINCTION IN WHAT IT SAYS. A
 *   substitution passes every contrast check, every lint, every type check, and is still
 *   wrong - because what broke is not legibility, it is what the operator concludes. Nothing
 *   automated will ever find it.
 *
 * Sets 1-3 must never be mapped through a theme, or pulled into TONE, without re-measuring
 * against that theme's actual backgrounds:
 *
 *   1. GP BROWN - `#5B3A1A`, `GP_TEXT_CLASS` in lib/jobDisplay.tsx. Contrast-checked against
 *      LIGHT row backgrounds only, including the amber scrap tint and the selected-row states.
 *      A theme that darkened a row would silently drop it below threshold.
 *   2. THE TENDER STATE CHIP - emerald / amber / indigo in AppLayout's sidebar selector. These
 *      are not decorative: they map one-to-one onto `isIntakeOpen`'s three outcomes, and the
 *      sidebar background DOES vary by theme, so they are already hand-paired to `isLight`.
 *   3. DISPATCH'S REPAIRABLE / SCRAP TINT and its selected-row states, checked against the
 *      same light row backgrounds as GP brown and against each other.
 *
 *   4. ⚠ THE CIRCLE-LIMIT INDICATOR - `renderCircleLimitIndicator` in InternalInspection.
 *      MEANING-COMMITTED, not contrast-committed. Three visual states carry three different
 *      statements about what the operator should do:
 *        - `text-slate-400 italic`  = "nothing to do here"   (fixed-rate job, or a missing
 *                                     RATE, which is not this operator's next action)
 *        - `text-amber-700 italic`  = "YOUR next action"     (a field on the row in front of
 *                                     them is blank)
 *        - `text-slate-500 italic underline` = "this is a clickable setup gap"
 *
 *      The code says it outright: "grey reads as 'nothing to do here', which is the opposite
 *      of the case". Four branches produce seven distinct messages, and F79 established that
 *      the wording distinguishes an UNENTERED FIELD from an UNCONFIGURED RATE - sending an
 *      operator to the Estimate Master to fix a field on the bench in front of them was a real
 *      failure, not a hypothetical one.
 *
 *      Flattening these into `chip('warn')` would look like a tidy-up, pass every check, and
 *      silently merge "you can fix this" with "someone else must configure this".
 *
 * If you are here to add theme support: 1-3 need re-measuring, 4 needs leaving alone.
 * Everything else on this page sits on white and needs nothing.
 */

/**
 * Text placed directly on the page background rather than inside a card. Pass
 * `currentTheme.isDarkWorkspace`.
 */
export const onPage = (isDarkWorkspace?: boolean) =>
  isDarkWorkspace ? 'text-slate-200' : 'text-slate-800';

/** A muted variant of the same. */
export const onPageMuted = (isDarkWorkspace?: boolean) =>
  isDarkWorkspace ? 'text-slate-400' : 'text-slate-500';

/** A card with a single accented edge. */
export const cardTone = (tone: ToneName) => `${CARD} border-l-2 ${TONE[tone].edge}`;

/**
 * A labelled status pill. ⚠ `label` is REQUIRED - there is no colour-only variant, by
 * construction, so a photocopy still carries the meaning.
 */
export const chip = (tone: ToneName) =>
  `inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold ${TONE[tone].chip}`;

/**
 * Table shell. ⚠ `overflow-x-auto` AND NO RESPONSIVE COLUMN HIDING. An operator needs the
 * whole row: a KVA breakdown missing its middle columns on a phone is not a smaller table, it
 * is a different and wrong one. Scroll sideways instead.
 */
export const TABLE_WRAP = 'overflow-x-auto -mx-2.5 sm:mx-0 px-2.5 sm:px-0';
export const TABLE = 'w-full text-left border-collapse';
export const TH = 'px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 bg-slate-50 border-b border-slate-200 whitespace-nowrap';
export const TD = 'px-2 py-1.5 text-xs text-slate-800 border-b border-slate-100 whitespace-nowrap';
