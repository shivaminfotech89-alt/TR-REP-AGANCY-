import { useState, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { auth } from './lib/firebase';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { AgencyProvider } from './lib/AgencyContext';
import { Loader2 } from 'lucide-react';
import AppLayout from './components/AppLayout';
import Logo from './components/Logo';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
      alert('Login failed');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <div className="max-w-md w-full p-8 bg-white shadow-lg rounded-xl border border-gray-100 text-center">
          <div className="flex justify-center mb-6">
            <Logo
              variant="light"
              showWordmark={false}
              markClassName="w-16 h-16"
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">TR Rep Agency</h1>
          <p className="text-gray-500 mb-8">Transformer Repair Management System</p>
          <button
            onClick={handleLogin}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <AgencyProvider>
      <BrowserRouter>
        <AppLayout user={user} />
      </BrowserRouter>
    </AgencyProvider>
  );
}
