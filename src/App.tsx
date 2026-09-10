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
      alert('Login failed. Please check popup permissions and try again.');
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

