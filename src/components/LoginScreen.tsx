import { useState, FormEvent } from 'react';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Loader2 } from 'lucide-react';

function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  const message = (err as { message?: string })?.message || String(err);

  switch (code) {
    case 'auth/unauthorized-domain':
      return 'This website domain is not authorized in Firebase. Add it under Authentication → Settings → Authorized domains (and Google Cloud OAuth origins).';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled. In Firebase Console → Authentication → Sign-in method, enable Google and/or Email/Password.';
    case 'auth/popup-blocked':
      return 'Popup was blocked by the browser. Allow popups, or use Email login below.';
    case 'auth/popup-closed-by-user':
      return 'Google popup closed before login finished. Try again, or use Email login.';
    case 'auth/cancelled-popup-request':
      return 'Another login popup was already open. Close it and try again.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Invalid email or password.';
    case 'auth/email-already-in-use':
      return 'This email already has an account. Use Sign in instead.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/network-request-failed':
      return 'Network error. Check internet connection and try again.';
    case 'auth/configuration-not-found':
      return 'Firebase Authentication is not set up for project tr-rep-agancy. Open Firebase Console → Authentication → Get started, then enable Email/Password and Google.';
    default:
      return code ? `${code}: ${message}` : message;
  }
}

export default function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const handleGoogle = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      // Popup often fails in embedded / preview hosts — try redirect
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request' ||
        code === 'auth/unauthorized-domain'
      ) {
        try {
          if (code === 'auth/unauthorized-domain') {
            setError(friendlyAuthError(err));
            setBusy(false);
            return;
          }
          setInfo('Popup failed — redirecting to Google sign-in…');
          await signInWithRedirect(auth, provider);
          return;
        } catch (err2) {
          setError(friendlyAuthError(err2));
        }
      } else {
        setError(friendlyAuthError(err));
      }
      setBusy(false);
    }
  };

  const handleEmail = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) {
          await updateProfile(cred.user, { displayName: name.trim() });
        }
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err) {
      setError(friendlyAuthError(err));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 px-4">
      <div className="max-w-md w-full p-8 bg-white/95 shadow-2xl rounded-2xl border border-white/20">
        <div className="w-14 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-5 text-xl font-bold tracking-tight">
          TR
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1 tracking-tight text-center">TR REP AGANCY</h1>
        <p className="text-slate-500 text-sm mb-6 text-center">Transformer Repair Agency Management</p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs leading-relaxed">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-xs">
            {info}
          </div>
        )}

        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          className="w-full bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
              <path fill="#EA4335" d="M12 10.2v3.6h5.1c-.2 1.2-1.5 3.6-5.1 3.6-3.1 0-5.6-2.5-5.6-5.6S8.9 6.2 12 6.2c1.8 0 2.9.7 3.6 1.4l2.5-2.4C16.7 3.8 14.6 3 12 3 7 3 3 7 3 12s4 9 9 9c5.2 0 8.6-3.6 8.6-8.7 0-.6-.1-1-.2-1.5H12z"/>
            </svg>
          )}
          Sign in with Google
        </button>

        <div className="flex items-center gap-3 my-5">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">or email</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
          {mode === 'signup' && (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name / agency contact"
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-slate-50"
            />
          )}
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-slate-50"
            autoComplete="email"
          />
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 6 chars)"
            className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-slate-50"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={6}
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'signin' ? 'Sign in with Email' : 'Create Account'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError('');
          }}
          className="mt-4 w-full text-center text-xs text-blue-700 hover:underline"
        >
          {mode === 'signin' ? 'New user? Create an account' : 'Already have an account? Sign in'}
        </button>

        <div className="mt-6 p-3 rounded-lg bg-slate-50 border border-slate-200 text-[10px] text-slate-600 leading-relaxed space-y-1">
          <p className="font-bold uppercase tracking-widest text-slate-500">If Google login fails</p>
          <ol className="list-decimal ml-4 space-y-1">
            <li>Open Firebase Console → project <strong>tr-rep-agancy</strong></li>
            <li>Authentication → Sign-in method → enable <strong>Google</strong> and <strong>Email/Password</strong></li>
            <li>Authentication → Settings → Authorized domains → add this site’s domain</li>
          </ol>
          <p className="pt-1">Use Email login above while Google domains are being configured.</p>
        </div>
      </div>
    </div>
  );
}
