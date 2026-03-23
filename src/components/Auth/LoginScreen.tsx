import { useState } from 'react';
import { Lock, AlertCircle } from 'lucide-react';

interface LoginScreenProps {
  onLogin: () => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (res.ok) {
        onLogin();
      } else {
        setError('Invalid username or password');
      }
    } catch {
      setError('Cannot connect to server');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="noise min-h-screen bg-surface-0 flex items-center justify-center px-4">
      <div className="glass-card rounded-2xl p-8 max-w-sm w-full animate-scale-in">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="p-4 bg-accent-500/10 rounded-2xl w-fit mx-auto mb-4">
            <Lock className="w-8 h-8 text-accent-400" />
          </div>
          <h1 className="font-display text-2xl text-surface-950 italic">DocVault</h1>
          <p className="text-sm text-surface-600 mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-400/30 focus:border-accent-400"
            />
          </div>

          <div>
            <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full px-3 py-2.5 bg-surface-100 border border-border rounded-lg text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-400/30 focus:border-accent-400"
            />
          </div>

          {error && (
            <p className="text-sm text-danger-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !username.trim() || !password}
            className="w-full py-3 bg-accent-500 text-white font-medium rounded-xl hover:bg-accent-400 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
