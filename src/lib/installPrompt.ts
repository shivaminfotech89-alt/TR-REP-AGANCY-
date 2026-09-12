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

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      // Suppress Chrome's own UI so there is one offer, in one place, rather than two.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return null;
    deferred.prompt();
    let outcome: 'accepted' | 'dismissed' | null = null;
    try {
      outcome = (await deferred.userChoice).outcome;
    } catch {
      outcome = null;
    }
    // ⚠ SPENT EITHER WAY. Accepted or dismissed, this event cannot be prompted again; the row hides until Chrome
    // fires a fresh one, which is the honest behaviour rather than a button that stops working.
    setDeferred(null);
    return outcome;
  }, [deferred]);

  const dismissInstall = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Dismissal not persisting is a smaller fault than refusing to dismiss.
    }
  }, []);

  return {
    canInstall: !!deferred && !dismissed && !installed,
    promptInstall,
    dismissInstall,
    installed,
  };
}
