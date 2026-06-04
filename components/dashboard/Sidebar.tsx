'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderOpen,
  GitCompare,
  FileText,
  Settings,
  Database,
  ScrollText,
  Activity,
} from 'lucide-react';

const navSections = [
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Overview', code: '01' },
      { href: '/dashboard/rooms/new', icon: FolderOpen, label: 'Memory Rooms', code: '02' },
      { href: '#changes', icon: GitCompare, label: 'Changes', code: '03', meta: '12' },
      { href: '#reports', icon: FileText, label: 'Reports', code: '04' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '#activity', icon: Activity, label: 'Activity Log', code: 'A1' },
      { href: '#settings', icon: Settings, label: 'Settings', code: 'A2' },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    if (href.startsWith('#')) return false;
    return pathname.startsWith(href);
  };

  return (
    <aside
      className="
        fixed inset-y-0 left-0 z-40
        hidden lg:flex w-72 flex-col
        bg-paper text-ink
        border-r border-rule
      "
    >
      {/* === Brand === */}
      <div className="px-6 pt-7 pb-6 border-b border-rule">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          {/* Mark — composed glyph */}
          <div className="relative w-10 h-10 flex items-center justify-center">
            <div className="absolute inset-0 border border-ink" />
            <div className="absolute inset-1.5 bg-ink" />
            <Database className="relative w-4 h-4 text-paper" strokeWidth={1.75} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display text-[1.375rem] text-ink tracking-[-0.02em]">PageVault</span>
            <span className="font-mono text-[0.625rem] uppercase tracking-archive text-ink-3 mt-1">
              The Archive · v0.1
            </span>
          </div>
        </Link>
      </div>

      {/* === Nav === */}
      <nav className="flex-1 overflow-y-auto px-3 py-6 no-scrollbar">
        {navSections.map((section, sIdx) => (
          <div key={section.label} className={sIdx > 0 ? 'mt-7' : ''}>
            <div className="section-label px-3 mb-2.5">
              {section.label}
            </div>
            <ul className="space-y-px">
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className={[
                        'group flex items-center gap-3 px-3 py-2 transition-all duration-150 ease-archive',
                        'border-l-2',
                        active
                          ? 'border-l-ink bg-surface text-ink'
                          : 'border-l-transparent text-ink-3 hover:text-ink hover:bg-surface-sunken',
                      ].join(' ')}
                    >
                      <item.icon
                        className={[
                          'w-4 h-4 shrink-0 transition-colors',
                          active ? 'text-ink' : 'text-ink-3 group-hover:text-ink',
                        ].join(' ')}
                        strokeWidth={1.75}
                      />
                      <span className="flex-1 font-body text-body-md">{item.label}</span>
                      <span className="font-mono text-mono-sm text-ink-4 tabular">
                        {item.meta ?? item.code}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* === Footer: Vault meter === */}
      <div className="px-5 pt-5 pb-6 border-t border-rule">
        <div className="section-label mb-3">
          <ScrollText className="w-3.5 h-3.5" />
          Vault Capacity
        </div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="font-display text-display-sm text-ink tabular leading-none">7,842</span>
          <span className="font-mono text-mono-sm text-ink-3 tabular">/ 10,000</span>
        </div>
        <div className="relative h-[3px] bg-rule overflow-hidden mb-2">
          <div
            className="absolute inset-y-0 left-0 bg-ink"
            style={{ width: '78%' }}
          />
          <div className="absolute inset-y-0 left-0 right-0 bg-diagonal opacity-40" />
        </div>
        <p className="font-mono text-mono-sm text-ink-3">
          Resets in <span className="text-ink">12 days</span>
        </p>
      </div>
    </aside>
  );
}
