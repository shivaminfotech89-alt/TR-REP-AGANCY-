import { Info } from 'lucide-react';
import {
  COLUMN_ABBREVIATIONS, VALUE_ABBREVIATIONS, type ColumnKey, type ValueKey,
} from '../lib/inspectionAbbreviations';

/**
 * WHAT THE COLUMN ABBREVIATIONS MEAN - SCREEN ONLY (AUDIT G98).
 *
 * A `<details>` line above the table, collapsed by default. Native, so it opens by tap on a phone
 * and by keyboard with no state to manage - the reason it is not a tooltip: `title` does nothing on
 * touch, and these screens are used on phones.
 *
 * ⚠ `print:hidden` ON THE OUTERMOST ELEMENT, AND IT IS NOT REDUNDANT. The Print button copies only
 * the `printable-*-inspection-sheet` element, which this is not inside - but `triggerUniversalPrint`
 * falls back to `window.print()` when that element is missing, and a phone's own Share -> Print
 * prints the page. The screen table carries print styling for exactly that path. The separate
 * render path covers the button; this class covers every other way of printing.
 *
 * Meanings come from lib/inspectionAbbreviations.ts and nowhere else.
 */
export function InspectionLegend({ columns, values }: {
  columns: readonly ColumnKey[];
  values: readonly ValueKey[];
}) {
  const entry = (key: string, short: string, meaning: string, detail?: string) => (
    <div key={key} className="flex gap-2 min-w-0">
      <dt className="font-mono font-bold text-slate-900 shrink-0 w-[5.5rem]">{short}</dt>
      <dd className="text-slate-600 min-w-0">
        {meaning}
        {detail && <span className="block text-[11px] text-slate-500">{detail}</span>}
      </dd>
    </div>
  );

  return (
    <details className="print:hidden mb-2 rounded-lg border border-slate-200 bg-white text-xs">
      <summary className="cursor-pointer select-none px-3 py-2 min-h-[40px] flex items-center gap-1.5 font-semibold text-slate-700">
        <Info className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        What the column abbreviations mean
      </summary>
      <div className="px-3 pb-3 pt-2 border-t border-slate-100 space-y-3">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
          {columns.map(k => {
            const a = COLUMN_ABBREVIATIONS[k];
            return entry(k, a.short, a.meaning, 'detail' in a ? a.detail : undefined);
          })}
        </dl>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Values in the cells</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
            {values.map(k => {
              const a = VALUE_ABBREVIATIONS[k];
              return entry(k, a.short, a.meaning, 'detail' in a ? a.detail : undefined);
            })}
          </dl>
        </div>
      </div>
    </details>
  );
}
