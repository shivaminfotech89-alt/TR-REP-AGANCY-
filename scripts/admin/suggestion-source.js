// WHAT THE APP WILL SUGGEST NEXT, AND WHAT THE COUNTER SAYS — READ-ONLY.
//
//   node scripts/admin/suggestion-source.js
//
// Suggestions no longer come from `lastJobNumbers`. They continue from the highest job
// number actually SAVED under that prefix (AUDIT F70), so that:
//
//   - an abandoned intake suggests the same number again, nothing having been saved;
//   - a deleted or cancelled job frees its number, being no longer among the saved jobs;
//   - the number offered is always one past a number that is really on a transformer.
//
// This prints both, per prefix, so the gap between them is visible. A counter ABOVE the
// saved maximum is the accumulated cost of the reservation model that has now been removed:
// every one of those is a number that was drawn, written to `lastJobNumbers`, and never put
// on a transformer. Under the old rule the next intake started past them; under the new one
// they are simply reused.
//
// Nothing here writes. The gap is reported, not closed - the counter is still advanced at
// save and is left exactly as it is.

import { all, banner } from './_db.js';

banner('SUGGESTION SOURCE — SAVED JOBS vs COUNTER');

const [agencies, ats, jobs] = await Promise.all([all('agencies'), all('atMasters'), all('jobs')]);
const agName = id => agencies.find(a => a.id === id)?.name || id || '(none)';

// Every prefix configured anywhere, with the agency and division/core type it belongs to.
const prefixes = [];
const addFrom = (prefixMap, agencyId, source) => {
  Object.entries(prefixMap || {}).forEach(([div, v]) => {
    if (typeof v === 'string') prefixes.push({ agencyId, division: div, core: 'CRGO', prefix: v, source });
    else Object.entries(v || {}).forEach(([core, p]) => {
      if (p) prefixes.push({ agencyId, division: div, core, prefix: p, source });
    });
  });
};
ats.forEach(a => addFrom(a.prefixes, a.agencyId, `AT ${a.atNumber || a.name || a.id}`));
agencies.forEach(a => addFrom(a.prefixes, a.id, 'agency'));

// One row per (agency, prefix) - the sequence is the prefix, whatever divisions share it.
const seen = new Set();
const rows = [];

for (const p of prefixes) {
  const head = `${p.prefix.toUpperCase()}-`;
  const tailOf = v => {
    const raw = String(v ?? '').trim().toUpperCase();
    if (!raw.startsWith(head)) return 0;
    const n = Number(raw.slice(head.length));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const mine = jobs.filter(j => j.agencyId === p.agencyId);
  const savedMax = mine.reduce((m, j) => Math.max(m, tailOf(j.jobNo)), 0);
  const savedCount = mine.filter(j => tailOf(j.jobNo) > 0).length;

  // THE COUNTER KEY FOR THIS DIVISION AND CORE TYPE, and only that one.
  //
  // The first version matched any key starting with `<division>_`, so an LSTC prefix was
  // compared against DEESA_CRGO's counter and reported 29 numbers burned that were never
  // its. Fourth time in this audit a check has reported confidently outside its own model,
  // and the first three are recorded in read-counters.js - so: mirror getCounterKey exactly.
  const counterKey = (division, coreType) => {
    const t = String(coreType || 'CRGO').trim().toUpperCase();
    if (t === 'OH') return `${division}_OH`;
    if (t.includes('AMORPHOUS') || t.includes('AM')) return `${division}_AMORPHOUS`;
    if (t.includes('WOUND') || t.includes('WC')) return `${division}_WOUND_CORE`;
    return `${division}_CRGO`;
  };
  const ckey = counterKey(p.division, p.core);
  // CRGO also lives under the bare `<division>` key - the pair the save advances together.
  const keys = ckey.endsWith('_CRGO') ? [ckey, p.division] : [ckey];

  // Deduped on the COUNTER too, not on the prefix alone. Two core types can be configured
  // with the same prefix in one division; they share a number sequence but are counted
  // separately, and collapsing them would hide one of the two comparisons.
  const dedupeKey = `${p.agencyId}|${p.prefix.toUpperCase()}|${ckey}`;
  if (seen.has(dedupeKey)) continue;
  seen.add(dedupeKey);

  let counterMax = 0;
  const bag = [...ats.filter(a => a.agencyId === p.agencyId), ...agencies.filter(a => a.id === p.agencyId)];
  bag.forEach(d => keys.forEach(k => {
    const v = (d.lastJobNumbers || {})[k];
    if (v !== undefined) counterMax = Math.max(counterMax, Number(v) || 0);
  }));

  rows.push({
    agency: agName(p.agencyId),
    prefix: p.prefix,
    division: p.division,
    savedJobs: savedCount,
    highestSaved: savedMax || '-',
    willSuggest: `${p.prefix}-${savedMax + 1}`,
    counterKey: keys.join(' | '),
    counterSays: counterMax || '-',
    wouldHaveSuggested: counterMax ? `${p.prefix}-${counterMax + 1}` : '-',
    burned: counterMax > savedMax ? counterMax - savedMax : 0,
  });
}

// A COUNTER SHARED BY TWO PREFIXES CANNOT BE COMPARED AGAINST EITHER.
//
// getCounterKey maps LSTC to `<div>_CRGO` - it matches neither OH, AMORPHOUS/AM, nor
// WOUND/WC, so it falls through to the CRGO branch. LSTC therefore has its OWN prefix
// ("LSU", "MLST") but shares CRGO's counter. The counter's value is then mostly CRGO's
// numbering, and reading it as "LSU numbers that were burned" is wrong by the whole of
// SU's history. Those rows are marked and excluded from the total.
const counterOwners = {};
rows.forEach(r => { (counterOwners[`${r.agency}|${r.counterKey}`] ||= new Set()).add(r.prefix); });
rows.forEach(r => {
  const owners = counterOwners[`${r.agency}|${r.counterKey}`];
  r.sharedCounter = owners.size > 1 ? [...owners].join(' + ') : '';
});

rows.sort((a, b) => b.burned - a.burned || a.agency.localeCompare(b.agency));
console.log(`${rows.length} prefix sequence(s) across ${agencies.length} agency(ies)\n`);
console.table(rows);

const shared = rows.filter(r => r.sharedCounter);
if (shared.length) {
  console.log(`\n  ⚠ ${shared.length} prefix(es) SHARE a counter with another prefix, so the gap`);
  console.log('  between saved and counter is not a burn count for either of them:');
  [...new Set(shared.map(r => `    ${r.agency} · ${r.counterKey} <- ${r.sharedCounter}`))]
    .forEach(l => console.log(l));
  console.log('  This is getCounterKey: LSTC matches none of its branches and falls through');
  console.log('  to CRGO, so an LSTC prefix numbers off the CRGO sequence. Whether that is');
  console.log('  intended is a question for the division - the two share a run of numbers.');
}

const burned = rows.filter(r => r.burned > 0 && !r.sharedCounter);
const total = burned.reduce((n, r) => n + r.burned, 0);

console.log('\n=== READING THIS ===');
if (burned.length === 0) {
  console.log('  No counter sits above its saved maximum. Nothing was drawn and abandoned.');
} else {
  console.log(`  ${total} number(s) across ${burned.length} sequence(s) sit between the highest`);
  console.log('  SAVED job and the counter. Each was issued to an operator and never reached a');
  console.log('  transformer - the accumulated cost of the reservation model (F70).');
  burned.forEach(r => console.log(
    `    ${r.agency} / ${r.prefix}: saved to ${r.highestSaved}, counter at ${r.counterSays}  (+${r.burned})`));
  console.log('\n  These are now REUSED rather than skipped: the suggestion continues from the');
  console.log('  saved job, so the next intake is offered the first of them.');
  console.log('  ⚠ CONFIRM WITH THE DIVISION before relying on that for a number that was');
  console.log('  written on a transformer and then abandoned - the app cannot tell the two');
  console.log('  apart, and only the division knows what it has on record.');
}

console.log('\nDone. Nothing was written.');
