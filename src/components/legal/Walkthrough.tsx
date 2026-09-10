import React from 'react';

/**
 * WHAT THE APP PRODUCES — the walkthrough on /pricing (AUDIT G48).
 *
 * ⚠ IT LEADS WITH THE PRINTED DOCUMENTS, AND THAT IS THE WHOLE ARGUMENT. A transformer
 * contractor's real question is not "what features are there" but "will this produce the bill my
 * division accepts". The printed A4 output IS the product, so a picture of the bill answers the
 * question better than a feature list or a live demo would - and it needs no login, no
 * fabricated data and no cleanup.
 *
 * ⚠ A MISSING IMAGE RENDERS AS A NAMED GAP, NOT AS A BROKEN IMAGE OR AN EMPTY BOX. Until a
 * screenshot is supplied, the slot says which file it wants and what it should show. A
 * walkthrough that looks finished while half its images are missing is the same defect as a
 * contact page with a placeholder address (G41): it invites shipping something incomplete
 * without noticing.
 */

export type Shot = {
  /** File under public/walkthrough/. Absent until supplied. */
  file: string;
  title: string;
  /** What a contractor should recognise in it. One sentence, concrete. */
  caption: string;
  /** Portrait A4 unless stated - drives the aspect ratio of the placeholder. */
  landscape?: boolean;
};

/**
 * ⚠ THE ORDER IS THE ARGUMENT. Estimate, then bill, then guarantee, then inspection: that is the
 * sequence a job actually moves through, and it is the sequence a contractor recognises. A gallery
 * ordered by what is prettiest teaches nothing about whether the app fits their work.
 */
export const SHOTS: Shot[] = [
  {
    file: 'estimate-sheet.webp',
    title: 'Estimate sheet',
    caption: 'Priced from the tender schedule, item by item, with the accepted percentage applied '
      + 'and the Clause 4.0 circle limit checked before it is issued.',
  },
  {
    file: 'tax-invoice.webp',
    title: 'GST tax invoice',
    caption: 'On your letterhead, with the DISCOM as the buyer, CGST and SGST split from the '
      + 'agency’s own GSTIN, and the amount in words.',
  },
  {
    file: 'guarantee-certificate.webp',
    title: 'Guarantee certificate',
    caption: 'The guarantee period taken from the tender by core type, not typed in — so the '
      + 'certificate cannot disagree with the A/T it is issued under.',
  },
  {
    file: 'inspection-report.webp',
    title: 'Inspection report',
    caption: 'External and internal inspection on one sheet, with the readings checked against '
      + 'IS 1180 tolerances as they are entered.',
  },
  {
    file: 'multi-job-estimate.webp',
    title: 'Multi-job estimate',
    caption: 'Several transformers from one MR on a single A4 page — items down, transformers '
      + 'across.',
    landscape: false,
  },
  {
    file: 'job-register.webp',
    title: 'Job register',
    caption: 'Every transformer under an MR, with its stage, its job number and where it is in the '
      + 'workshop.',
    landscape: true,
  },
];

function Placeholder({ shot }: { shot: Shot }) {
  return (
    <div
      className="w-full rounded border-2 border-dashed border-amber-400 bg-amber-50 flex flex-col items-center justify-center p-4 text-center"
      style={{ aspectRatio: shot.landscape ? '1.414 / 1' : '1 / 1.414' }}
    >
      <p className="text-[11px] font-bold text-amber-900">Screenshot not supplied yet</p>
      <p className="text-[10px] font-mono text-amber-800 mt-1 break-all">
        public/walkthrough/{shot.file}
      </p>
    </div>
  );
}

export function Walkthrough({ available }: { available?: Set<string> }) {
  // ⚠ WHICH FILES EXIST IS NOT KNOWABLE AT RUNTIME without fetching each one, so the caller
  // passes the set. With none passed, every slot shows its placeholder - which is the honest
  // default for a page whose images have not arrived.
  const has = (f: string) => !!available?.has(f);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-slate-900 text-sm">What it produces</h2>
        <p className="text-slate-700 mt-1">
          The documents below are what the software prints. They go to the division as they are
          — on your letterhead, with your GSTIN, priced from your tender&rsquo;s own schedule.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SHOTS.map(shot => (
          <figure key={shot.file} className="space-y-1.5">
            {has(shot.file) ? (
              <img
                src={`/walkthrough/${shot.file}`}
                alt={shot.title}
                loading="lazy"
                className="w-full rounded border border-slate-300 shadow-sm"
              />
            ) : (
              <Placeholder shot={shot} />
            )}
            <figcaption>
              <span className="block text-xs font-bold text-slate-900">{shot.title}</span>
              <span className="block text-[11px] text-slate-600 leading-snug">{shot.caption}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <p className="text-[11px] text-slate-500">
        Figures in these examples are from the vendor&rsquo;s own agency and are illustrative.
      </p>
    </div>
  );
}
