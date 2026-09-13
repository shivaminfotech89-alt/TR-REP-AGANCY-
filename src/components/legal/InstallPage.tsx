import React from 'react';
import { LegalLayout } from './LegalLayout';
import { SELLER } from '../../lib/seller';
import {
  guessBrowser, orderSections, currentEnvironment, type InstallSection,
} from '../../lib/browserInstall';

/**
 * HOW TO INSTALL THIS APP, ON EVERY BROWSER THAT CAN (AUDIT G81).
 *
 * ⚠ A PUBLIC PAGE, ON PURPOSE. It is registered in `App.tsx`'s `PUBLIC_PAGES`, which resolve from
 * `window.location.pathname` BEFORE the auth check - so the owner can send an agency this link before they have an
 * account, and it renders identically signed in or out.
 *
 * ⚠ EVERY ROUTE IS SHOWN. THE BROWSER GUESS ONLY ORDERS THEM. Hiding on a user-agent guess would cost a Safari
 * user the answer - shown Chrome's steps alone, they have been told the app cannot be installed, which is false.
 * Ordering wrongly costs a scroll. See lib/browserInstall.ts.
 *
 * ⚠ AND IT DOES NOT PROMISE ONE-CLICK INSTALL. No browser lets a page raise its own install prompt: Chrome decides
 * when to offer, the page can only relay an offer already made, and Safari never offers at all. The sidebar button
 * exists when Chrome has offered; this page is what everyone else gets, and it says so.
 */

const UPDATED = '13 September 2026';

interface Route {
  heading: string;
  works: 'one-click' | 'manual' | 'no';
  steps: React.ReactNode;
}

const ROUTES: Record<InstallSection, Route> = {
  chrome: {
    heading: 'Google Chrome — Windows, Mac, Linux and Android',
    works: 'one-click',
    steps: (
      <>
        <p>
          <strong>On a computer:</strong> look for the install icon at the right-hand end of the address bar and
          click it, then choose <strong>Install</strong>. If you do not see it, open the <strong>⋮</strong> menu
          (top right) and choose <strong>Save and share → Install TransRegister</strong>.
        </p>
        <p>
          <strong>On Android:</strong> open the <strong>⋮</strong> menu and choose{' '}
          <strong>Add to Home screen → Install app</strong>.
        </p>
        <p className="text-slate-500">
          Chrome only offers the icon once it has decided the site qualifies, which usually takes about half a
          minute of use. If it has not appeared yet, the menu route above always works. Installed apps are listed at{' '}
          <span className="font-mono">chrome://apps</span>.
        </p>
      </>
    ),
  },
  edge: {
    heading: 'Microsoft Edge — Windows and Mac',
    works: 'one-click',
    steps: (
      <>
        <p>
          Look for the app icon at the right-hand end of the address bar, or open the <strong>⋯</strong> menu (top
          right) and choose <strong>Apps → Install this site as an app</strong>.
        </p>
        <p className="text-slate-500">
          Installed apps are listed at <span className="font-mono">edge://apps</span>, where they can also be
          removed.
        </p>
      </>
    ),
  },
  'safari-ios': {
    heading: 'iPhone and iPad — Safari',
    works: 'manual',
    steps: (
      <>
        <p>
          Tap the <strong>Share</strong> button (the square with an arrow pointing up), scroll down the list and tap{' '}
          <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
        </p>
        <p className="text-slate-500">
          Needs iOS or iPadOS 16.4 or later. Safari does not offer an install button and never will — Apple does not
          support that, so this is the normal way and not a workaround. Other browsers on iPhone and iPad use the
          same Share menu, because they all run Safari's engine underneath.
        </p>
      </>
    ),
  },
  'safari-macos': {
    heading: 'Mac — Safari',
    works: 'manual',
    steps: (
      <>
        <p>
          With {SELLER.site} open, choose <strong>File → Add to Dock</strong> from the menu bar, then{' '}
          <strong>Add</strong>.
        </p>
        <p className="text-slate-500">
          Needs macOS 14 (Sonoma) or later. As on iPhone, Safari shows no install button — the File menu is the
          route.
        </p>
      </>
    ),
  },
  firefox: {
    heading: 'Firefox — not supported',
    works: 'no',
    steps: (
      <>
        <p>
          <strong>Firefox cannot install web apps.</strong> Mozilla removed that feature and has not brought it
          back, so there is no menu item to look for and no setting to turn on.
        </p>
        <p className="text-slate-500">
          Firefox works perfectly well for using {SELLER.product} in a normal tab — nothing is missing. If you want
          it as an app with its own icon and window, install it from Chrome or Edge instead. Anything suggesting
          otherwise involves a third-party add-on we do not recommend or support.
        </p>
      </>
    ),
  },
};

const BADGE: Record<Route['works'], { text: string; className: string }> = {
  'one-click': { text: 'Installs properly', className: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  manual: { text: 'Installs — manually', className: 'bg-blue-50 text-blue-800 border-blue-300' },
  no: { text: 'Cannot install', className: 'bg-amber-50 text-amber-900 border-amber-300' },
};

export function InstallPage() {
  // Read once: the guess orders the list and nothing else depends on it.
  const guess = React.useMemo(() => guessBrowser(currentEnvironment()), []);
  const order = React.useMemo(() => orderSections(guess), [guess]);

  return (
    <LegalLayout title={`Install ${SELLER.product}`} updated={UPDATED} showSeller={false}>
      <p>
        {SELLER.product} runs in a browser, and it can also be installed — it then has its own icon and its own
        window, without an address bar, exactly like any other application. There is no app store, nothing to
        download, and no separate version: it is the same site.
      </p>

      {/* ⚠ SAID PLAINLY, BECAUSE THE OPPOSITE IS WHAT PEOPLE ASSUME OF AN INSTALLED APP. There is no offline mode
          and no cached copy - deliberately, so nobody is ever shown yesterday's rates (AUDIT G80). */}
      <p className="text-slate-600">
        <strong>It still needs an internet connection.</strong> Installing puts the app on your device; it does not
        store your data there. This is deliberate — it means what you see is always the current version, never a
        copy saved on the machine.
      </p>

      {guess.section && (
        <p className="text-[12px] font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded px-3 py-2">
          You appear to be using <strong>{guess.label}</strong>, so those steps are first. Every other browser is
          listed below as well.
        </p>
      )}

      <div className="space-y-4">
        {order.map((key, i) => {
          const route = ROUTES[key];
          const badge = BADGE[route.works];
          return (
            <section key={key} className="border border-slate-200 rounded-lg p-3.5 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-bold text-slate-900 text-sm">{route.heading}</h2>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${badge.className}`}>
                  {badge.text}
                </span>
                {i === 0 && guess.section === key && (
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">your browser</span>
                )}
              </div>
              <div className="space-y-1.5 text-[13px] text-slate-700">{route.steps}</div>
            </section>
          );
        })}
      </div>

      <p className="text-slate-600">
        Once installed, open it from the Start menu, the Dock, or your home screen. To remove it, uninstall it the
        way you would any other app — your data is on our servers, not on the device, so nothing is lost.
      </p>

      <p className="text-[12px] text-slate-500">
        Trouble installing? Write to <a href={`mailto:${SELLER.email}`} className="text-blue-700 underline">{SELLER.email}</a>{' '}
        and say which browser and which device you are using.
      </p>
    </LegalLayout>
  );
}
