import React, { useState, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { auth } from './lib/firebase';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
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

  const handleLogin = async () => {
    setIsAuthenticating(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
      /**
       * ⚠ THE CODE IS THE ONLY FACT WORTH HAVING, AND THIS THREW IT AWAY (AUDIT O84).
       *
       * Every sign-in failure produced the same sentence, so a blocked popup, a closed popup,
       * a cancelled double-tap, an unauthorized domain and a network timeout were
       * indistinguishable from outside the browser console - which is not reachable on Chrome
       * for Android without a cable and USB debugging.
       *
       * That cost an afternoon on a live customer failure: the code separates remedies that are
       * OPPOSITE. `popup-blocked` / `popup-closed-by-user` mean the popup never survives and the
       * answer is `signInWithRedirect`; `network-request-failed` is the cross-origin
       * `__/auth/iframe` timing out, where redirect does not help and a same-origin `authDomain`
       * does. Picking either without the code is a guess.
       *
       * ⚠ NOT A DIAGNOSTIC AND NOT GATED. An error message that discards its own cause is a
       * defect on its own terms, so this is permanent - there is nothing here to remove once
       * this particular investigation closes.
       *
       * `(err as any)` because a catch binding is not typed, and the shape of a thrown value is
       * not guaranteed to carry `code` at all.
       */
      /**
       * ⚠ THE CODE CAME BACK EMPTY, WHICH IS ITSELF THE FINDING (AUDIT O85).
       *
       * The previous revision reported `err.code` and the tablet showed "unknown error" - so the
       * thrown value carries NO `code`, and therefore is NOT a FirebaseError. That EXCLUDES every
       * `auth/*` cause at once: popup-blocked, popup-closed-by-user, cancelled-popup-request,
       * network-request-failed and unauthorized-domain all arrive as FirebaseError with a code.
       *
       * So the question is no longer "which auth failure" but "what else is throwing", and a
       * single field cannot answer it. `name` separates TypeError from DOMException from
       * FirebaseError; `message` carries the text that names a failed module fetch or a blocked
       * API; the type tag catches a thrown string, null, or a non-Error object.
       */
      const e = err as any;
      console.error('SSO fail:', e?.code, e?.name, e?.message, e?.customData, err);
      alert(
        'Login failed.\n\n'
        + `code: ${e?.code ?? 'none'}\n`
        + `name: ${e?.name ?? 'none'}\n`
        + `message: ${e?.message ?? String(err)}\n`
        + `type: ${Object.prototype.toString.call(err)}\n\n`
        + 'Send these four lines exactly as they appear.',
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

