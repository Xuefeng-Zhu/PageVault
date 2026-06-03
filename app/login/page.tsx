'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Database, Eye, EyeOff, AlertCircle, ArrowRight, ArrowUpRight, Camera, Box, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Primitives';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError('Invalid credentials. Please verify your filing number and try again.');
        setLoading(false);
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-paper text-ink">
      {/* === Left panel — "dossier cover" === */}
      <aside className="relative hidden lg:flex flex-col justify-between p-12 bg-ink text-paper overflow-hidden">
        {/* Decorative diagonals */}
        <div className="absolute inset-0 bg-diagonal opacity-[0.05] pointer-events-none" />
        {/* Ruled lines */}
        <div className="absolute inset-0 bg-ruled opacity-30 pointer-events-none" style={{ backgroundSize: '100% 32px' }} />

        <div className="relative">
          <Link href="/" className="inline-flex items-center gap-3 group">
            <div className="relative w-10 h-10 flex items-center justify-center">
              <div className="absolute inset-0 border border-paper" />
              <div className="absolute inset-1.5 bg-paper" />
              <Database className="relative w-4 h-4 text-ink" strokeWidth={1.75} />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-display text-[1.375rem] tracking-[-0.02em] text-paper">PageVault</span>
              <span className="font-mono text-[0.625rem] uppercase tracking-archive text-paper/50 mt-1">
                The Archive
              </span>
            </div>
          </Link>
        </div>

        <div className="relative max-w-md">
          {/* Top meta */}
          <div className="flex items-center gap-3 mb-8 font-mono text-mono-sm uppercase tracking-archive text-paper/50">
            <span>Restricted · For credentialed analysts</span>
            <span className="h-px flex-1 bg-paper/20" />
            <span className="stamp stamp-enter" style={{ animationDelay: '0.3s' }}>
              Members only
            </span>
          </div>

          <h1 className="font-display text-display-2xl text-paper leading-[0.95] mb-6 tracking-[-0.03em]">
            Sign in to<br />
            <span className="italic text-paper/60">read the record.</span>
          </h1>
          <p className="font-body text-body-lg text-paper/70 leading-relaxed mb-10">
            Your rooms, your snapshots, your briefs. The archive is read-only on this side —
            edits are sealed in Box, and only the LLM is allowed to annotate.
          </p>

          {/* Mini pipeline */}
          <div className="border-t border-paper/15 pt-6 space-y-4">
            {[
              { icon: Camera, label: 'Capture', meta: 'Apify' },
              { icon: Box, label: 'Preserve', meta: 'Box' },
              { icon: Sparkles, label: 'Explain', meta: 'LLM' },
            ].map((s, i) => (
              <div key={s.label} className="flex items-center gap-4">
                <span className="font-mono text-mono-sm text-paper/40 tabular w-6">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="w-8 h-8 flex items-center justify-center border border-paper/20">
                  <s.icon className="w-3.5 h-3.5 text-paper/70" strokeWidth={1.5} />
                </span>
                <span className="font-display text-display-sm text-paper">{s.label}</span>
                <span className="ml-auto font-mono text-mono-sm text-paper/50 uppercase tracking-archive">
                  {s.meta}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center justify-between font-mono text-mono-sm uppercase tracking-archive text-paper/40">
          <span>© 2026 PageVault Inc</span>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-signal-bright pulse-dot" />
            <span>All systems nominal</span>
          </span>
        </div>
      </aside>

      {/* === Right panel — form === */}
      <main className="flex items-center justify-center p-6 sm:p-10 lg:p-16 bg-paper">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <Link href="/" className="lg:hidden inline-flex items-center gap-3 mb-10">
            <div className="relative w-9 h-9 flex items-center justify-center">
              <div className="absolute inset-0 border border-ink" />
              <div className="absolute inset-1 bg-ink" />
              <Database className="relative w-4 h-4 text-paper" strokeWidth={1.75} />
            </div>
            <span className="font-display text-[1.25rem]">PageVault</span>
          </Link>

          {/* Section header */}
          <div className="section-label mb-6">
            <span>Access · 001</span>
          </div>

          <h2 className="font-display text-display-lg text-ink leading-[1.05] mb-2">
            Welcome back.
          </h2>
          <p className="font-body text-body-md text-ink-2 mb-8">
            Use the credentials filed against your account.
          </p>

          {error && (
            <div className="mb-6 flex items-start gap-3 p-4 bg-ember-wash border border-ember/40">
              <AlertCircle className="w-4 h-4 text-ember shrink-0 mt-0.5" strokeWidth={1.75} />
              <p className="font-body text-body-sm text-ember leading-relaxed">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              labelMeta="01 / 02"
            />

            <div>
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                labelMeta="02 / 02"
                rightAdornment={
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="text-ink-3 hover:text-ink transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </button>
                }
              />
              <div className="flex items-center justify-end mt-2">
                <Link
                  href="#"
                  className="font-mono text-mono-sm uppercase tracking-archive text-ink-3 hover:text-ink transition-colors"
                >
                  Forgot filing number?
                </Link>
              </div>
            </div>

            <Button
              type="submit"
              block
              size="lg"
              disabled={loading}
              icon={loading ? undefined : <ArrowRight className="w-4 h-4" />}
              iconRight={loading ? undefined : undefined}
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner size="sm" />
                  <span>Verifying credentials…</span>
                </span>
              ) : (
                'Sign in to the archive'
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="my-7 flex items-center gap-3">
            <span className="h-px flex-1 bg-rule" />
            <span className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">or</span>
            <span className="h-px flex-1 bg-rule" />
          </div>

          {/* Secondary action */}
          <Link
            href="/dashboard/rooms/new"
            className="group flex items-center justify-between gap-4 p-4 border border-rule bg-surface-raised hover:border-ink hover:bg-paper-2 transition-all duration-150"
          >
            <div>
              <div className="font-display text-body-lg text-ink leading-tight">
                New to PageVault?
              </div>
              <div className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive mt-0.5">
                Open your first room — free
              </div>
            </div>
            <ArrowUpRight className="w-4 h-4 text-ink-2 group-hover:text-ink group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform" />
          </Link>

          {/* Demo credentials hint */}
          <div className="mt-7 p-4 border border-dashed border-rule">
            <div className="font-mono text-mono-sm uppercase tracking-archive text-ink-3 mb-2">
              Demo filing
            </div>
            <div className="grid grid-cols-2 gap-3 font-mono text-mono-sm">
              <div>
                <div className="text-ink-4 uppercase tracking-archive text-[0.625rem]">Email</div>
                <div className="text-ink-2">admin@example.com</div>
              </div>
              <div>
                <div className="text-ink-4 uppercase tracking-archive text-[0.625rem]">Password</div>
                <div className="text-ink-2">demo123</div>
              </div>
            </div>
          </div>

          <p className="mt-8 text-center">
            <Link
              href="/"
              className="font-mono text-mono-sm text-ink-3 hover:text-ink transition-colors inline-flex items-center gap-1.5"
            >
              ← Back to the cover
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
