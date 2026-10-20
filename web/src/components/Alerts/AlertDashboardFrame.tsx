import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertDashboardMessage, AlertSourceView } from '../../../server/alerts-types';
import { API_BASE } from '../../constants';

const MIN_HEIGHT = 160;
const MAX_HEIGHT = 6000;
const THEME_TOKENS = [
  'surface-50',
  'surface-100',
  'surface-200',
  'surface-300',
  'surface-600',
  'surface-700',
  'surface-800',
  'surface-950',
  'accent-400',
  'accent-500',
  'danger-400',
  'danger-500',
  'warn-400',
  'warn-500',
];

/** The app's live color tokens, so a dashboard file can match the page around it. */
function readTheme(): AlertDashboardMessage['theme'] {
  const style = getComputedStyle(document.documentElement);
  const colors: Record<string, string> = {};
  for (const token of THEME_TOKENS) {
    const value = style.getPropertyValue(`--color-${token}`).trim();
    if (value) colors[token] = value;
  }
  const bg = /^#([0-9a-f]{6})$/i.exec(colors['surface-50'] ?? '');
  const luminance = bg
    ? [0, 2, 4]
        .map((i) => parseInt(bg[1].slice(i, i + 2), 16) / 255)
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
    : 0;
  return { mode: luminance > 0.5 ? 'light' : 'dark', colors };
}

/**
 * A source's own dashboard file (DATA_DIR/alerts/<id>/dashboard.html). The frame
 * is sandboxed without allow-same-origin, so the file can run scripts but can't
 * reach DocVault's API or session; it only sees what is posted to it here.
 */
export function AlertDashboardFrame({ source }: { source: AlertSourceView }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(source);
  const [height, setHeight] = useState(480);

  useEffect(() => {
    latest.current = source;
  }, [source]);

  const post = useCallback(() => {
    const target = frame.current?.contentWindow;
    if (!target) return;
    const message: AlertDashboardMessage = {
      type: 'docvault:alert',
      version: 1,
      source: latest.current,
      theme: readTheme(),
    };
    // The sandboxed frame's origin is opaque ("null"); '*' is the only target that reaches it.
    target.postMessage(message, '*');
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (data?.type === 'docvault:alert:ready') post();
      else if (
        data?.type === 'docvault:alert:height' &&
        typeof data.height === 'number' &&
        Number.isFinite(data.height)
      ) {
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(data.height))));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post]);

  // Every poll hands the page fresh data without reloading it.
  useEffect(() => {
    post();
  }, [source, post]);

  return (
    <iframe
      ref={frame}
      title={`${source.label} dashboard`}
      src={`${API_BASE}/alerts/sources/${encodeURIComponent(source.id)}/dashboard`}
      sandbox="allow-scripts"
      onLoad={post}
      className="w-full rounded-xl border border-border/40 bg-surface-50"
      style={{ height }}
    />
  );
}
