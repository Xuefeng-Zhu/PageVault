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
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard/rooms/new', icon: FolderOpen, label: 'Memory Rooms' },
  { href: '#', icon: GitCompare, label: 'Changes' },
  { href: '#', icon: FileText, label: 'Reports' },
  { href: '#', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    return pathname.startsWith(href);
  };

  return (
    <aside className="fixed h-screen w-[260px] left-0 top-0 bg-[#0f172a] flex flex-col py-6 px-4 z-50">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-8 px-2">
        <div className="w-10 h-10 rounded-lg bg-[#2563eb] flex items-center justify-center">
          <Database className="w-5 h-5 text-white" />
        </div>
        <span className="font-semibold text-lg text-white">PageVault</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 relative ${
              isActive(item.href)
                ? 'text-white font-medium bg-white/10 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-[#2563eb] before:rounded-r'
                : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            <item.icon className="w-5 h-5" />
            <span className="text-sm">{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* Footer - Usage Meter */}
      <div className="mt-auto pt-6 border-t border-white/10 space-y-3">
        <div className="px-3">
          <div className="bg-white/5 rounded-xl p-4">
            <p className="text-white/60 text-xs mb-2 uppercase tracking-wider font-medium">Snapshots this month</p>
            <div className="flex items-center justify-between mb-2">
              <span className="text-white text-sm font-medium">Snapshots</span>
              <span className="text-[#2563eb] font-semibold text-sm">7.8K / 10K</span>
            </div>
            <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-[#2563eb] w-[78%] rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
