// WHAT AN ALLOTMENT ACTUALLY HOLDS — READ-ONLY.  node scripts/admin/allotment-shape.js
import { all, banner, fmtDate } from './_db.js';
banner('ALLOTMENT SHAPE');
const [agencies, ats, jobs] = await Promise.all([all('agencies'), all('atMasters'), all('jobs')]);
const agName = id => agencies.find(a => a.id === id)?.name || id;

for (const at of ats) {
  console.log(`\n=== AT ${at.atNumber || at.name} [${agName(at.agencyId)}] ===`);
  console.log('  allotments (division -> coreType -> count):');
  console.log('   ', JSON.stringify(at.allotments || {}, null, 2).replace(/\n/g, '\n    '));
  const hist = at.allotmentHistory || [];
  console.log(`  allotmentHistory: ${hist.length} record(s)`);
  if (hist.length) {
    console.table(hist.map(h => ({
      date: h.date, letterNo: h.letterNo, division: h.division,
      coreType: h.coreType, quantity: h.quantity,
      otherKeys: Object.keys(h).filter(k =>
        !['id','date','letterNo','division','coreType','quantity','addedAt'].includes(k)).join(',') || '(none)',
    })));
  }
  // what job numbers actually exist under this AT, per division+core
  const mine = jobs.filter(j => j.atId === at.id);
  const byKey = {};
  mine.forEach(j => {
    const k = `${j.division}/${j.coreType || 'CRGO'}`;
    const tail = String(j.jobNo || '').split('-').pop();
    const n = /^\d+$/.test(tail) ? Number(tail) : null;
    (byKey[k] ||= { nums: [], raw: [] });
    byKey[k].raw.push(j.jobNo);
    if (n !== null) byKey[k].nums.push(n);
  });
  if (Object.keys(byKey).length) {
    console.log('  job numbers issued under this AT:');
    console.table(Object.entries(byKey).map(([k, v]) => ({
      divisionCore: k, count: v.raw.length,
      lowest: v.nums.length ? Math.min(...v.nums) : '-',
      highest: v.nums.length ? Math.max(...v.nums) : '-',
      contiguous: v.nums.length ? (Math.max(...v.nums) - Math.min(...v.nums) + 1 === v.nums.length ? 'yes' : 'NO — gaps') : '-',
      numbers: v.nums.sort((a, b) => a - b).join(','),
    })));
  }
}
console.log('\nDone. Nothing was written.');
