'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Copy this page's own address.
 *
 * The link is read from `window.location`, with the query string dropped:
 * `?new=1` only switches on the first-visit banner and has no business in a
 * link the visitor keeps.
 *
 * Falls back to selecting the text when the Clipboard API is unavailable
 * (older browsers, or a page not served over HTTPS), so the visitor can still
 * copy it by hand.
 */
export function CopyLinkButton() {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [manualLink, setManualLink] = useState('');

  async function copy() {
    const link = `${window.location.origin}${window.location.pathname}`;
    try {
      await navigator.clipboard.writeText(link);
      setState('copied');
    } catch {
      setManualLink(link);
      setState('manual');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" onClick={copy}>
        {state === 'copied' ? 'Link copied' : 'Copy link'}
      </Button>

      {/* Announced to screen readers without moving focus. */}
      <p aria-live="polite" className="text-xs text-muted">
        {state === 'copied' ? 'Paste it somewhere you will find it again.' : ''}
      </p>

      {state === 'manual' ? (
        <label className="flex flex-col gap-1 text-xs text-muted">
          Copy this link:
          <input
            readOnly
            value={manualLink}
            onFocus={(event) => event.currentTarget.select()}
            className="rounded-md border border-[var(--line-soft)] bg-[var(--surface-inset)] px-2 py-1.5 font-mono text-xs text-[var(--text-strong)]"
          />
        </label>
      ) : null}
    </div>
  );
}
