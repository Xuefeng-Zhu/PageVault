'use client';

// Share button for the change detail page (US-013).
//
// Renders a "Share" button that POSTs to /api/changes/[changeId]/share
// and shows a copy-to-clipboard dialog with the resulting public URL.
// The dialog has a single Revoke button that DELETEs every outstanding
// share link for this change (one revoke = all tokens for this change
// are killed, so the user doesn't have to track which link went where).

import { useState } from 'react';
import { Link2, Copy, Check, X, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { showToast } from '@/components/ui/Toast';

interface ShareButtonProps {
  changeId: string;
}

type DialogState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; url: string; token: string }
  | { kind: 'error'; message: string };

export function ShareButton({ changeId }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DialogState>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    setState({ kind: 'loading' });
    try {
      const res = await fetch(`/api/changes/${changeId}/share`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message =
          res.status === 401
            ? 'You need to sign in to share a change.'
            : res.status === 404
            ? 'Change not found.'
            : body?.error?.message ?? 'Failed to create share link.';
        setState({ kind: 'error', message });
        return;
      }
      const json = (await res.json()) as { token: string; url: string };
      setState({ kind: 'ready', url: json.url, token: json.token });
    } catch (err) {
      console.error('Share error:', err);
      setState({ kind: 'error', message: 'Network error — please try again.' });
    }
  }

  async function handleCopy() {
    if (state.kind !== 'ready') return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
      showToast('Share link copied to clipboard', { type: 'success' });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy error:', err);
      showToast('Could not copy — please copy manually.', { type: 'error' });
    }
  }

  async function handleRevoke() {
    try {
      const res = await fetch(`/api/changes/${changeId}/share`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(body?.error?.message ?? 'Failed to revoke share link.', { type: 'error' });
        return;
      }
      showToast('Share link revoked', { type: 'success' });
      setOpen(false);
      setState({ kind: 'idle' });
    } catch (err) {
      console.error('Revoke error:', err);
      showToast('Network error — please try again.', { type: 'error' });
    }
  }

  function handleOpen() {
    setOpen(true);
    if (state.kind === 'idle') {
      void handleCreate();
    }
  }

  function handleClose() {
    setOpen(false);
    setCopied(false);
  }

  return (
    <>
      <Button
        variant="secondary"
        icon={<Link2 className="w-4 h-4" />}
        onClick={handleOpen}
      >
        Share
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-sm p-4"
          onClick={handleClose}
        >
          <div
            className="bg-paper border border-rule max-w-lg w-full p-6 space-y-5 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleClose}
              className="absolute top-3 right-3 text-ink-3 hover:text-ink transition-colors"
              aria-label="Close share dialog"
            >
              <X className="w-4 h-4" />
            </button>

            <div>
              <p className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                Public read-only view
              </p>
              <h3 className="font-display text-display-md text-ink mt-1">
                Share this change
              </h3>
              <p className="font-body text-body-sm text-ink-2 mt-2">
                Anyone with this link can view the change, AI brief, and
                diff — without signing in. They will not see your other
                rooms or settings.
              </p>
            </div>

            {state.kind === 'loading' && (
              <p className="font-body text-body-sm text-ink-3">
                Creating share link…
              </p>
            )}

            {state.kind === 'ready' && (
              <>
                <div className="flex items-center gap-2 border border-rule bg-paper-2 p-3">
                  <code className="flex-1 font-mono text-mono-sm text-ink break-all min-w-0">
                    {state.url}
                  </code>
                  <button
                    onClick={handleCopy}
                    className="shrink-0 inline-flex items-center gap-1.5 font-mono text-mono-sm text-ink-2 hover:text-ink transition-colors"
                    aria-label="Copy share link"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-signal" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <p className="font-mono text-mono-sm text-ink-4 uppercase tracking-archive">
                  Token · {state.token.slice(0, 8)}…{state.token.slice(-4)}
                </p>
                <div className="flex items-center justify-between pt-3 border-t border-rule">
                  <button
                    onClick={handleRevoke}
                    className="inline-flex items-center gap-1.5 font-mono text-mono-sm text-ember hover:text-ember/80 transition-colors"
                    aria-label="Revoke share link"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Revoke
                  </button>
                  <Button variant="secondary" onClick={handleClose}>
                    Done
                  </Button>
                </div>
              </>
            )}

            {state.kind === 'error' && (
              <>
                <p className="font-body text-body-sm text-ember">
                  {state.message}
                </p>
                <div className="flex justify-end">
                  <Button variant="secondary" onClick={handleClose}>
                    Close
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
