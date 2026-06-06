'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Database,
  Brain,
  Shield,
  BarChart3,
  FileSearch,
  Zap,
  CheckCircle2,
  Camera,
  Box,
  Sparkles,
  Plus,
  Minus,
} from 'lucide-react';

// === Static content ===

const trustedBy = [
  { name: 'Compliance teams', count: 142 },
  { name: 'Competitive intel', count: 89 },
  { name: 'Vendor risk', count: 56 },
  { name: 'Policy tracking', count: 38 },
  { name: 'Sales enablement', count: 27 },
];

const pipeline = [
  {
    code: '01',
    icon: Camera,
    title: 'Capture',
    detail: 'Apify crawlers visit your targets on schedule. Every fetch is timestamped and hash-stamped.',
    meta: 'Polling · 1h → 7d',
  },
  {
    code: '02',
    icon: Box,
    title: 'Preserve',
    detail: 'Snapshots and HTML diffs land in Box as immutable evidence. Chain of custody, sealed.',
    meta: 'Storage · WORM',
  },
  {
    code: '03',
    icon: Sparkles,
    title: 'Explain',
    detail: 'An LLM reads the diff and writes back: what changed, who it affects, what to do next.',
    meta: 'Inference · 4–8s',
  },
];

const features = [
  {
    icon: Shield,
    code: 'F-01',
    title: 'Immutable evidence',
    description:
      'Every snapshot, every diff, every report — sealed in Box with hash + timestamp. Admissible in disputes and audits.',
  },
  {
    icon: BarChart3,
    code: 'F-02',
    title: 'Competitive signal',
    description:
      'Track pricing, positioning, and product launches across rivals. Get briefed before the press release lands.',
  },
  {
    icon: FileSearch,
    code: 'F-03',
    title: 'Forensic diff view',
    description:
      'Side-by-side, unified, or redacted. Show the exact change and the exact byte range that moved.',
  },
  {
    icon: Zap,
    code: 'F-04',
    title: 'Severity ranking',
    description:
      'High / notable / minor, calibrated per room. Critical changes route to email and Slack within minutes.',
  },
  {
    icon: CheckCircle2,
    code: 'F-05',
    title: 'Compliance watch',
    description:
      'Monitor regulator pages, vendor SLAs, partner T&Cs. Quiet until something actually moves.',
  },
  {
    icon: Brain,
    code: 'F-06',
    title: 'AI interpretation',
    description:
      'Plain-English summaries of what changed and why it matters for your business. No more reading diffs at 11pm.',
  },
];

const useCases = [
  {
    code: 'UC-01',
    title: 'Competitor monitoring',
    body: 'Price, product, messaging shifts across the landscape — caught the same day.',
    stat: '142 teams',
  },
  {
    code: 'UC-02',
    title: 'Vendor diligence',
    body: 'SLA changes, security advisories, financial disclosures — automatically watched.',
    stat: '56 firms',
  },
  {
    code: 'UC-03',
    title: 'Policy tracking',
    body: 'Federal, state, sector regulators. Alerted on rule changes that hit your industry.',
    stat: '38 desks',
  },
  {
    code: 'UC-04',
    title: 'Sales enablement',
    body: 'Know when a prospect updates pricing or adds a feature before your next call.',
    stat: '27 orgs',
  },
];

const faqs = [
  {
    q: 'How is PageVault different from a screenshot tool?',
    a: 'Screenshots prove something existed. PageVault proves what changed, when, and why it matters — and stores the underlying HTML, CSS, and headers in Box for full forensic replay.',
  },
  {
    q: 'Do I need an Apify or Box account?',
    a: 'No. PageVault runs in Demo Mode out of the box. When you connect your own Apify crawler and Box tenant, the same flows run against your infrastructure.',
  },
  {
    q: 'What goes into the AI explanation?',
    a: 'The diff itself, the previous change, and a short context block about the URL (page type, business interpretation template). The LLM is asked to summarize in 3 lines or fewer.',
  },
  {
    q: 'Can I export the evidence?',
    a: 'Yes. Every change has a downloadable Box folder containing the before/after snapshots, the report, and a JSON diff. Your chain of custody is portable.',
  },
];

// === Lightweight client-only ticker ===
function LiveTicker() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(i);
  }, []);

  const samples = [
    { room: 'Cloud · AWS', action: 'pricing change', severity: 'high' },
    { room: 'Vendor · Datadog', action: 'new region', severity: 'low' },
    { room: 'Competitor · Linear', action: 'pricing page', severity: 'medium' },
    { room: 'Policy · SEC', action: 'rule update', severity: 'high' },
    { room: 'Vendor · Stripe', action: 'API changelog', severity: 'low' },
  ];

  return (
    <div className="overflow-hidden border-y border-rule bg-ink text-paper">
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-paper/10">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-signal-bright opacity-60 animate-pulse-dot" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-signal-bright" />
        </span>
        <span className="font-mono text-mono-sm uppercase tracking-archive text-paper/70">
          Live feed
        </span>
        <span className="font-mono text-mono-sm text-paper/40 ml-auto tabular">
          {String(10_247 + tick).padStart(6, '0')} snapshots archived today
        </span>
      </div>
      <div className="relative">
        <div className="flex gap-12 py-3 animate-marquee whitespace-nowrap">
          {[...samples, ...samples, ...samples].map((s, i) => (
            <span key={i} className="inline-flex items-center gap-3 font-mono text-mono-sm uppercase tracking-archive">
              <span className="text-paper/40 tabular">{String(i + 1).padStart(4, '0')}</span>
              <span className="text-paper/80">{s.room}</span>
              <span className="text-ink-3">·</span>
              <span className={
                s.severity === 'high' ? 'text-ember-bright' :
                s.severity === 'medium' ? 'text-paper' : 'text-paper/50'
              }>{s.action}</span>
              <span className="text-paper/30">→</span>
              <span className={
                s.severity === 'high' ? 'text-ember-bright' :
                s.severity === 'medium' ? 'text-signal-bright' : 'text-paper/40'
              }>
                {s.severity}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-paper text-ink relative">
      {/* === Top bar === */}
      <header className="sticky top-0 z-50 bg-paper/85 backdrop-blur-md border-b border-rule">
        <nav className="max-w-[1440px] mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="relative w-9 h-9 flex items-center justify-center">
              <div className="absolute inset-0 border border-ink" />
              <div className="absolute inset-1 bg-ink" />
              <Database className="relative w-4 h-4 text-paper" strokeWidth={1.75} />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-display text-[1.25rem] tracking-[-0.02em]">PageVault</span>
              <span className="font-mono text-[0.625rem] uppercase tracking-archive text-ink-3 mt-0.5">
                The Archive
              </span>
            </div>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            <a href="#how" className="font-mono text-mono-sm uppercase tracking-archive text-ink-2 hover:text-ink transition-colors">
              Method
            </a>
            <a href="#features" className="font-mono text-mono-sm uppercase tracking-archive text-ink-2 hover:text-ink transition-colors">
              Features
            </a>
            <a href="#use-cases" className="font-mono text-mono-sm uppercase tracking-archive text-ink-2 hover:text-ink transition-colors">
              Use cases
            </a>
            <a href="#faq" className="font-mono text-mono-sm uppercase tracking-archive text-ink-2 hover:text-ink transition-colors">
              FAQ
            </a>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden sm:inline-flex h-9 px-3 items-center font-mono text-mono-sm uppercase tracking-archive text-ink-2 hover:text-ink transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/dashboard/rooms/new"
              className="inline-flex h-9 px-4 items-center gap-2 bg-ink text-paper font-mono text-mono-sm uppercase tracking-archive hover:bg-ink-2 transition-colors"
            >
              Get started
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </nav>
      </header>

      {/* === Hero === */}
      <section className="relative">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 pt-20 pb-24 lg:pt-28 lg:pb-32">
          {/* Top meta */}
          <div className="flex items-center justify-between mb-12 fade-up-1">
            <div className="flex items-center gap-3 font-mono text-mono-sm uppercase tracking-archive text-ink-3">
              <span>Vol. I · Issue 024</span>
              <span className="h-3 w-px bg-rule" />
              <span>Filed: {new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}</span>
            </div>
            <div className="hidden md:flex items-center gap-2 font-mono text-mono-sm uppercase tracking-archive text-ink-3">
              <span className="w-1.5 h-1.5 bg-signal-bright pulse-dot" />
              <span>10,247 snapshots today</span>
            </div>
          </div>

          <div className="grid lg:grid-cols-12 gap-12 items-end">
            <div className="lg:col-span-8 fade-up-2">
              <div className="flex items-center gap-3 mb-7">
                <span className="stamp stamp--ink">Field Manual</span>
                <span className="font-mono text-mono-sm uppercase tracking-archive text-ink-3">
                  No. 01 — Memory layer for the web
                </span>
              </div>

              <h1 className="font-display text-display-2xl lg:text-[5.5rem] lg:leading-[0.95] text-ink tracking-[-0.035em] mb-8">
                The web forgets.<br />
                <span className="italic text-ink-2">PageVault doesn&apos;t.</span>
              </h1>

              <p className="font-body text-body-lg text-ink-2 max-w-2xl leading-relaxed mb-10">
                A memory layer for the changing web. Crawlers capture what your targets publish.
                Box stores the evidence. An LLM writes back what changed, who it matters to, and what
                to do about it. <span className="text-ink">Immutable. Auditable. Explainable.</span>
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/dashboard/rooms/new"
                  className="inline-flex h-12 px-6 items-center gap-3 bg-ink text-paper font-body font-medium text-body-lg hover:bg-ink-2 hover:-translate-y-px transition-all duration-150 ease-archive"
                >
                  Open your first room
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex h-12 px-5 items-center gap-2 border border-rule-strong text-ink font-body font-medium text-body-lg hover:bg-ink hover:text-paper hover:border-ink transition-all duration-150 ease-archive"
                >
                  See the dashboard
                </Link>
              </div>
            </div>

            {/* Right: document specimen */}
            <div className="lg:col-span-4 fade-up-3">
              <div className="relative">
                {/* Stamp */}
                <div className="absolute -top-3 -right-3 stamp stamp-enter" style={{ animationDelay: '0.6s' }}>
                  Archived
                </div>
                {/* Document */}
                <div className="bg-surface-raised border border-rule shadow-paper-md">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-rule">
                    <span className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                      Specimen / 0024-A
                    </span>
                    <span className="font-mono text-mono-sm text-ink-3 tabular">02:14:08 UTC</span>
                  </div>
                  <div className="p-5 space-y-3 bg-ruled">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">Subject</span>
                      <span className="font-mono text-mono-sm text-ember uppercase tracking-archive">▲ Changed</span>
                    </div>
                    <div className="font-display text-display-sm text-ink leading-tight">
                      Pricing for Team tier<br />increased 12%.
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-3 border-t border-rule">
                      <div>
                        <div className="font-mono text-[0.625rem] text-ink-4 uppercase tracking-archive">Before</div>
                        <div className="font-display text-base text-ink tabular">$24.00</div>
                      </div>
                      <div>
                        <div className="font-mono text-[0.625rem] text-ink-4 uppercase tracking-archive">After</div>
                        <div className="font-display text-base text-signal tabular">$26.88</div>
                      </div>
                      <div>
                        <div className="font-mono text-[0.625rem] text-ink-4 uppercase tracking-archive">Δ</div>
                        <div className="font-display text-base text-ember tabular">+12.0%</div>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-rule">
                      <div className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive mb-1">
                        AI interpretation
                      </div>
                      <p className="font-body text-body-sm text-ink-2 leading-relaxed">
                        Likely annual list-price alignment. Affects 3 of your watched rooms. Review
                        within 48 hours.
                      </p>
                    </div>
                  </div>
                  <div className="px-4 py-2.5 border-t border-rule flex items-center justify-between bg-paper-2">
                    <span className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                      Vault / 2026-06-02
                    </span>
                    <span className="font-mono text-mono-sm text-signal uppercase tracking-archive">
                      Sealed ✓
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Live ticker */}
        <LiveTicker />
      </section>

      {/* === Trusted by === */}
      <section className="border-b border-rule py-10">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10">
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-3">
            <span className="font-mono text-mono-sm uppercase tracking-archive text-ink-3">
              Trusted by teams running
            </span>
            {trustedBy.map((t) => (
              <span key={t.name} className="inline-flex items-baseline gap-2 font-mono text-mono-sm uppercase tracking-archive">
                <span className="text-ink-2">{t.name}</span>
                <span className="text-ink-4 tabular">{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* === Method / How it works === */}
      <section id="how" className="py-24 lg:py-32 bg-paper-2">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10">
          <div className="grid lg:grid-cols-12 gap-12 mb-16">
            <div className="lg:col-span-5">
              <div className="section-label mb-5">
                <span>Method</span>
                <span className="ml-auto">I.</span>
              </div>
              <h2 className="font-display text-display-xl text-ink leading-[1.05] mb-6">
                Three operations.<br />
                <span className="italic text-ink-2">One audited record.</span>
              </h2>
            </div>
            <div className="lg:col-span-6 lg:col-start-7 self-end">
              <p className="font-body text-body-lg text-ink-2 leading-relaxed">
                PageVault composes three systems you probably already use. The point isn&apos;t novelty — it&apos;s that
                when a page on the open web changes, the <em>why it matters</em> arrives in the same envelope as
                the <em>what</em>.
              </p>
            </div>
          </div>

          {/* Pipeline */}
          <div className="grid md:grid-cols-3 gap-0 border border-rule bg-surface-raised">
            {pipeline.map((step, i) => (
              <div
                key={step.code}
                className={[
                  'relative p-7 lg:p-8',
                  i > 0 ? 'md:border-l border-t md:border-t-0 border-rule' : '',
                ].join(' ')}
              >
                <div className="flex items-start justify-between mb-6">
                  <span className="font-mono text-mono-sm text-ink-4 uppercase tracking-archive tabular">
                    {step.code} / 03
                  </span>
                  <span className="w-10 h-10 flex items-center justify-center border border-rule">
                    <step.icon className="w-4 h-4 text-ink-2" strokeWidth={1.5} />
                  </span>
                </div>
                <h3 className="font-display text-display-md text-ink mb-3">
                  {step.title}
                </h3>
                <p className="font-body text-body-md text-ink-2 leading-relaxed mb-5">
                  {step.detail}
                </p>
                <div className="pt-5 border-t border-rule">
                  <span className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                    {step.meta}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === Features === */}
      <section id="features" className="py-24 lg:py-32">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10">
          <div className="mb-16">
            <div className="section-label mb-5">
              <span>Features</span>
              <span className="ml-auto">II.</span>
            </div>
            <h2 className="font-display text-display-xl text-ink max-w-2xl leading-[1.05]">
              Six disciplines.<br />
              <span className="italic text-ink-2">One daily brief.</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-rule border border-rule">
            {features.map((f) => (
              <article
                key={f.code}
                className="group relative bg-surface-raised p-7 hover:bg-paper transition-colors duration-200"
              >
                <div className="flex items-start justify-between mb-12">
                  <span className="w-10 h-10 flex items-center justify-center border border-rule group-hover:border-ink transition-colors">
                    <f.icon className="w-4 h-4 text-ink-2 group-hover:text-ink transition-colors" strokeWidth={1.5} />
                  </span>
                  <span className="font-mono text-mono-sm text-ink-4 uppercase tracking-archive tabular">
                    {f.code}
                  </span>
                </div>
                <h3 className="font-display text-display-sm text-ink mb-3 leading-tight">
                  {f.title}
                </h3>
                <p className="font-body text-body-md text-ink-2 leading-relaxed">
                  {f.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* === Use cases === */}
      <section id="use-cases" className="py-24 lg:py-32 bg-ink text-paper relative overflow-hidden">
        <div className="absolute inset-0 bg-diagonal opacity-[0.04] pointer-events-none" />
        <div className="relative max-w-[1440px] mx-auto px-6 lg:px-10">
          <div className="grid lg:grid-cols-12 gap-12 mb-16">
            <div className="lg:col-span-7">
              <div className="flex items-center gap-3 mb-5 font-mono text-mono-sm uppercase tracking-archive text-paper/50">
                <span>Use cases</span>
                <span className="h-px flex-1 bg-paper/20" />
                <span>III.</span>
              </div>
              <h2 className="font-display text-display-xl text-paper leading-[1.05]">
                Four desks. <span className="italic text-paper/50">Same archive.</span>
              </h2>
            </div>
            <div className="lg:col-span-4 lg:col-start-9 self-end">
              <p className="font-body text-body-lg text-paper/70 leading-relaxed">
                Whatever your team watches — competitors, vendors, regulators, prospects — the workflow
                is the same: open a room, list the URLs, get briefed.
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-px bg-paper/10">
            {useCases.map((u) => (
              <article key={u.code} className="bg-ink p-7 hover:bg-paper/[0.04] transition-colors group">
                <div className="flex items-baseline justify-between mb-10">
                  <span className="font-mono text-mono-sm text-paper/40 uppercase tracking-archive tabular">
                    {u.code}
                  </span>
                  <ArrowUpRight className="w-4 h-4 text-paper/30 group-hover:text-paper group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all" />
                </div>
                <h3 className="font-display text-display-sm text-paper mb-4 leading-tight">
                  {u.title}
                </h3>
                <p className="font-body text-body-md text-paper/60 leading-relaxed mb-8">
                  {u.body}
                </p>
                <div className="pt-5 border-t border-paper/10">
                  <span className="font-mono text-mono-sm text-signal-bright uppercase tracking-archive">
                    {u.stat}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* === Testimonial / Quote === */}
      <section className="py-24 lg:py-32 bg-paper-2 border-y border-rule">
        <div className="max-w-[1100px] mx-auto px-6 lg:px-10">
          <div className="grid md:grid-cols-12 gap-8">
            <div className="md:col-span-3">
              <div className="section-label">Field note</div>
              <p className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive mt-3">001 · Customer</p>
            </div>
            <div className="md:col-span-9">
              <blockquote className="font-display text-display-lg lg:text-[2.5rem] text-ink leading-[1.2] mb-8 tracking-[-0.02em]">
                <span className="text-ink-3 mr-2">“</span>
                We caught a vendor quietly changing their data-residency clause three days before our
                renewal. The diff view paid for the entire annual contract.
                <span className="text-ink-3 ml-1">”</span>
              </blockquote>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-ink text-paper flex items-center justify-center font-display text-base">
                  M
                </div>
                <div>
                  <div className="font-body text-body-md text-ink">Maya Okafor</div>
                  <div className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                    Head of Vendor Risk · Linear competitor
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* === FAQ === */}
      <section id="faq" className="py-24 lg:py-32">
        <div className="max-w-[1100px] mx-auto px-6 lg:px-10">
          <div className="mb-12">
            <div className="section-label mb-5">
              <span>Common questions</span>
              <span className="ml-auto">IV.</span>
            </div>
            <h2 className="font-display text-display-xl text-ink leading-[1.05]">
              Things people ask <span className="italic text-ink-2">before signing up.</span>
            </h2>
          </div>

          <div className="border-t border-rule">
            {faqs.map((f, i) => (
              <FaqItem key={f.q} q={f.q} a={f.a} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* === CTA === */}
      <section className="py-24 lg:py-32 bg-paper-2 border-t border-rule">
        <div className="max-w-[1100px] mx-auto px-6 lg:px-10">
          <div className="bg-ink text-paper relative overflow-hidden p-12 lg:p-16">
            <div className="absolute inset-0 bg-diagonal opacity-[0.05] pointer-events-none" />
            <div className="absolute top-6 right-6 stamp stamp-enter" style={{ animationDelay: '0.2s' }}>Open · 24/7</div>

            <div className="relative max-w-3xl">
              <div className="flex items-center gap-3 mb-6 font-mono text-mono-sm uppercase tracking-archive text-paper/50">
                <span>Begin</span>
                <span className="h-px w-12 bg-paper/30" />
                <span>Free · No card</span>
              </div>
              <h2 className="font-display text-display-xl text-paper leading-[1.05] mb-6">
                Open your first room.<br />
                <span className="italic text-paper/50">Watch one URL change.</span>
              </h2>
              <p className="font-body text-body-lg text-paper/70 mb-10 max-w-xl leading-relaxed">
                Takes about ninety seconds. We&apos;ll run an initial crawl, surface the diff, and
                write the AI interpretation before you finish your coffee.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/dashboard/rooms/new"
                  className="inline-flex h-12 px-6 items-center gap-3 bg-paper text-ink font-body font-medium text-body-lg hover:bg-paper-2 transition-colors"
                >
                  Open a memory room
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex h-12 px-5 items-center gap-2 border border-paper/30 text-paper font-body font-medium text-body-lg hover:bg-paper/10 transition-colors"
                >
                  View demo dashboard
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* === Footer === */}
      <footer className="bg-paper border-t border-rule">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-16">
          <div className="grid lg:grid-cols-12 gap-12 mb-12">
            <div className="lg:col-span-5">
              <Link href="/" className="flex items-center gap-3 mb-5">
                <div className="relative w-9 h-9 flex items-center justify-center">
                  <div className="absolute inset-0 border border-ink" />
                  <div className="absolute inset-1 bg-ink" />
                  <Database className="relative w-4 h-4 text-paper" strokeWidth={1.75} />
                </div>
                <span className="font-display text-[1.25rem]">PageVault</span>
              </Link>
              <p className="font-body text-body-md text-ink-2 max-w-md leading-relaxed mb-6">
                The memory layer for the changing web. Built on Apify, Box, and an OpenAI-compatible
                LLM. Filed daily, sealed nightly.
              </p>
              <div className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                <span>Filed at</span>
                <span className="text-ink-2 ml-2 tabular">02:00 UTC</span>
              </div>
            </div>

            {[
              { title: 'Product', items: ['Capture', 'Storage', 'Interpretation', 'Alerts', 'API'] },
              { title: 'Use cases', items: ['Competitive', 'Compliance', 'Vendor risk', 'Sales'] },
              { title: 'Company', items: ['About', 'Customers', 'Changelog', 'Contact'] },
              { title: 'Legal', items: ['Privacy', 'Terms', 'Security'] },
            ].map((col) => (
              <div key={col.title} className="lg:col-span-2">
                <h4 className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive mb-4">
                  {col.title}
                </h4>
                <ul className="space-y-2.5">
                  {col.items.map((item) => (
                    <li key={item}>
                      <a
                        href="#"
                        className="font-body text-body-sm text-ink-2 hover:text-ink transition-colors"
                      >
                        {item}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="pt-8 border-t border-rule flex flex-wrap items-center justify-between gap-4">
            <p className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
              © 2026 PageVault Inc · Vol. I
            </p>
            <div className="flex items-center gap-6 font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
              <a href="#" className="hover:text-ink transition-colors flex items-center gap-1.5">
                Status <span className="w-1.5 h-1.5 bg-signal-bright pulse-dot" />
              </a>
              <a href="#" className="hover:text-ink transition-colors">RSS</a>
              <a href="#" className="hover:text-ink transition-colors">Press</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// === FAQ accordion (lightweight, client) ===
function FaqItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(index === 0);
  return (
    <div className="border-b border-rule">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-start gap-6 py-6 text-left group"
        aria-expanded={open}
      >
        <span className="font-mono text-mono-sm text-ink-4 uppercase tracking-archive tabular pt-0.5 shrink-0">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="flex-1 font-display text-display-sm text-ink leading-snug group-hover:text-ink-2 transition-colors">
          {q}
        </span>
        <span className="shrink-0 mt-1">
          {open ? (
            <Minus className="w-4 h-4 text-ink" strokeWidth={1.5} />
          ) : (
            <Plus className="w-4 h-4 text-ink-3 group-hover:text-ink transition-colors" strokeWidth={1.5} />
          )}
        </span>
      </button>
      <div
        className="grid transition-all duration-300 ease-archive"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <p className="pl-12 pr-12 pb-6 font-body text-body-md text-ink-2 leading-relaxed max-w-2xl">
            {a}
          </p>
        </div>
      </div>
    </div>
  );
}
