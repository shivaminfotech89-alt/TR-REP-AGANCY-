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
   * THE INDEXEDDB-CLOSED FAILURE, WHICH IS NOT A FirebaseError (AUDIT O85/O86).
   *
   * `@firebase/auth` 1.13.4 throws a bare `new Error('Database is closing/hidden')` from
   * `IndexedDBLocalPersistence._openDb()` when `isHiding` is set - which happens on
   * `visibilitychange` to hidden, i.e. when the app-switch to Google's sign-in screen
   * backgrounds the page. It carries NO `code`, which is why every `auth/*` diagnosis was wrong.
   *
   * Matched on the message because there is nothing else to match on. Deliberately narrow: this
   * must never swallow a real auth failure.
   */
  const isHiddenDbFailure = (err: unknown): boolean =>
    /database is (closing|closed|hidden)/i.test(String((err as any)?.message ?? ''));

  const handleLogin = async () => {
    setIsAuthenticating(true);
    const provider = new GoogleAuthProvider();
    let retried = false;
    try {
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        /**
         * ⚠ ONE RETRY, AND IT DOES *NOT* RETRY THE POPUP (AUDIT O86).
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
         * and walks the same path, which by now has a visible page and a reopenable database.
         *
         * ⚠ IT FAILS SAFE. If a future SDK sets `currentUser` after the write instead of before,
         * this finds `null`, does nothing, and behaviour returns to exactly what it is today -
         * an alert - rather than a silent wrong result.
         *
         * ⚠ AND IT WORKS WITH THE SDK, NOT AROUND IT. `_withRetries` abandons its own retry loop
         * while hidden (`if (this.isHiding) throw e`) BEFORE exhausting its retry count. That is
         * a deliberate choice, not an oversight, so resuming once the page is visible is picking
         * up precisely where the SDK stopped.
         */
        if (!isHiddenDbFailure(err) || document.visibilityState !== 'visible') throw err;
        const pending = auth.currentUser;
        if (!pending) throw err;

        retried = true;
        console.warn('SSO: persistence write failed while hidden; committing once now.', err);
        // A beat for the SDK's own `onPageShow` to clear `isHiding`. If it has not run yet the
        // retry throws the same error and falls through to the alert - one retry, never a loop.
        await new Promise((resolve) => setTimeout(resolve, 250));
        await updateCurrentUser(auth, pending);
      }
    } catch (err) {
      console.error(err);
      /**
       * ⚠ REPORT WHAT THREW, IN FULL - THIS IS WHAT FOUND THE CAUSE (AUDIT O84/O85/O86).
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
       * ⚠ AND IT SAYS WHETHER THE RETRY RAN. A failed retry and a failure that never qualified
       * for one are different findings: the first means `isHiding` had not cleared in time, the
       * second means the guard rejected it. Reporting them identically would waste the next
       * attempt.
       *
       * `(err as any)` because a catch binding is not typed, and a thrown value is not guaranteed
       * to carry `code` at all.
       */
      const e = err as any;
      console.error('SSO fail:', e?.code, e?.name, e?.message, e?.customData, err);
      alert(
        'Login failed.\n\n'
        + `code: ${e?.code ?? 'none'}\n`
        + `name: ${e?.name ?? 'none'}\n`
        + `message: ${e?.message ?? String(err)}\n`
        + `type: ${Object.prototype.toString.call(err)}\n`
        + `retry: ${retried ? 'attempted and failed' : 'not attempted'}\n\n`
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

