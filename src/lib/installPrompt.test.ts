// Tests for lib/installPrompt.ts (AUDIT G82). Run with `npm test`.
//
// These cover the STORE, not the hook: the defect they exist for was never about rendering. It was that the one
// offer the browser gives was held per-component, so it did not survive the consumer that caught it unmounting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initInstallOffer,
  resetInstallOfferForTests,
  subscribeToInstallOffer,
  installOfferSnapshot,
  handleBeforeInstallPrompt,
  handleAppInstalled,
  markInstallOfferDismissed,
  takeInstallEvent,
} from './installPrompt';

/** A window that records handlers so a test can fire the event Chrome would. */
function fakeWindow() {
  const handlers: Record<string, Array<(e: any) => void>> = {};
  return {
    addEventListener(type: string, fn: (e: any) => void) {
      if (!handlers[type]) handlers[type] = [];
      handlers[type].push(fn);
    },
    removeEventListener() {},
    fire(type: string, e?: any) {
      for (const fn of handlers[type] || []) fn(e);
    },
    handlerCount(type: string) {
      return (handlers[type] || []).length;
    },
  };
}

function fakeEvent() {
  const e: any = {
    defaultPrevented: false,
    preventDefault() { e.defaultPrevented = true; },
    prompt: async () => {},
    userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
  };
  return e;
}

function fresh() {
  resetInstallOfferForTests();
  const win = fakeWindow();
  initInstallOffer(win);
  return win;
}

// ---------------------------------------------------------------- the regression

test('⚠ the offer survives the consumer that caught it unmounting - AUDIT G82', () => {
  const win = fresh();

  // The visitor is on the landing page. It subscribes, and Chrome fires while they read.
  const unsubscribeLanding = subscribeToInstallOffer(() => {});
  win.fire('beforeinstallprompt', fakeEvent());
  assert.equal(installOfferSnapshot().hasOffer, true, 'the landing page has an offer to relay');

  // They sign in. signInWithPopup does NOT reload, so LandingPage unmounts and AppLayout mounts.
  unsubscribeLanding();
  subscribeToInstallOffer(() => {});

  assert.equal(
    installOfferSnapshot().hasOffer,
    true,
    'the sidebar row must still have the offer - this is the bug the singleton exists for',
  );
});

test('two consumers see the same offer, and both are told when it arrives', () => {
  const win = fresh();
  let landing = 0;
  let sidebar = 0;
  subscribeToInstallOffer(() => { landing++; });
  subscribeToInstallOffer(() => { sidebar++; });

  win.fire('beforeinstallprompt', fakeEvent());

  assert.equal(landing, 1);
  assert.equal(sidebar, 1);
  assert.equal(installOfferSnapshot().hasOffer, true);
});

// ---------------------------------------------------------------- the event itself

test("Chrome's own UI is suppressed, so there is one offer rather than two", () => {
  const win = fresh();
  const e = fakeEvent();
  win.fire('beforeinstallprompt', e);
  assert.equal(e.defaultPrevented, true);
});

test('⚠ taking the event spends it - a second consumer cannot prompt it again', () => {
  const win = fresh();
  win.fire('beforeinstallprompt', fakeEvent());

  assert.ok(takeInstallEvent(), 'the first taker gets it');
  assert.equal(takeInstallEvent(), null, 'the second gets nothing rather than a spent event');
  assert.equal(installOfferSnapshot().hasOffer, false, 'and it stops being offered');
});

test('taking the event notifies consumers, so the button stops claiming it can install', () => {
  const win = fresh();
  let notified = 0;
  subscribeToInstallOffer(() => { notified++; });
  win.fire('beforeinstallprompt', fakeEvent());
  assert.equal(notified, 1);

  takeInstallEvent();
  assert.equal(notified, 2, 'the affordance must swap back');
});

// ---------------------------------------------------------------- hiding, honestly

test('an installed app does not offer to install itself', () => {
  const win = fresh();
  win.fire('beforeinstallprompt', fakeEvent());
  win.fire('appinstalled');

  const snapshot = installOfferSnapshot();
  assert.equal(snapshot.installed, true);
  assert.equal(snapshot.hasOffer, false, 'the offer is spent by installing');
});

test('dismissing hides the offer without discarding it', () => {
  const win = fresh();
  win.fire('beforeinstallprompt', fakeEvent());
  markInstallOfferDismissed();

  const snapshot = installOfferSnapshot();
  assert.equal(snapshot.dismissed, true);
  assert.equal(snapshot.hasOffer, true, 'dismissal is the operator hiding a row, not Chrome withdrawing');
});

test('dismissal and installation notify, so every mounted consumer agrees', () => {
  fresh();
  let notified = 0;
  subscribeToInstallOffer(() => { notified++; });
  markInstallOfferDismissed();
  handleAppInstalled();
  assert.equal(notified, 2);
});

// ---------------------------------------------------------------- attaching once

test('⚠ init is idempotent - importing from two modules must not double-handle the event', () => {
  resetInstallOfferForTests();
  const win = fakeWindow();
  initInstallOffer(win);
  initInstallOffer(win);
  initInstallOffer(win);
  assert.equal(win.handlerCount('beforeinstallprompt'), 1);
});

test('an unsubscribed consumer stops being notified', () => {
  const win = fresh();
  let seen = 0;
  const unsubscribe = subscribeToInstallOffer(() => { seen++; });
  unsubscribe();
  win.fire('beforeinstallprompt', fakeEvent());
  assert.equal(seen, 0);
});

test('the store survives being driven directly, without a window at all', () => {
  resetInstallOfferForTests();
  handleBeforeInstallPrompt(fakeEvent());
  assert.equal(installOfferSnapshot().hasOffer, true);
});
