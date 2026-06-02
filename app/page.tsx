'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, 
  Globe, 
  Database, 
  Brain, 
  Shield, 
  BarChart3, 
  FileSearch, 
  Zap, 
  CheckCircle,
  Camera,
  Box,
  Sparkles
} from 'lucide-react';

const trustedCompanies = [
  { name: 'Stripe', color: 'bg-indigo-400' },
  { name: 'Notion', color: 'bg-slate-400' },
  { name: 'Figma', color: 'bg-purple-500' },
  { name: 'Linear', color: 'bg-blue-500' },
  { name: 'Vercel', color: 'bg-black' },
  { name: 'Supabase', color: 'bg-emerald-500' },
];

const pipelineSteps = [
  {
    icon: Camera,
    label: 'Step 1: Capture',
    title: 'Apify Automation',
    description: 'Web crawler visits and captures snapshots',
  },
  {
    icon: Box,
    label: 'Step 2: Store',
    title: 'Box Evidence Vault',
    description: 'Immutable storage with chain of custody',
  },
  {
    icon: Sparkles,
    label: 'Step 3: Explain',
    title: 'AI Insight Engine',
    description: 'LLM explains what changed and why it matters',
  },
];

const howItWorks = [
  {
    number: '1',
    title: 'Create a Memory Room',
    description: 'Add URLs you want to monitor. We track changes across competitors, vendors, and policy targets.',
  },
  {
    number: '2',
    title: 'Crawler Captures Evidence',
    description: 'Our Apify-powered crawler visits your targets daily, storing before/after snapshots in Box.',
  },
  {
    number: '3',
    title: 'AI Analyzes Changes',
    description: 'When something changes, our AI explains what happened and why it matters for your business.',
  },
];

const features = [
  {
    icon: Shield,
    title: 'Immutable Evidence',
    description: 'Every snapshot stored in Box creates an auditable chain of custody. Legal defensible.',
    color: 'bg-blue-50',
    iconColor: 'text-blue-600',
  },
  {
    icon: BarChart3,
    title: 'Competitive Intelligence',
    description: 'Track competitor pricing, positioning, and feature launches before they go mainstream.',
    color: 'bg-purple-50',
    iconColor: 'text-purple-600',
  },
  {
    icon: FileSearch,
    title: 'Forensic Analysis',
    description: 'Diff view shows exactly what changed. AI interpretation explains the significance.',
    color: 'bg-green-50',
    iconColor: 'text-green-600',
  },
  {
    icon: Zap,
    title: 'Real-time Alerts',
    description: 'Get notified within hours of changes. High severity alerts prioritized automatically.',
    color: 'bg-orange-50',
    iconColor: 'text-orange-600',
  },
  {
    icon: CheckCircle,
    title: 'Compliance Tracking',
    description: 'Monitor policy pages and regulatory updates. Evidence stored for audit requirements.',
    color: 'bg-teal-50',
    iconColor: 'text-teal-600',
  },
  {
    icon: Brain,
    title: 'AI-Powered Insights',
    description: 'OpenAI analyzes changes to explain business impact. No more manual monitoring.',
    color: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
  },
];

const useCases = [
  {
    title: 'Competitor Monitoring',
    description: 'Track rival pricing, product launches, and messaging shifts in real-time.',
    icon: '🎯',
    bg: 'bg-slate-900',
  },
  {
    title: 'Vendor Due Diligence',
    description: 'Monitor vendor pages for SLA changes, security updates, and financial health.',
    icon: '🔍',
    bg: 'bg-white',
  },
  {
    title: 'Policy Tracking',
    description: 'Watch regulatory pages for rule changes that could impact your business.',
    icon: '📋',
    bg: 'bg-white',
  },
  {
    title: 'Sales Intelligence',
    description: 'Know when prospects update pricing or add features before your next call.',
    icon: '💼',
    bg: 'bg-blue-600',
  },
];

const footerLinks = {
  Product: ['Capture Engine', 'AI Analysis', 'Integrations', 'Security'],
  'Use Cases': ['Competitive', 'Compliance', 'Dev Docs', 'E-commerce'],
  Company: ['About Us', 'Careers', 'Blog', 'Contact'],
  Legal: ['Privacy', 'Terms', 'Cookie Policy'],
};

export default function LandingPage() {
  const router = useRouter();

  const handleGetStarted = () => {
    router.push('/dashboard/rooms/new');
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#faf8ff' }}>
      {/* Top Navigation */}
      <header className="fixed top-0 left-0 right-0 z-50 h-16 flex items-center" style={{ backgroundColor: '#0f172a' }}>
        <nav className="max-w-[1440px] mx-auto w-full px-6 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#2563eb' }}>
              <Database className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-white tracking-tight">PageVault</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-white/70 hover:text-white transition-colors text-sm font-medium">Product</a>
            <a href="#use-cases" className="text-white/70 hover:text-white transition-colors text-sm font-medium">Solutions</a>
            <a href="#pricing" className="text-white/70 hover:text-white transition-colors text-sm font-medium">Pricing</a>
            <a href="#docs" className="text-white/70 hover:text-white transition-colors text-sm font-medium">Docs</a>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-white/70 hover:text-white transition-colors text-sm font-medium">
              Sign In
            </Link>
            <Link 
              href="/dashboard/rooms/new" 
              className="px-4 py-2 rounded-lg text-white text-sm font-bold transition-all hover:opacity-90"
              style={{ backgroundColor: '#2563eb' }}
            >
              Get Started Free
            </Link>
          </div>
        </nav>
      </header>

      <main className="pt-16">
        {/* Hero Section */}
        <section className="relative overflow-hidden pt-24 pb-32">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(45%_45%_at_50%_50%,rgba(37,99,235,0.05)_0%,transparent_100%)]" />
          <div className="max-w-[1440px] mx-auto px-6">
            <div className="max-w-3xl mx-auto text-center">
              {/* Badge */}
              <div 
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full w-fit mx-auto mb-6"
                style={{ backgroundColor: '#dbe1ff' }}
              >
                <Zap className="w-4 h-4" style={{ color: '#004ac6' }} />
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#003ea8', fontFamily: 'JetBrains Mono, monospace' }}>
                  Now tracking 1,247 changes across 89 rooms
                </span>
              </div>

              {/* Headline */}
              <h1 
                className="text-4xl font-bold mb-6 leading-tight"
                style={{ color: '#131b2e', fontFamily: 'Inter, sans-serif', letterSpacing: '-0.02em' }}
              >
                Your Memory Layer for the Web
              </h1>

              {/* Subtext */}
              <p 
                className="text-lg mb-8 max-w-2xl mx-auto"
                style={{ color: '#434655' }}
              >
                Apify captures website snapshots. Box stores the evidence. AI explains what changed and why it matters. Immutable web data at the speed of thought.
              </p>

              {/* CTA buttons */}
              <div className="flex flex-wrap justify-center gap-4">
                <Link 
                  href="/dashboard/rooms/new" 
                  className="px-6 py-3 rounded-lg font-bold text-white flex items-center gap-2 transition-all hover:-translate-y-0.5"
                  style={{ backgroundColor: '#2563eb', fontFamily: 'Inter, sans-serif' }}
                >
                  Get Started Free
                  <ArrowRight className="w-5 h-5" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Social Proof Bar */}
        <section className="py-12 border-y" style={{ borderColor: '#e2e8f0', backgroundColor: '#f2f3ff' }}>
          <div className="max-w-[1440px] mx-auto px-6">
            <p className="text-center text-sm mb-8" style={{ color: '#434655' }}>
              Trusted by teams at
            </p>
            <div className="flex items-center justify-center flex-wrap gap-8">
              {trustedCompanies.map((company) => (
                <div 
                  key={company.name} 
                  className="h-8 w-24 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: company.color + '40' }}
                >
                  <span className="text-sm font-semibold" style={{ color: '#434655' }}>{company.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pipeline Visual */}
        <section className="py-24">
          <div className="max-w-[1440px] mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold mb-4" style={{ color: '#131b2e', fontFamily: 'Inter, sans-serif' }}>
                How PageVault Works
              </h2>
              <p className="text-lg max-w-2xl mx-auto" style={{ color: '#434655' }}>
                From raw crawler data to actionable intelligence in three steps
              </p>
            </div>
            <div className="flex flex-col md:flex-row items-center justify-center gap-8">
              {pipelineSteps.map((step, index) => (
                <div key={step.title} className="flex items-center gap-8">
                  <div 
                    className="p-6 rounded-2xl flex items-center gap-4"
                    style={{ 
                      backgroundColor: 'white', 
                      border: '1px solid #e2e8f0',
                      borderRadius: '16px'
                    }}
                  >
                    <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#f2f3ff' }}>
                      <step.icon className="w-7 h-7" style={{ color: '#2563eb' }} />
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: '#2563eb', fontFamily: 'JetBrains Mono, monospace' }}>
                        {step.label}
                      </p>
                      <div className="font-bold" style={{ color: '#131b2e' }}>{step.title}</div>
                      <div className="text-sm" style={{ color: '#434655' }}>{step.description}</div>
                    </div>
                  </div>
                  {index < pipelineSteps.length - 1 && (
                    <ArrowRight className="w-8 h-8 hidden md:block" style={{ color: '#e2e8f0' }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="py-24" style={{ backgroundColor: '#f2f3ff' }}>
          <div className="max-w-[1440px] mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold mb-4" style={{ color: '#131b2e', fontFamily: 'Inter, sans-serif' }}>
                Get Started in Minutes
              </h2>
              <p className="text-lg" style={{ color: '#434655' }}>
                Three steps to actionable web intelligence
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {howItWorks.map((step) => (
                <div 
                  key={step.number} 
                  className="p-8 rounded-2xl text-center"
                  style={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e2e8f0',
                    borderRadius: '16px'
                  }}
                >
                  <div 
                    className="w-12 h-12 rounded-full mx-auto mb-6 flex items-center justify-center text-white font-bold"
                    style={{ backgroundColor: '#712ae2' }}
                  >
                    {step.number}
                  </div>
                  <h3 className="text-xl font-bold mb-3" style={{ color: '#131b2e', fontFamily: 'Inter, sans-serif' }}>
                    {step.title}
                  </h3>
                  <p className="text-sm" style={{ color: '#434655' }}>{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-24">
          <div className="max-w-[1440px] mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold mb-4" style={{ color: '#131b2e', fontFamily: 'Inter, sans-serif' }}>
                Enterprise-Grade Intelligence
              </h2>
              <p className="text-lg" style={{ color: '#434655' }}>
                Everything you need to stay ahead of web changes
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {features.map((feature) => (
                <div 
                  key={feature.title} 
                  className="p-6"
                  style={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e2e8f0',
                    borderRadius: '16px'
                  }}
                >
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                    style={{ backgroundColor: feature.color }}
                  >
                    <feature.icon className={`w-6 h-6 ${feature.iconColor}`} />
                  </div>
                  <h3 className="text-lg font-bold mb-2" style={{ color: '#131b2e', fontFamily: 'Inter, sans-serif' }}>
                    {feature.title}
                  </h3>
                  <p className="text-sm" style={{ color: '#434655' }}>{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section id="use-cases" className="py-24" style={{ backgroundColor: '#f2f3ff' }}>
          <div className="max-w-[1440px] mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold mb-4" style={{ color: '#131b2e', fontFamily: 'Inter, sans-serif' }}>
                Built for Every Team
              </h2>
              <p className="text-lg" style={{ color: '#434655' }}>
                Use cases across your entire organization
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
              {useCases.map((useCase, index) => (
                <div 
                  key={useCase.title} 
                  className="p-6 text-center"
                  style={{ 
                    backgroundColor: useCase.bg,
                    border: '1px solid #e2e8f0',
                    borderRadius: '16px'
                  }}
                >
                  <div className="text-4xl mb-4">{useCase.icon}</div>
                  <h3 
                    className="text-lg font-bold mb-2"
                    style={{ color: index === 0 || index === 3 ? 'white' : '#131b2e', fontFamily: 'Inter, sans-serif' }}
                  >
                    {useCase.title}
                  </h3>
                  <p 
                    className="text-sm"
                    style={{ color: index === 0 || index === 3 ? 'rgba(255,255,255,0.7)' : '#434655' }}
                  >
                    {useCase.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24">
          <div className="max-w-[1440px] mx-auto px-6">
            <div 
              className="rounded-3xl p-16 text-center relative overflow-hidden"
              style={{ 
                background: 'linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)'
              }}
            >
              <h2 className="text-4xl font-bold text-white mb-4" style={{ fontFamily: 'Inter, sans-serif' }}>
                Ready to build your web memory?
              </h2>
              <p className="text-lg text-white/80 mb-8 max-w-2xl mx-auto">
                Join 500+ enterprise teams using PageVault to secure their web intelligence and automate evidence capture.
              </p>
              <div className="flex items-center justify-center gap-4">
                <Link 
                  href="/dashboard/rooms/new" 
                  className="px-6 py-3 rounded-lg font-bold text-sm text-white transition-colors hover:bg-white/10"
                  style={{ backgroundColor: 'white', color: '#2563eb' }}
                >
                  Start Free Trial
                </Link>
                <button 
                  className="px-6 py-3 rounded-lg font-bold text-sm text-white border border-white/30 transition-colors hover:bg-white/10"
                >
                  Talk to Sales
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-16" style={{ backgroundColor: '#131b2e' }}>
          <div className="max-w-[1440px] mx-auto px-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-12">
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#2563eb' }}>
                    <Database className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-bold text-lg text-white">PageVault</span>
                </div>
                <p className="text-sm text-white/60 max-w-xs">
                  The ultimate evidence vault for the dynamic web. Capture, store, and understand changes at scale.
                </p>
              </div>
              {Object.entries(footerLinks).map(([title, links]) => (
                <div key={title}>
                  <h4 className="font-bold text-white mb-4">{title}</h4>
                  <ul className="space-y-2">
                    {links.map((link) => (
                      <li key={link}>
                        <a href="#" className="text-sm text-white/60 hover:text-white transition-colors">
                          {link}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="border-t border-white/10 pt-8 flex items-center justify-between">
              <p className="text-sm text-white/40">© 2024 PageVault Inc. All rights reserved.</p>
              <div className="flex items-center gap-6 text-sm text-white/40">
                <a href="#" className="hover:text-white transition-colors">Status</a>
                <a href="#" className="hover:text-white transition-colors">Privacy</a>
                <a href="#" className="hover:text-white transition-colors">Terms</a>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}