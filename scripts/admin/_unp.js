import { all, banner } from './_db.js';
banner('JOB NUMBERS THAT THE SEEDER CANNOT READ');
// Mirrors addAtMaster's seed parser exactly: the trailing digit run.
const tail = raw => { const m = String(raw ?? '').trim().match(/(\d+)\s*$/); return m ? Number(m[1]) : null; };
const [agencies, ats, jobs] = await Promise.all([all('agencies'), all('atMasters'), all('jobs')]);
const agName = id => agencies.find(a=>a.id===id)?.name || id;
const bad = jobs.filter(j => { const raw=String(j.jobNo??'').trim(); return raw && tail(raw)===null; });
const blank = jobs.filter(j => !String(j.jobNo??'').trim());
console.log(`${jobs.length} job(s): ${bad.length} unreadable, ${blank.length} with no job number at all\n`);
if (bad.length) console.table(bad.map(j=>({agency:agName(j.agencyId), jobNo:j.jobNo, mr:j.mrNo, division:j.division, core:j.coreType})));
if (blank.length) console.table(blank.slice(0,10).map(j=>({agency:agName(j.agencyId), jobNo:'(empty)', mr:j.mrNo, division:j.division})));
console.log('\n=== would the counter actually sit low? per counter key ===');
const { default: _ } = { default: null };
const key = (div,core)=>{const t=String(core||'CRGO').toUpperCase();
  if(t==='OH')return `${div}_OH`; if(t.includes('AMORPHOUS')||t.includes('AM'))return `${div}_AMORPHOUS`;
  if(t.includes('WOUND')||t.includes('WC'))return `${div}_WOUND_CORE`; return `${div}_CRGO`;};
const rows=[];
for (const at of ats) {
  const mine = jobs.filter(j=>j.agencyId===at.agencyId);
  const byKey={};
  mine.forEach(j=>{ const k=key(String(j.division??'').trim(), j.coreType); const n=tail(j.jobNo);
    byKey[k] ||= {max:0,unreadable:0};
    if(n===null){ if(String(j.jobNo??'').trim()) byKey[k].unreadable++; } else byKey[k].max=Math.max(byKey[k].max,n); });
  Object.entries(byKey).forEach(([k,v])=>{ if(v.unreadable) rows.push({
    at: at.atNumber||at.name, agency: agName(at.agencyId), counterKey:k,
    stored: (at.lastJobNumbers||{})[k] ?? '(unset)', highestReadable: v.max, unreadable: v.unreadable }); });
}
console.log(rows.length ? '' : '  No counter key on any AT has an unreadable job number under it.');
if (rows.length) console.table(rows);
