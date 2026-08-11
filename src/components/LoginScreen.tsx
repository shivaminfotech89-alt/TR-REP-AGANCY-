import { useState, useEffect, FormEvent } from 'react';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Loader2, Copy, Check, ExternalLink } from 'lucide-react';

const FIREBASE_AUTH_SETTINGS =
  'https://console.firebase.google.com/project/tr-rep-agancy/authentication/settings';
const FIREBASE_SIGNIN_METHODS =
  'https://console.firebase.google.com/project/tr-rep-agancy/authentication/providers';

function friendlyAuthError(err: unknown, hostname: string): string {
  const code = (err as { code?: string })?.code || '';
  const message = (err as { message?: string })?.message || String(err);

  switch (code) {
    case 'auth/unauthorized-domain':
      return `auth/unauthorized-domain — Add this domain in Firebase Authorized domains: ${hostname}`;
    case 'auth/operation-not-allowed':
      return 'Sign-in method not enabled. Enable Google and Email/Password in Firebase Authentication → Sign-in method.';
    case 'auth/popup-blocked':
      return 'Popup blocked. Allow popups for this site, or use Email login.';
    case 'auth/popup-closed-by-user':
      return 'Google popup was closed. Try again, or use Email login.';
    case 'auth/cancelled-popup-request':
      return 'Another login popup was already open. Close it and retry.';
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
      return 'Network error. Check internet and try again.';
    case 'auth/configuration-not-found':
      return 'Authentication not started for tr-rep-agancy. Open Firebase Console → Authentication → Get started.';
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
  const [errorCode, setErrorCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [hostname, setHostname] = useState('');

  useEffect(() => {
    setHostname(window.location.hostname || '');
  }, []);

  const copyDomain = async () => {
    if (!hostname) return;
    try {
      await navigator.clipboard.writeText(hostname);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      window.prompt('Copy this domain:', hostname);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    setError('');
    setErrorCode('');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      setErrorCode(code);
      setError(friendlyAuthError(err, hostname));
      setBusy(false);
    }
  };

  const handleEmail = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrorCode('');
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
      const code = (err as { code?: string })?.code || '';
      setErrorCode(code);
      setError(friendlyAuthError(err, hostname));
      setBusy(false);
    }
  };

  const showDomainFix = errorCode === 'auth/unauthorized-domain' || !errorCode;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 px-4 py-8">
      <div className="max-w-md w-full p-8 bg-white/95 shadow-2xl rounded-2xl border border-white/20">
        <div className="w-14 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-5 text-xl font-bold tracking-tight">
          TR
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1 tracking-tight text-center">TR REP AGANCY</h1>
        <p className="text-slate-500 text-sm mb-6 text-center">Transformer Repair Agency Management</p>

        {/* Always show domain banner — this is the #1 blocker */}
        <div className="mb-5 p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-2">
          <p className="font-bold uppercase tracking-widest text-[10px]">Required: authorize this domain</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-sm bg-white border border-amber-200 rounded px-2 py-1.5 break-all">
              {hostname || '…'}
            </code>
            <button
              type="button"
              onClick={copyDomain}
              className="shrink-0 px-2 py-1.5 rounded bg-amber-900 text-white text-[10px] font-bold uppercase flex items-center gap-1"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ol className="list-decimal ml-4 space-y-1 leading-relaxed">
            <li>
              Open{' '}
              <a className="underline font-semibold" href={FIREBASE_AUTH_SETTINGS} target="_blank" rel="noreferrer">
                Firebase Auth Settings
              </a>
            </li>
            <li>Scroll to <strong>Authorized domains</strong> → <strong>Add domain</strong></li>
            <li>Paste the domain above (no https://) → Save</li>
            <li>
              Also enable providers in{' '}
              <a className="underline font-semibold" href={FIREBASE_SIGNIN_METHODS} target="_blank" rel="noreferrer">
                Sign-in method
              </a>
              : Google + Email/Password
            </li>
            <li>Wait ~1 minute, refresh this page, try login again</li>
          </ol>
          <a
            href={FIREBASE_AUTH_SETTINGS}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 mt-1 px-3 py-2 rounded bg-amber-900 text-white text-[10px] font-bold uppercase"
          >
            Open Firebase Console <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs leading-relaxed">
            {error}
            {errorCode === 'auth/unauthorized-domain' && (
              <p className="mt-2 font-semibold">Login cannot work until the domain above is added.</p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          className="w-full bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#EA4335"
                d="M12 10.2v3.6h5.1c-.2 1.2-1.5 3.6-5.1 3.6-3.1 0-5.6-2.5-5.6-5.6S8.9 6.2 12 6.2c1.8 0 2.9.7 3.6 1.4l2.5-2.4C16.7 3.8 14.6 3 12 3 7 3 3 7 3 12s4 9 9 9c5.2 0 8.6-3.6 8.6-8.7 0-.6-.1-1-.2-1.5H12z"
              />
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
            setErrorCode('');
          }}
          className="mt-4 w-full text-center text-xs text-blue-700 hover:underline"
        >
          {mode === 'signin' ? 'New user? Create an account' : 'Already have an account? Sign in'}
        </button>

        {showDomainFix && (
          <p className="mt-4 text-[10px] text-slate-500 text-center leading-relaxed">
            Project: <strong>tr-rep-agancy</strong> · Domain must match exactly (no https://, no path).
          </p>
        )}
      </div>
    </div>
  );
}
