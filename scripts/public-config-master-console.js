// READ-ONLY: what does the SHARED default actually hold?
//
// `public_config/estimate_master` is the published shared baseline. Two paths read it:
//   - getEstimateMasterForCore, when an agency's own section is empty or misfiled;
//   - addAgency, which seeds EVERY new agency from it (AUDIT F30).
//
// So if its Wound Core field carries the CRGO card, every new agency inherits the CRGO
// card regardless of which agency is active - and it must be corrected before any publish,
// because publishing writes on top of it.
//
// It WRITES NOTHING. It reports.
//
// HOW TO RUN: npm run dev, log in, reload the tab, paste into the DevTools console.

(async () => {
  const db = window.__db, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { doc, getDoc } = fs;

  const { checkMasterSection } = await import('/src/lib/estimateMasterHealth.ts');

  const hdr = t => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);

  const read = async (col, id) => {
    try {
      const snap = await getDoc(doc(db, col, id));
      return snap.exists() ? snap.data() : null;
    } catch (e) {
      console.warn(`Could not read ${col}/${id}:`, e?.message || e);
      return undefined;   // undefined = unreadable, null = absent. Not the same thing.
    }
  };

  const pub = await read('public_config', 'estimate_master');
  const sys = await read('system_config', 'estimate_master');

  const FIELD = {
    CRGO: 'estimateMasterCRGO',
    AMORPHOUS: 'estimateMasterAmorphous',
    WOUND_CORE: 'estimateMasterWoundCore',
    OVERHAULING: 'estimateMasterOverhauling',
  };

  const describe = (label, docData) => {
    hdr(`${label}`);
    if (docData === undefined) { console.log('UNREADABLE - permission or network error. Not the same as absent.'); return; }
    if (docData === null) { console.log('DOES NOT EXIST. New agencies fall through to the shipped code defaults.'); return; }
    console.log(`updatedAt: ${docData.updatedAt ? new Date(docData.updatedAt).toISOString() : '(none)'}   updatedBy: ${docData.updatedBy || '(none)'}`);
    console.table(Object.entries(FIELD).map(([section, field]) => {
      const list = docData[field];
      const h = checkMasterSection(section, list);
      return {
        section: h.label,
        stored: list === undefined ? 'FIELD ABSENT' : `${list.length} item(s)`,
        verdict: h.blocking
          ? 'HOLDS THE CRGO CARD'
          : h.isEmpty
            ? (h.emptyIsNormalHere ? 'empty (normal for this section)' : 'EMPTY')
            : (h.problems.length ? 'problems' : 'looks right'),
        ownCodesPct: Math.round(h.ownScore * 100),
        crgoCodesPct: Math.round(h.crgoScore * 100),
        requiredScrapCode: h.requiredScrapCode ?? '-',
        scrapCodePresent: h.requiredScrapCode === null ? '-' : h.scrapCodePresent,
        problems: h.problems.join(' | ') || '(none)',
      };
    }));
    // The legacy CRGO field is seeded from the same value and is worth seeing.
    if (docData.estimateMaster) {
      console.log(`legacy estimateMaster field: ${docData.estimateMaster.length} item(s)`);
    }
  };

  describe('public_config/estimate_master  - THE SHARED DEFAULT, read by addAgency', pub);
  describe('system_config/estimate_master  - legacy mirror, read only if public_config is absent', sys);

  hdr('WHAT TO DO WITH THIS');
  console.log('WOUND_CORE = "HOLDS THE CRGO CARD"  -> every new agency inherits the CRGO card,');
  console.log('   whichever agency is active. Correct this BEFORE publishing anything, since a');
  console.log('   publish writes on top of this document.');
  console.log('');
  console.log('Any section "EMPTY" -> new agencies fall through to the shipped code default for');
  console.log('   it, which is usually right. Empty OVERHAULING is normal - that section holds');
  console.log('   optional per-item overrides of Schedule-A, and OH prices from Schedule-A.');
  console.log('');
  console.log('DOES NOT EXIST -> nothing has ever been published. addAgency uses the shipped');
  console.log('   defaults, which is the clean starting position.');

  window.__publicConfigMaster = { publicConfig: pub, systemConfig: sys };
  console.log('\nFull results: window.__publicConfigMaster');
})();
