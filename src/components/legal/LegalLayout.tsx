import React from 'react';
import { APP_MARK } from '../../lib/ui';
import { SELLER, isPlaceholder } from '../../lib/seller';

/**
 * THE SHELL EVERY POLICY PAGE SITS IN (AUDIT G41).
 *
 * ⚠ THESE PAGES RENDER WITHOUT A ROUTER AND WITHOUT WAITING FOR AUTH, and both are deliberate.
 * `BrowserRouter` used to live inside the signed-in branch of App.tsx, so when signed out there
 * was no router at all and every URL rendered the landing page: `transregister.com/terms`
 * returned 200 and showed a marketing page. There was no mechanism for a public policy URL, not
 * merely no pages.
 *
 * They are now chosen from `window.location.pathname` BEFORE the auth check, so a reviewer sees
 * the document immediately rather than after a Firebase round-trip - and sees the same document
 * whether or not they happen to be signed in. Navigation between them is plain `<a href>`,
 * because these are documents rather than app screens and a full page load is what a reviewer
 * does anyway.
 *
 * ⚠ THE SELLER IDENTITY IS ON EVERY ONE OF THEM, not only on Contact. A payment processor has to
 * verify that the entity taking the money is the entity on the site, and a policy page that
 * names no entity is a policy belonging to nobody. It names the PROPRIETOR as the legal party
 * and the trade name as a trading style, because that is what a proprietorship is.
 */

export const LEGAL_PATHS = [
  ['/pricing', 'Pricing'],
  ['/terms', 'Terms'],
  ['/privacy', 'Privacy'],
  ['/refunds', 'Refunds & Cancellation'],
  ['/shipping', 'Delivery'],
  ['/contact', 'Contact'],
] as const;

/** A value still awaiting the operator. Shown, never hidden - see lib/seller.ts. */
function Field({ label, value }: { label: string; value: string }) {
  const missing = isPlaceholder(value);
  return (
    <div className="flex flex-wrap gap-x-2 text-xs">
      <span className="font-bold text-slate-500 w-40 shrink-0">{label}</span>
      <span className={missing ? 'font-bold text-red-700' : 'text-slate-800'}>
        {missing ? `${value} — TO BE SUPPLIED` : value}
      </span>
    </div>
  );
}

export function SellerBlock() {
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
        Operated by
      </p>
      {/* ⚠ THE PROPRIETOR IS NAMED FIRST AND AS THE LEGAL PARTY. A proprietorship has no separate
          legal personality: the trade name cannot be a party to a contract, so writing "MSD
          CORPORATION" alone would name nobody a customer could hold to anything. */}
      <Field label="Proprietor" value={SELLER.legalName} />
      <Field label="Trading as" value={SELLER.tradeName} />
      <Field label="Constitution" value={SELLER.constitution} />
      <Field label="GSTIN" value={SELLER.gstin} />
      <Field label="Registered address" value={SELLER.address} />
      <Field label="Phone" value={SELLER.phone} />
      <Field label="Email" value={SELLER.email} />
    </div>
  );
}

export function LegalLayout({
  title, updated, children,
}: { title: string; updated: string; children: React.ReactNode }) {
  const here = typeof window !== 'undefined' ? window.location.pathname.replace(/\/$/, '') : '';
  return (
    <div className="min-h-screen bg-white text-slate-800">
      <header className="border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <a href="/" className="flex items-center gap-2 shrink-0">
            <img src={APP_MARK} alt={SELLER.product} className="w-7 h-7" referrerPolicy="no-referrer" />
            <span className="font-extrabold text-slate-900 text-sm">{SELLER.product}</span>
          </a>
          <nav className="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold">
            {LEGAL_PATHS.map(([path, label]) => (
              <a
                key={path}
                href={path}
                className={here === path ? 'text-blue-700' : 'text-slate-500 hover:text-slate-900'}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="text-xl font-black text-slate-900">{title}</h1>
          {/* ⚠ A REAL DATE, MAINTAINED BY HAND. The Terms carried "Version 2.5 • August 2026" -
              a version literal G26 deleted from the login page for encoding a fact nothing
              updated, surviving here, on the document where being out of date matters most. A
              single date that someone must change when they change the text is honest; a version
              number no release process touches is not. */}
          <p className="text-[11px] text-slate-500 mt-0.5">Last updated: {updated}</p>
        </div>

        <div className="space-y-4 text-[13px] leading-relaxed">{children}</div>

        <SellerBlock />

        <p className="text-[10px] text-slate-400 pt-2 border-t border-slate-100">
          © {new Date().getFullYear()} {SELLER.legalName}, trading as {SELLER.tradeName}.
          {' '}<a href="/" className="underline hover:text-slate-700">Back to {SELLER.site}</a>
        </p>
      </main>
    </div>
  );
}

export function Section({ n, heading, children }: { n: number; heading: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h2 className="font-bold text-slate-900 text-sm">{n}. {heading}</h2>
      <div className="space-y-2 text-slate-700">{children}</div>
    </section>
  );
}
