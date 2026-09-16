import React, { useState, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { auth } from './lib/firebase';
import {
  onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider,
  // ⚠ PUBLIC API, and the retry in handleLogin depends on it being public (AUDIT O86).
  updateCurrentUser,
} from 'firebase/auth';
import { AgencyProvider } from './lib/AgencyContext';
import { ThemeProvider } from './lib/ThemeContext';
import { Loader2 } from 'lucide-react';
import AppLayout from './components/AppLayout';
import LandingPage from './components/LandingPage';
import {
  TermsPage, PrivacyPage, RefundsPage, ShippingPage, ContactPage, PricingPage,
} from './components/legal/LegalPages';
import { InstallPage } from './components/legal/InstallPage';

/**
 * THE PUBLIC POLICY PAGES, RESOLVED BEFORE ANYTHING ELSE (AUDIT G41).
 *
 * ⚠ `BrowserRouter` USED TO LIVE INSIDE THE SIGNED-IN BRANCH BELOW. So when signed out there
 * was no router at all, and every URL rendered the landing page: `transregister.com/terms`
 * returned HTTP 200 and showed a marketing page with no terms on it. There was no MECHANISM for
 * a public policy URL, not merely no pages - which is why a payment processor's reviewer could
 * not have been sent to one.
 *
 * ⚠ MATCHED FROM `window.location.pathname` RATHER THAN THROUGH THE ROUTER, deliberately:
 *
 *   - It runs BEFORE the auth check, so a reviewer sees the document immediately instead of
 *     after a Firebase round-trip, and sees it identically whether or not they are signed in.
 *     A policy page that waits on authentication to decide what to render is a policy page that
 *     can fail to render.
 *   - It avoids nesting one <Routes> inside another. AppLayout has its own router with absolute
 *     paths; putting the app under a catch-all route makes those paths resolve relative to the
 *     parent match, which is a subtle breakage across twenty-two existing routes for no gain.
 *   - These are documents, not app screens. Navigation between them is plain `<a href>`, and a
 *     full page load is what a reviewer does anyway.
 */
const PUBLIC_PAGES: Record<string, React.ComponentType> = {
  '/terms': TermsPage,
  '/privacy': PrivacyPage,
  '/refunds': RefundsPage,
  '/shipping': ShippingPage,
  '/contact': ContactPage,
  '/pricing': PricingPage,
  /**
   * ⚠ NOT A POLICY, AND HERE FOR A DIFFERENT REASON (AUDIT G81). The six above are documents a payment reviewer
   * must reach. This one is instructions the owner sends to an agency BEFORE they have an account - which needs
   * exactly the same property: resolved from the path, before the auth check, identical signed in or out.
   */
  '/install': InstallPage,
};

function publicPageFor(pathname: string) {
  // Trailing slashes are normalised: a reviewer pasting `/terms/` must not meet the app.
  const key = pathname.replace(/\/+$/, '') || '/';
  return PUBLIC_PAGES[key] || null;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  /**
   * THE INDEXEDDB-CLOSED FAILURE, WHICH IS NOT A FirebaseError (AUDIT O85/O86/O87).
   *
   * `@firebase/auth` 1.13.4 throws a bare `new Error('Database is closing/hidden')` from
   * `IndexedDBLocalPersistence._openDb()` when `isHiding` is set - which happens on
   * `visibilitychange` to hidden, i.e. when the app-switch to Google's sign-in screen
   * backgrounds the page. It carries NO `code`, which is why every `auth/*` diagnosis was wrong.
   *
   * Matched on the message because there is nothing else to match on. Deliberately narrow: this
   * must never swallow a real auth failure.
   *
   * ⚠ THE REGEX IS UNANCHORED, AND THAT IS LOAD-BEARING. It matches "Database is closing" inside
   * "Database is closing/hidden" and never reaches the slash. Suspected of being the bug and
   * cleared by RUNNING IT against the literal string the tablet reported, not by reading it.
   */
  const isHiddenDbFailure = (err: unknown): boolean =>
    /database is (closing|closed|hidden)/i.test(String((err as any)?.message ?? ''));

  /**
   * WAIT ONCE FOR THE PAGE TO COME BACK TO THE FOREGROUND, WITH A CEILING (AUDIT O87).
   *
   * Resolves `true` the moment the page is visible - immediately if it already is - and `false`
   * if it has not returned within `ms`. Never rejects, never loops, and removes its own listener
   * and timer on both paths.
   *
   * ⚠ THIS EXISTS BECAUSE THE FIRST FIX *TESTED* visibilityState INSTEAD OF *WAITING* FOR IT.
   * The popup's result arrives before Chrome switches back, so the error is caught while the page
   * is STILL HIDDEN - and a guard requiring `visible` was false exactly when the retry was needed.
   * The tablet reported `retry: not attempted`, which is how that was found.
   */
  const waitForForeground = (ms: number): Promise<boolean> =>
    new Promise((resolve) => {
      if (document.visibilityState === 'visible') { resolve(true); return; }
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisible);
      };
      // Removed by hand rather than with `{ once: true }`: `visibilitychange` also fires for
      // hidden, and a spurious one must not consume the registration we are relying on.
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return;
        cleanup();
        resolve(true);
      };
      timer = setTimeout(() => { cleanup(); resolve(false); }, ms);
      document.addEventListener('visibilitychange', onVisible);
    });

  /**
   * THE FIVE LINES, IN ONE PLACE (AUDIT O87).
   *
   * ⚠ THERE ARE NOW *TWO* SURFACES THAT REPORT THEM - the failure alert and the in-memory
   * admission notice. A term added to one surface and not the other is a defect this audit has
   * already recorded twice in two commits, so there is ONE formatter and no second copy. The
   * `retry:` line in particular must read identically on both, or a report cannot be compared
   * against the previous one.
   */
  const diagnosticLines = (err: unknown, retry: string): string => {
    const e = err as any;
    return `code: ${e?.code ?? 'none'}\n`
      + `name: ${e?.name ?? 'none'}\n`
      + `message: ${e?.message ?? String(err)}\n`
      + `type: ${Object.prototype.toString.call(err)}\n`
      + `retry: ${retry}`;
  };

  const handleLogin = async () => {
    setIsAuthenticating(true);
    const provider = new GoogleAuthProvider();
    const FOREGROUND_WAIT_MS = 10000;
    // If this default ever reaches an alert it is itself a finding - every path below sets it.
    let retry = 'not attempted (reason not recorded)';
    try {
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        /**
         * ⚠ ONE RETRY, AND IT DOES *NOT* RETRY THE POPUP (AUDIT O86/O87).
         *
         * Retrying `signInWithPopup` is impossible: the user gesture is spent by the time the
         * first attempt rejects, so a second `window.open` is blocked by every mobile browser -
         * turning this fault into `auth/popup-blocked` and looking like a new bug.
         *
         * Authentication ALREADY SUCCEEDED. Only the persistence write failed:
         * `directlySetCurrentUser` sets `this.currentUser = user` and THEN awaits the IndexedDB
         * write, and `notifyAuthListeners()` sits after that await - so the write threw, no
         * listener ever fired, and `user` stayed null while the session existed in memory.
         *
         * So the retry re-runs the COMMIT, not the sign-in. `updateCurrentUser` is public API
         * and walks the same path, which by then has a visible page and a reopenable database.
         *
         * ⚠ IT FAILS SAFE. If a future SDK sets `currentUser` after the write instead of before,
         * this finds `null`, does nothing, and behaviour returns to exactly what it is today -
         * an alert - rather than a silent wrong result.
         *
         * ⚠ AND IT WORKS WITH THE SDK, NOT AROUND IT. `_withRetries` abandons its own retry loop
         * while hidden (`if (this.isHiding) throw e`) BEFORE exhausting its attempt count. That
         * is deliberate, so resuming once the page is visible picks up where the SDK stopped.
         *
         * ⚠ EVERY EXIT NAMES ITSELF. "not attempted" was reported for three different conditions
         * at once, which told us only that the guard was false - not which third of it. One round
         * of the investigation was spent on that, and the strings below are what it bought.
         */
        if (!isHiddenDbFailure(err)) {
          retry = 'not attempted (message did not match)';
          throw err;
        }
        const pending = auth.currentUser;
        if (!pending) {
          retry = 'not attempted (no session in memory)';
          throw err;
        }

        const wasVisible = document.visibilityState === 'visible';
        const startedWaiting = Date.now();
        const returned = await waitForForeground(FOREGROUND_WAIT_MS);
        const waited = Date.now() - startedWaiting;
        if (!returned) {
          retry = `not attempted (page still hidden after ${Math.round(FOREGROUND_WAIT_MS / 1000)}s)`;
          throw err;
        }

        /**
         * A beat for the SDK's own handler to have run. `onVisibilityChange` calls `onPageShow`
         * on `visible`, which clears `isHiding` - so the database is reopenable by the time this
         * retry fires.
         *
         * ⚠ THE LISTENER ORDER HERE IS A STATED INFERENCE, NOT A PROOF. Both listeners sit on
         * `document`/`visibilitychange`, so they fire in registration order, and the SDK's is
         * registered at persistence init - module load, before any of this. That should put ours
         * second. It is an inference about WHEN that init runs, and the design does not rest on
         * it: if the flag has not cleared, the retry throws and falls through to ADMISSION rather
         * than to an error. That is the only defensible way to depend on something uncertain.
         */
        await new Promise((resolve) => setTimeout(resolve, 250));

        try {
          await updateCurrentUser(auth, pending);
          retry = 'attempted, succeeded';
          console.warn('SSO: persistence write failed while hidden; committed on return.', err);
          // A FLOOR, NOT THE MECHANISM. `updateCurrentUser` runs `notifyAuthListeners()`, so
          // `onAuthStateChanged` sets this same object and React bails on Object.is equality.
          // It costs nothing, and it makes it impossible for a SUCCESSFUL commit to leave the
          // operator on the landing page - which is the exact failure this whole entry is about.
          setUser(auth.currentUser);
        } catch (retryErr) {
          /**
           * ⚠ THE TWO WAIT-VARIANTS ARE SEPARATE ON PURPOSE. "Failed while already visible" and
           * "failed after the page came back" point at different faults: the first at listener
           * ordering, the second at `isHiding` genuinely not clearing. Collapsing them would
           * cost another round.
           */
          retry = wasVisible
            ? 'attempted immediately, failed again'
            : `attempted after ${waited}ms wait, failed again`;

          /**
           * ⚠ A PERSISTENCE FAILURE IS NOT A LOGIN FAILURE (AUDIT O87).
           *
           * The SDK holds a valid `User`; only the write to disk failed. Showing "Login failed"
           * to someone who IS authenticated is the wrong report, so they go into the app on an
           * in-memory session instead.
           *
           * ⚠ WHAT MAKES THIS SAFE IS FIRESTORE, NOT THE AUTH READING. `firebase.ts` passes only
           * `experimentalForceLongPolling` - NO `persistentLocalCache` - so Firestore is
           * memory-cached and never touches the IndexedDB that is failing. Without that, admitting
           * them would get them past the login screen and break somewhere worse.
           *
           * The cost is real: closing the tab signs them out.
           *
           * ⚠ AND IT IS NO LONGER SAID TO THEM ON SCREEN. This path showed the five-line report
           * under "Signed in - the session could not be saved" while the fault was being
           * diagnosed, because it was the only channel that could say whether the retry had
           * fired. The tablet then signed in SILENTLY - the retry committed and this path never
           * ran - so the notice was retired to the console.
           *
           * ⚠ WHAT THAT COSTS, STATED PLAINLY: if this path ever runs again it is now INVISIBLE
           * from outside the browser console, which is not reachable on a tablet. A future
           * in-memory admission will look exactly like an ordinary sign-in. That is an accepted
           * trade, not an oversight - the failure alert below still carries all six reason
           * strings, so a retry that fails WITHOUT a user in hand is still reported loudly.
           */
          const stillHeld = auth.currentUser;
          if (!stillHeld) throw err;
          console.warn(
            'SSO: retry failed; admitted on an in-memory session. '
            + 'Closing the tab will sign this user out.\n'
            + diagnosticLines(err, retry),
            err,
            retryErr,
          );
          setUser(stillHeld);
        }
      }
    } catch (err) {
      console.error(err);
      /**
       * ⚠ REPORT WHAT THREW, IN FULL - THIS IS WHAT FOUND THE CAUSE (AUDIT O84/O85/O86/O87).
       *
       * This once said one sentence for every failure, so a blocked popup, a closed popup, a
       * cancelled double-tap, an unauthorized domain and a network timeout were
       * indistinguishable from outside the browser console - not reachable on Chrome for Android
       * without a cable. Reporting `code` alone then returned "unknown error", and THAT was the
       * finding: no `code` means not a FirebaseError, which excluded every `auth/*` cause at once
       * and sent the investigation to the persistence layer, where the real fault was.
       *
       * So all four fields stay. `name` separates TypeError from DOMException from FirebaseError,
       * `message` carries the text that names the fault, and the type tag catches a thrown
       * string, null or non-Error object. An error message that discards its own cause is a
       * defect on its own terms - permanent, not a diagnostic, nothing here to remove.
       *
       * ⚠ AND THE FIFTH LINE NAMES WHICH EXIT WAS TAKEN, not merely that one was. Six strings,
       * because the guard has three rejection conditions and the retry has three outcomes, and
       * reporting any two of them identically wastes the next attempt.
       */
      const e = err as any;
      console.error('SSO fail:', e?.code, e?.name, e?.message, e?.customData, err);
      alert(
        'Login failed.\n\n'
        + `${diagnosticLines(err, retry)}\n\n`
        + 'Send these five lines exactly as they appear.',
      );
    } finally {
      setIsAuthenticating(false);
    }
  };

  // ⚠ BEFORE THE LOADING GATE AND BEFORE THE AUTH BRANCH. A policy page must not depend on
  // authentication resolving, or on it resolving a particular way.
  const PublicPage = publicPageFor(window.location.pathname);
  if (PublicPage) return <PublicPage />;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!user) {
    return <LandingPage onLogin={handleLogin} isLoading={isAuthenticating} />;
  }

  return (
    <ThemeProvider>
      <AgencyProvider>
        <BrowserRouter>
          <AppLayout user={user} />
        </BrowserRouter>
      </AgencyProvider>
    </ThemeProvider>
  );
}

