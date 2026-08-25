// CAN A HANDWRITTEN AGENCY NAME BE MATCHED TO ONE OF THE OWNER'S AGENCIES?
// READ-ONLY.  node scripts/admin/agency-name-match-test.js
//
// The wrong-agency check needs to compare what the MR says against the agency being booked
// into. Agency names are free text, so "MEGHA" must match "M/s Megha Transformers" without
// a strict comparison warning constantly and being ignored within a week.
//
// The trick is that this is NOT a string equality test. It is a CLASSIFICATION over a small
// closed set - the owner's own agencies, of which there are two to four. The question is
// "which of my agencies does this text name", not "does this text equal the active one".
import { all, banner } from './_db.js';

const STOP = new Set(['MS','M/S','MESSRS','TRANSFORMER','TRANSFORMERS','TR','ELECTRICAL','ELECTRICALS',
  'PVT','PRIVATE','LTD','LIMITED','CO','COMPANY','AND','THE','ENTERPRISE','ENTERPRISES','INDUSTRIES']);

const tokens = s => String(s || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ')
  .split(/\s+/).filter(t => t && !STOP.has(t));

/** How well `text` names `agencyName`: distinctive tokens shared, over the smaller set. */
function score(text, agencyName) {
  const a = new Set(tokens(text)), b = new Set(tokens(agencyName));
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter(t => b.has(t)).length;
  return shared / Math.min(a.size, b.size);
}

/** Best match among the owner's agencies, or null when nothing is convincing. */
function classify(text, candidates) {
  const ranked = candidates.map(c => ({ name: c.name, s: score(text, c.name) }))
    .sort((x, y) => y.s - x.s);
  const [top, second] = ranked;
  if (!top || top.s < 0.5) return { verdict: 'no confident match', ranked };
  if (second && second.s >= top.s) return { verdict: 'ambiguous', ranked };
  return { verdict: top.name, ranked };
}

banner('AGENCY NAME MATCHING — feasibility');
const agencies = await all('agencies');
const byOwner = {};
agencies.forEach(a => { (byOwner[a.ownerId] ||= []).push({ name: a.name }); });

for (const [owner, list] of Object.entries(byOwner)) {
  console.log(`\n=== owner ${owner.slice(0, 8)} — ${list.length} agencies ===`);
  console.log(`    ${list.map(a => `"${a.name}"`).join(', ')}`);
  // Plausible handwritten forms of each real name, plus a decoy
  const trials = [];
  list.forEach(a => {
    const t = tokens(a.name);
    const distinct = t[0] || a.name;
    trials.push([a.name, a.name], [distinct, a.name],
      [`M/s ${a.name} Transformers`, a.name], [`${a.name.toLowerCase()} tr.`, a.name]);
  });
  trials.push(['SOME OTHER FIRM', '(none — should not match)']);
  console.table(trials.map(([text, expect]) => {
    const r = classify(text, list);
    return { written: text, expected: expect, matched: r.verdict,
      ok: r.verdict === expect || (expect.startsWith('(none') && r.verdict === 'no confident match') ? 'yes' : 'NO',
      scores: r.ranked.map(x => `${x.name}:${x.s.toFixed(2)}`).join(' ') };
  }));
}
console.log('\nDone. Nothing was written.');
