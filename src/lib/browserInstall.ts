/**
 * WHICH BROWSER IS THIS, AND HOW DOES IT INSTALL (AUDIT G81).
 *
 * Installing a web app is done differently by every browser, and two of them cannot do it at all without help. So
 * the instructions page shows EVERY route and merely puts the likely one first.
 *
 * ⚠ SNIFFING ORDERS THE SECTIONS. IT NEVER HIDES ONE. A user-agent guess is wrong often enough that hiding on it
 * would cost someone the answer - a Safari user shown Chrome's steps and nothing else has been told the app cannot
 * be installed, which is false. Ordering wrongly costs a scroll. That is the failure mode to choose, and
 * `orderSections` is asserted to return a permutation of the full list rather than a subset.
 *
 * ⚠ THE APP CANNOT RAISE ITS OWN INSTALL PROMPT, on any browser. Chrome decides when `beforeinstallprompt` fires
 * (installability plus a user-engagement heuristic), the page cannot trigger it, and `prompt()` works once, from a
 * real click. Everything here is instructions; the only one-click path is relaying an offer Chrome has already
 * made - see lib/installPrompt.ts.
 */

export type InstallSection = 'chrome' | 'edge' | 'safari-ios' | 'safari-macos' | 'firefox';

/** Every route, in the order they are shown when nothing is known about the browser. */
export const INSTALL_SECTIONS: readonly InstallSection[] = [
  'chrome', 'edge', 'safari-ios', 'safari-macos', 'firefox',
] as const;

export interface BrowserGuess {
  /** The section to show first. `null` when the guess is too weak to order by. */
  section: InstallSection | null;
  /** What to call it on screen. Never used to decide anything. */
  label: string;
  /** True when this browser can install at all, natively. Firefox cannot. */
  canInstall: boolean;
}

export interface Environment {
  userAgent?: string;
  /** iPadOS 13+ reports a Mac user agent; touch points are what tell them apart. */
  maxTouchPoints?: number;
}

/**
 * ⚠ ORDER MATTERS IN THE TESTS BELOW, not only in the code. Edge's user agent contains "Chrome", Chrome's contains
 * "Safari", and iPadOS's contains "Macintosh" - so every check has to exclude the ones that impersonate it, and the
 * sequence is the mechanism rather than a style choice.
 */
export function guessBrowser(env: Environment = {}): BrowserGuess {
  const ua = String(env.userAgent || '');
  const touch = Number(env.maxTouchPoints || 0);

  if (!ua) return { section: null, label: 'your browser', canInstall: false };

  // Edge first: its UA also says "Chrome".
  if (/\bEdg(?:e|A|iOS)?\//.test(ua)) {
    return { section: 'edge', label: 'Microsoft Edge', canInstall: true };
  }

  // Firefox, including its iOS build, which cannot install either.
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) {
    return { section: 'firefox', label: 'Firefox', canInstall: false };
  }

  // ⚠ iPad BEFORE macOS. iPadOS 13+ sends a Macintosh UA; a Mac with a touch bar reports 0 touch points and a real
  // iPad reports 5, so touch is the only reliable separator.
  const isIpadPretendingToBeMac = /Macintosh/.test(ua) && touch > 1;
  if (/\b(iPhone|iPod|iPad)\b/.test(ua) || isIpadPretendingToBeMac) {
    // Every iOS browser is Safari's engine and installs the same way, through Share.
    return { section: 'safari-ios', label: 'Safari on iPhone or iPad', canInstall: true };
  }

  // Chrome and the Chromium family, excluding the ones handled above.
  if (/\bChrome\/|\bChromium\/|\bCriOS\//.test(ua)) {
    return { section: 'chrome', label: 'Google Chrome', canInstall: true };
  }

  // Safari last: its UA is what remains once everything claiming "Safari" has been excluded.
  if (/\bSafari\//.test(ua)) {
    return { section: 'safari-macos', label: 'Safari on Mac', canInstall: true };
  }

  return { section: null, label: 'your browser', canInstall: false };
}

/**
 * The likely section first, then the rest in their canonical order.
 *
 * ⚠ ALWAYS A PERMUTATION OF `INSTALL_SECTIONS` - never a filter. See the header.
 */
export function orderSections(guess: BrowserGuess): InstallSection[] {
  const rest = INSTALL_SECTIONS.filter(s => s !== guess.section);
  return guess.section ? [guess.section, ...rest] : [...rest];
}

/** Read the real environment. Kept separate so every decision above is testable without a browser. */
export function currentEnvironment(): Environment {
  if (typeof navigator === 'undefined') return {};
  return { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints };
}
