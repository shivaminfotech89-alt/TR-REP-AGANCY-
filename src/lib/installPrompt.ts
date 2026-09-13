/**
 * THE INSTALL OFFER, AND WHY IT IS NOT A BOOLEAN (AUDIT G80).
 *
 * Chrome fires `beforeinstallprompt` when a site meets the install criteria. Catching it lets the app show its own
 * affordance instead of relying on the address-bar icon, which is real and almost never noticed.
 *
 * ⚠ THE EVENT IS THE PERMISSION, NOT A FLAG. `prompt()` can be called ONCE per event, and only from inside a user
 * gesture. So the event object itself has to be held: a "remind me later" that re-prompted from a stored boolean
 * would find a spent event and a button that does nothing, which is the G24 shape - a control that accepts a click
 * and silently achieves nothing.
 *
 * ⚠ AND AN INSTALLED APP MUST NEVER OFFER TO INSTALL ITSELF. `display-mode: standalone` matches inside the
 * installed window, and `appinstalled` fires the moment it succeeds; both hide the affordance.
 *
 * ⚠ NO SERVICE WORKER IS REGISTERED ANYWHERE IN THIS APP, DELIBERATELY, AND THIS FILE MUST NOT ADD ONE.
 * Installability does not require one (MDN: name/short_name, icons with 192 and 512, start_url, display,
 * prefer_related_applications absent). A service worker would let an INSTALLED window serve a cached bundle, and
 * this app deploys often against rate data that is corrected in place - a cached estimate builder would price from
 * yesterday's masters with nothing on screen saying so, and the person affected could not tell. If one is ever
 * added it must be network-first with no precache. See G80.
 *
 * ⚠ THE EVENT LIVES OUTSIDE REACT, AND MUST (AUDIT G82).
 *
 * It used to live in the hook's own `useState`, which was correct while there was exactly one consumer. There are
 * now two - the sidebar row in `AppLayout` and the install button on `LandingPage` - and they are on OPPOSITE
 * SIDES OF THE SIGN-IN BOUNDARY. `beforeinstallprompt` fires ONCE per page load, and signing in is
 * `signInWithPopup`: no reload. So a per-component copy meant the landing page captured the only offer there will
 * be, then unmounted at sign-in and took it with it, leaving the sidebar row showing "How to install this app"
 * seconds after Chrome had handed us an offer. **That failure is invisible unless you sign in without reloading,
 * which is what every real visitor does.**
 *
 * Module scope fixes it for the structural reason rather than by coordination: there is ONE offer because the
 * browser gives one, so there is one place holding it and components subscribe. It also attaches the listener at
 * IMPORT time rather than at first mount, which is strictly earlier - an event that arrives before React has
 * mounted anything is no longer missed.
 */

import { useCallback, useEffect, useState } from 'react';

/** Chrome's event. Not in lib.dom, so it is described here rather than cast away at the use site. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISSED_KEY = 'installOfferDismissed';

/** True when this window IS the installed app - it must not offer to install itself. */
export function isStandalone(): boolean {
  try {
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true
      || (window.navigator as any).standalone === true;
  } catch {
    return false;
  }
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // A browser refusing storage is not a reason to nag - see AUDIT G70 on reads that fail.
    return false;
  }
}

// ----------------------------------------------------------------- the one offer

let deferredEvent: BeforeInstallPromptEvent | null = null;
let installedNow = false;
let dismissedNow = false;
let attached = false;

/** Mounted consumers. A Set because the same component may resubscribe across a remount. */
const listeners = new Set<() => void>();

function emit(): void {
  // Copied before iterating: a listener that unsubscribes while being notified is legal.
  for (const listener of Array.from(listeners)) listener();
}

/** Subscribe to changes in the offer. Returns the unsubscribe, for `useEffect` cleanup. */
export function subscribeToInstallOffer(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** What every consumer currently sees. One source, so two consumers cannot disagree. */
export function installOfferSnapshot(): {
  hasOffer: boolean;
  installed: boolean;
  dismissed: boolean;
} {
  return { hasOffer: !!deferredEvent, installed: installedNow, dismissed: dismissedNow };
}

export function handleBeforeInstallPrompt(e: Event): void {
  // Suppress Chrome's own UI so there is one offer, in one place, rather than two.
  (e as any)?.preventDefault?.();
  deferredEvent = e as BeforeInstallPromptEvent;
  emit();
}

export function handleAppInstalled(): void {
  installedNow = true;
  deferredEvent = null;
  emit();
}

export function markInstallOfferDismissed(): void {
  dismissedNow = true;
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Dismissal not persisting is a smaller fault than refusing to dismiss.
  }
  emit();
}

/**
 * Hand the event to a caller that is about to `prompt()` it, and clear it here in the same step.
 *
 * ⚠ SPENT ON TAKING, NOT ON OUTCOME. The event cannot be prompted twice, so it must stop being offered the moment
 * one consumer commits to using it - otherwise a second consumer could prompt a spent event and achieve nothing.
 */
export function takeInstallEvent(): BeforeInstallPromptEvent | null {
  const event = deferredEvent;
  if (!event) return null;
  deferredEvent = null;
  emit();
  return event;
}

/**
 * Attach the window listeners. Idempotent, and called at import below for the real window; tests pass a fake.
 */
export function initInstallOffer(win?: any): void {
  if (attached) return;
  const target = win ?? (typeof window !== 'undefined' ? window : undefined);
  if (!target?.addEventListener) return;
  attached = true;
  if (!win) {
    dismissedNow = wasDismissed();
    installedNow = isStandalone();
  }
  target.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  target.addEventListener('appinstalled', handleAppInstalled);
}

/** Test-only. The module holds process-wide state, so each test starts from a known one. */
export function resetInstallOfferForTests(): void {
  deferredEvent = null;
  installedNow = false;
  dismissedNow = false;
  attached = false;
  listeners.clear();
}

if (typeof window !== 'undefined') initInstallOffer();

// ----------------------------------------------------------------- the consumers

export function useInstallPrompt() {
  // The store is the state; this only re-renders the component when the store says something changed.
  const [, bump] = useState(0);
  useEffect(() => subscribeToInstallOffer(() => bump(n => n + 1)), []);

  const snapshot = installOfferSnapshot();

  const promptInstall = useCallback(async () => {
    const event = takeInstallEvent();
    if (!event) return null;
    event.prompt();
    let outcome: 'accepted' | 'dismissed' | null = null;
    try {
      outcome = (await event.userChoice).outcome;
    } catch {
      outcome = null;
    }
    return outcome;
  }, []);

  const dismissInstall = useCallback(() => { markInstallOfferDismissed(); }, []);

  return {
    /** Chrome has an offer in hand and it can be relayed with one click. Chromium only. */
    canInstall: snapshot.hasOffer && !snapshot.dismissed && !snapshot.installed,
    /**
     * ⚠ WHETHER THE ROW SHOULD BE HIDDEN ALTOGETHER - A DIFFERENT QUESTION FROM `canInstall` (AUDIT G81).
     *
     * These were one value while the row existed only to relay Chrome's offer. They are not the same question:
     * the row now ALWAYS appears, offering one-click install where Chrome has offered and a link to /install
     * where it has not, so "there is no offer" must not hide it - that is exactly the Safari case, where there
     * will never be an offer and the instructions are the whole point.
     *
     * It hides for two honest reasons only: the operator dismissed it, or this window IS the installed app.
     */
    installOfferHidden: snapshot.dismissed || snapshot.installed,
    promptInstall,
    dismissInstall,
    installed: snapshot.installed,
  };
}
