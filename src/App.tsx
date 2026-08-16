import { useState, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { auth } from './lib/firebase';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { AgencyProvider } from './lib/AgencyContext';
import { ThemeProvider } from './lib/ThemeContext';
import { Loader2 } from 'lucide-react';
import AppLayout from './components/AppLayout';
import LandingPage from './components/LandingPage';

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

