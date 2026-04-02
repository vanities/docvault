import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Copy text to clipboard. Works over HTTP (Unraid) via execCommand fallback.
 *  Pass `container` when inside a Radix FocusScope (Dialog/Sheet) so the
 *  hidden textarea stays inside the focus trap and actually gets focused. */
export async function copyToClipboard(text: string, container?: Element): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Secure context API unavailable or failed — fall through to fallback
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    const root = container ?? document.body;
    root.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    root.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
