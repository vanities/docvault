// External Sources — manage git repositories of markdown that DocVault clones
// into the data dir and surfaces in the UI + Chat. Paste a repo URL, optionally
// a private-repo GitHub token, and click Sync.
//
// The GitHub token is write-only from the client's side: the server stores it
// encrypted and only ever reports a `tokenConfigured` boolean back — it never
// returns the token itself.

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  GitBranch,
  Key,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';

interface ExternalRepo {
  id: string;
  name: string;
  url: string;
  branch?: string;
  enabled: boolean;
  lastSyncedAt?: string;
  lastError?: string | null;
  fileCount?: number;
  commit?: string;
}

interface ExternalSourcesData {
  repos: ExternalRepo[];
  tokenConfigured: boolean;
}

function formatWhen(iso?: string): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  return d.toLocaleString();
}

function statusLine(repo: ExternalRepo): string {
  const parts = [`${repo.fileCount ?? 0} files`];
  if (repo.commit) parts.push(repo.commit);
  parts.push(`synced ${formatWhen(repo.lastSyncedAt)}`);
  return parts.join(' · ');
}

export function ExternalSourcesSection() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState<ExternalRepo[]>([]);
  const [tokenConfigured, setTokenConfigured] = useState(false);

  // GitHub token field
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [savingToken, setSavingToken] = useState(false);

  // Add-repo form
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [adding, setAdding] = useState(false);

  // Per-repo busy state (syncing/removing), keyed by id
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const res = await fetch(`${API_BASE}/external-sources`);
      const data: ExternalSourcesData = await res.json();
      setRepos(data.repos ?? []);
      setTokenConfigured(!!data.tokenConfigured);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return;
    setSavingToken(true);
    try {
      const res = await fetch(`${API_BASE}/external-sources/token`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      const data = await res.json();
      if (data.tokenConfigured) {
        addToast('GitHub token saved', 'success');
        setTokenInput('');
        setTokenConfigured(true);
      } else {
        addToast('Failed to save token', 'error');
      }
    } catch {
      addToast('Failed to save token', 'error');
    } finally {
      setSavingToken(false);
    }
  };

  const handleClearToken = async () => {
    setSavingToken(true);
    try {
      const res = await fetch(`${API_BASE}/external-sources/token`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: '' }),
      });
      const data = await res.json();
      if (!data.tokenConfigured) {
        addToast('GitHub token removed', 'success');
        setTokenConfigured(false);
      }
    } catch {
      addToast('Failed to remove token', 'error');
    } finally {
      setSavingToken(false);
    }
  };

  const handleSync = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`${API_BASE}/external-sources/${id}/sync`, { method: 'POST' });
      const repo: ExternalRepo = await res.json();
      setRepos((prev) => prev.map((r) => (r.id === id ? repo : r)));
      if (repo.lastError) {
        addToast(`Sync failed: ${repo.lastError}`, 'error');
      } else {
        addToast(`Synced ${repo.name} (${repo.fileCount ?? 0} files)`, 'success');
      }
    } catch {
      addToast('Sync failed', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleAdd = async () => {
    if (!newUrl.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`${API_BASE}/external-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: newUrl.trim(),
          name: newName.trim() || undefined,
          branch: newBranch.trim() || undefined,
        }),
      });
      if (res.ok) {
        const repo: ExternalRepo = await res.json();
        addToast(`Added ${repo.name}`, 'success');
        setNewUrl('');
        setNewName('');
        setNewBranch('');
        setRepos((prev) => [...prev, repo]);
        await handleSync(repo.id); // clone immediately
      } else {
        const err = await res.json().catch(() => ({}));
        addToast(err.error || 'Failed to add source', 'error');
      }
    } catch {
      addToast('Failed to add source', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`${API_BASE}/external-sources/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setRepos((prev) => prev.filter((r) => r.id !== id));
        addToast('Source removed', 'success');
      } else {
        addToast('Failed to remove source', 'error');
      }
    } catch {
      addToast('Failed to remove source', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <Card variant="glass" className="p-6 mb-8">
        <div className="text-center py-4 text-surface-600">Loading…</div>
      </Card>
    );
  }

  return (
    <Card variant="glass" className="p-6 mb-8">
      <h3 className="text-lg font-semibold text-surface-950 mb-1 flex items-center gap-2">
        <GitBranch className="w-5 h-5" />
        External Sources
      </h3>
      <p className="text-[12px] text-surface-600 mb-4">
        Clone git repositories of markdown into DocVault so the app and Chat can read them. Only
        markdown is indexed — large binaries the repo ignores are never downloaded.
      </p>

      <div className="space-y-6">
        {/* GitHub token — optional, only for private repos */}
        <div>
          <label className="flex items-center gap-2 text-[13px] font-medium text-surface-800 mb-2">
            <Key className="w-4 h-4" />
            GitHub Token
            <span className="font-normal text-surface-500">
              (optional — required for private repos)
            </span>
          </label>

          {tokenConfigured ? (
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <span className="flex-1 text-[13px] text-emerald-400 font-medium">Token set</span>
              <Button
                variant="ghost-danger"
                size="xs"
                onClick={handleClearToken}
                disabled={savingToken}
              >
                Remove
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Input
                  type={showToken ? 'text' : 'password'}
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="github_pat_… (fine-grained, read-only Contents)"
                  className="pr-10 text-[13px] font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-[11px] text-surface-600">
                Create a fine-grained token scoped to just the repo(s) you add, with read-only{' '}
                <code className="font-mono">Contents</code> permission. Stored encrypted; handed to
                git as an auth header and never written into a cloned repo.
              </p>
              {tokenInput && (
                <Button onClick={handleSaveToken} size="sm" disabled={savingToken}>
                  <Save className="w-4 h-4" />
                  {savingToken ? 'Saving…' : 'Save'}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Add a repository */}
        <div className="pt-2 border-t border-border/30">
          <label className="block text-[13px] font-medium text-surface-800 mb-2">
            Add a repository
          </label>
          <div className="space-y-2">
            <Input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://github.com/owner/repo.git"
              className="text-[13px] font-mono"
            />
            <div className="flex gap-2">
              <Input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Display name (optional)"
                className="text-[13px]"
              />
              <Input
                type="text"
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                placeholder="Branch (optional)"
                className="text-[13px] font-mono w-44"
              />
            </div>
            {newUrl.trim() && (
              <Button onClick={handleAdd} size="sm" disabled={adding}>
                <Plus className="w-4 h-4" />
                {adding ? 'Adding…' : 'Add & Sync'}
              </Button>
            )}
          </div>
        </div>

        {/* Configured sources */}
        {repos.length > 0 && (
          <div className="pt-2 border-t border-border/30 space-y-2">
            {repos.map((repo) => (
              <div
                key={repo.id}
                className="p-3 rounded-xl bg-surface-50/40 border border-border/30"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-surface-900 truncate">
                      {repo.name}
                    </div>
                    <div className="text-[11px] text-surface-500 font-mono truncate">
                      {repo.url}
                    </div>
                    <div className="text-[11px] text-surface-600 mt-1">
                      {repo.lastError ? (
                        <span className="inline-flex items-center gap-1 text-rose-400">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                          {repo.lastError}
                        </span>
                      ) : repo.lastSyncedAt ? (
                        <span>{statusLine(repo)}</span>
                      ) : (
                        <span className="text-surface-500">not synced yet</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => handleSync(repo.id)}
                      disabled={busyId === repo.id}
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${busyId === repo.id ? 'animate-spin' : ''}`}
                      />
                      Sync
                    </Button>
                    <Button
                      variant="ghost-danger"
                      size="icon-xs"
                      onClick={() => handleRemove(repo.id)}
                      disabled={busyId === repo.id}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
