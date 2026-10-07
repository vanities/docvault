import { useState } from 'react';
import { Lock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
      <Card variant="glass" className="rounded-2xl p-8 max-w-sm w-full animate-scale-in">
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
            <Label className="mb-1">Username</Label>
            <Input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div>
            <Label className="mb-1">Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-danger-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            disabled={submitting || !username.trim() || !password}
            className="w-full"
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
