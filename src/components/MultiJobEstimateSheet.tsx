import React from 'react';
import { Agency } from '../lib/AgencyContext';
import { PrintableA4Page } from './LetterheadHeader';

/** Same shape the per-job sheet prints, so the two documents read alike. */
const formatCurrency = (val: number) =>
  Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * THE MULTI-JOB ESTIMATE — items down, transformers across, one A4 page per five jobs.
 *
 * ⚠ THIS IS A REBUILD, NOT A RESTORE (AUDIT G8). A matrix like this existed and was deleted
 * with two faults recorded against it:
 *
 *   1. IT PRINTED A FABRICATED DOCUMENT NUMBER - `Math.floor(Math.random() * 100) + 1`,
 *      computed at RENDER TIME, so two prints of the same estimate carried different numbers
 *      and a reprint would not match the copy the division held. This sheet takes the
 *      reference the operator typed and the send stores as `estimateRefNo`, and if that is
 *      empty it SAYS SO rather than substituting anything.
 *
 *   2. ITS CELLS CAME FROM A SECOND PRICING ENGINE that charged every optional item on every
 *      job. This component computes nothing. Every figure arrives already priced, through
 *      `builderLineFor`, which reads `buildSingleJobEstimateData` - the one engine the
 *      per-job sheet and the Excel export both use. If a future change needs a number this
 *      file does not receive, the answer is to pass it in, never to derive it here.
 *
 * It is written as its own component for that reason: 363 inline lines were what made the
 * original restorable wholesale from git history without anyone reading line 1614.
 *
 * ⚠ IT REPLACES the per-job sheets when an agency chooses it - it is not a summary
 * accompanying them - so it carries what the division needs: the reference, the MR details,
 * the AT percentage, the totals and the signature block.
 *
 * ⚠ WHAT IT CANNOT CARRY, stated here because it is a real limitation of the format and not
 * an oversight. The per-job sheet prints Sr | Item | Unit | Quantity | Unit Rate | Amount.
 * A matrix cell holds ONE number, so:
 *     Unit      KEPT - it is a property of the item, not the job, so it is a shared column.
 *     Quantity  LOST - it differs per job (three coils against two) and there is no room.
 *     Unit Rate LOST - it differs per job too, by capacity band and winding material.
 * A division checking a line against the tender sees the amount but not the qty x rate that
 * produced it. That is the cost of the format, and an agency that needs the breakdown should
 * send the per-job sheets instead.
 */

export interface MatrixItem {
  sr: number;
  code: string;
  name: string;
  unit: string;
}

export interface MatrixColumn {
  jobId: string;
  jobNo: string;
  kva: string;
  make: string;
  serialNo: string;
  /** Amount per item code. Absent means the item does not apply to this job. */
  cells: Record<string, number>;
  baseTotal: number;
  atPercentage: number;
  percentageAmount: number;
  finalAmount: number;
  /**
   * ⚠ NON-EMPTY MEANS THIS COLUMN PRINTS A REFUSAL INSTEAD OF FIGURES.
   * In a column of numbers a blank cell reads as "no charge for this item" and a zero reads
   * as "priced at nothing". A job that could not be priced means neither. Opposite meanings,
   * so it gets words.
   */
  rateErrors: string[];
}

export interface MultiJobEstimateData {
  refNo: string;
  mrNo: string;
  division: string;
  items: MatrixItem[];
  columns: MatrixColumn[];
  /** Sum of every column's finalAmount, computed by the caller from the same figures. */
  grandTotal: number;
  signedByText: string;
}

const PER_PAGE = 5;

export function MultiJobEstimateSheet({ agency, data }: { agency: Agency | null; data: MultiJobEstimateData }) {
  const pages: MatrixColumn[][] = [];
  for (let i = 0; i < data.columns.length; i += PER_PAGE) {
    pages.push(data.columns.slice(i, i + PER_PAGE));
  }
  if (!pages.length) pages.push([]);

  const priced = data.columns.filter(c => c.rateErrors.length === 0);
  const blocked = data.columns.length - priced.length;

  /**
   * ⚠ THE GRAND TOTAL IS ASSERTED, NOT ASSUMED. The caller sums the columns; this re-sums
   * the pages. If a job were dropped between paginating and printing, the two disagree and
   * the sheet SAYS SO rather than printing the smaller figure, which would look complete.
   */
  const pagedSum = Number(
    pages.flat().filter(c => c.rateErrors.length === 0)
      .reduce((n, c) => n + Number(c.finalAmount || 0), 0).toFixed(2));
  const totalsAgree = Math.abs(pagedSum - Number(data.grandTotal.toFixed(2))) < 0.01;

  return (
    <>
      {pages.map((cols, pageIdx) => {
        const isLast = pageIdx === pages.length - 1;
        const from = pageIdx * PER_PAGE + 1;
        const to = pageIdx * PER_PAGE + cols.length;
        return (
          <PrintableA4Page key={pageIdx} agency={agency} documentTitle="ESTIMATE — MULTIPLE TRANSFORMERS">
            <div className="text-black text-[10px]">

              {/* IDENTITY. The reference is the operator's, never generated - see the note
                  at the top of this file and AUDIT G8. */}
              <div className="flex justify-between items-start mb-2 text-xs">
                <div>
                  <p><strong>M.R. No.:</strong> {data.mrNo || '—'}</p>
                  <p><strong>Division:</strong> {data.division || '—'}</p>
                </div>
                <div className="text-right">
                  {data.refNo
                    ? <p><strong>REF. NO.:</strong> {data.refNo}</p>
                    : <p className="font-bold border border-black px-1.5 py-0.5">
                        REFERENCE NUMBER NOT SET
                      </p>}
                  <p className="mt-0.5">
                    Page {pageIdx + 1} of {pages.length} &mdash; transformers {from} to {to} of {data.columns.length}
                  </p>
                </div>
              </div>

              <table className="w-full border-collapse border border-black text-[9.5px]">
                <thead>
                  <tr className="font-bold">
                    <th className="border border-black p-1 w-7">Sr.</th>
                    {/* 70mm at print width. Wide enough that most descriptions stay on one
                        line, which is what cost the sixth job column. */}
                    <th className="border border-black p-1 text-left" style={{ width: '70mm' }}>Item Description</th>
                    <th className="border border-black p-1 w-10">Unit</th>
                    {cols.map(c => (
                      <th key={c.jobId} className="border border-black p-1 text-right align-bottom" style={{ width: '20mm' }}>
                        <span className="block font-mono font-black">{c.jobNo}</span>
                        <span className="block font-normal text-[8.5px] leading-tight">{c.kva} KVA</span>
                        <span className="block font-normal text-[8.5px] leading-tight">{c.make || '—'}</span>
                        <span className="block font-normal text-[8.5px] leading-tight font-mono">{c.serialNo || '—'}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(item => (
                    <tr key={item.code}>
                      <td className="border border-black p-1 text-center">{item.sr}</td>
                      <td className="border border-black p-1">{item.name}</td>
                      <td className="border border-black p-1 text-center">{item.unit}</td>
                      {cols.map(c => (
                        <td key={c.jobId} className="border border-black p-1 text-right font-mono tabular-nums">
                          {/* ⚠ A BLOCKED COLUMN SHOWS NOTHING PER ITEM, and the refusal is
                              said once in the totals rows below rather than repeated down
                              every line. Printing figures here for a job whose total is
                              withheld would invite adding them up. */}
                          {c.rateErrors.length > 0
                            ? ''
                            : (c.cells[item.code] !== undefined ? formatCurrency(c.cells[item.code]) : '—')}
                        </td>
                      ))}
                    </tr>
                  ))}

                  {/* THE ARITHMETIC AS ROWS, so a reader follows one column down and gets what
                      the single sheet prints: base, percentage, amount. */}
                  <tr className="font-bold">
                    <td className="border border-black p-1 text-right" colSpan={3}>Total Amount</td>
                    {cols.map(c => (
                      <td key={c.jobId} className="border border-black p-1 text-right font-mono tabular-nums">
                        {c.rateErrors.length > 0 ? '' : formatCurrency(c.baseTotal)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="border border-black p-1 text-right" colSpan={3}>
                      Percentage
                    </td>
                    {cols.map(c => (
                      <td key={c.jobId} className="border border-black p-1 text-right font-mono tabular-nums">
                        {c.rateErrors.length > 0
                          ? ''
                          : <>({c.atPercentage >= 0 ? '+' : ''}{c.atPercentage.toFixed(1)}%) {formatCurrency(c.percentageAmount)}</>}
                      </td>
                    ))}
                  </tr>
                  <tr className="font-black">
                    <td className="border border-black p-1 text-right" colSpan={3}>Final Amount</td>
                    {cols.map(c => (
                      <td key={c.jobId} className="border border-black p-1 text-right font-mono tabular-nums">
                        {/* ⚠ WORDS, NOT A BLANK AND NOT A ZERO. This is the one cell where the
                            difference is unmissable, so it is where the refusal is said. */}
                        {c.rateErrors.length > 0
                          ? <span className="font-bold text-[8px] leading-tight block">WITHHELD — rate not confirmed</span>
                          : formatCurrency(c.finalAmount)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>

              {/* THE BLOCKED JOBS NAMED, with their reasons, so "WITHHELD" in a column is
                  followed by why. */}
              {cols.some(c => c.rateErrors.length > 0) && (
                <div className="mt-2 border border-black p-1.5 text-[9px]">
                  <p className="font-bold">Transformers whose amount is withheld:</p>
                  {cols.filter(c => c.rateErrors.length > 0).map(c => (
                    <p key={c.jobId} className="mt-0.5">
                      <span className="font-mono font-bold">{c.jobNo}</span> &mdash; {c.rateErrors.join(' ')}
                    </p>
                  ))}
                </div>
              )}

              {isLast && (
                <>
                  <div className="mt-3 flex justify-end">
                    <table className="border-collapse border border-black text-xs">
                      <tbody>
                        <tr className="font-black">
                          <td className="border border-black p-1.5">
                            GRAND TOTAL &mdash; {priced.length} transformer{priced.length === 1 ? '' : 's'}
                          </td>
                          <td className="border border-black p-1.5 text-right font-mono tabular-nums w-32">
                            {totalsAgree ? formatCurrency(data.grandTotal) : '—'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {!totalsAgree && (
                    <p className="mt-1 text-right text-[9px] font-bold border border-black inline-block px-1.5 py-0.5 float-right clear-both">
                      TOTAL WITHHELD &mdash; the per-page column totals ({formatCurrency(pagedSum)}) do not
                      reconcile against the estimate total ({formatCurrency(data.grandTotal)}).
                    </p>
                  )}

                  {blocked > 0 && (
                    <p className="mt-1 clear-both text-[9px] font-bold">
                      {blocked} transformer{blocked === 1 ? ' is' : 's are'} excluded from the grand total
                      because {blocked === 1 ? 'its amount is' : 'their amounts are'} withheld.
                    </p>
                  )}

                  <div className="mt-8 flex justify-between items-end text-xs clear-both">
                    <div>
                      <p>Thanking you</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold mb-8">Yours faithfully</p>
                      <p className="font-bold">{data.signedByText}</p>
                      <p className="text-[10px] text-slate-600">Auth Sign.</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </PrintableA4Page>
        );
      })}
    </>
  );
}
