'use client';

import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Search, Bell, ChevronDown, LogOut } from 'lucide-react';

interface TopBarProps {
  onRunScan?: () => Promise<void>;
  scanning?: boolean;
  title?: string;
}

export function TopBar({ onRunScan, scanning = false, title = 'Memory Rooms' }: TopBarProps) {
  const { data: session } = useSession();
  const [searchQuery, setSearchQuery] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);

  const userEmail = session?.user?.email || '';
  const userInitial = userEmail ? userEmail.charAt(0).toUpperCase() : 'A';

  return (
    <header className="fixed top-0 right-0 w-[calc(100%-260px)] h-16 bg-white border-b border-[#e2e8f0] z-40 flex justify-between items-center px-6">
      {/* Page Title */}
      <div className="flex items-center">
        <h1 className="text-lg font-semibold text-[#131b2e]">{title}</h1>
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-4 flex-1 max-w-md mx-8">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#434655]" />
          <input
            type="text"
            placeholder="Search memory rooms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#f2f3ff] border border-[#e2e8f0] rounded-lg py-2 pl-10 pr-4 text-sm placeholder:text-[#434655]/50 focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
          />
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-4">
        <button className="p-2 text-[#434655] hover:bg-[#f2f3ff] rounded-full transition-colors relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-[#ef4444] rounded-full" />
        </button>

        <div className="h-8 w-px bg-[#e2e8f0] mx-2" />

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 hover:bg-[#f2f3ff] rounded-lg px-2 py-1 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-[#2563eb] flex items-center justify-center text-white font-semibold text-sm">
              {userInitial}
            </div>
            <div className="text-left hidden sm:block">
              <div className="text-sm font-medium text-[#131b2e] truncate max-w-[150px]">{userEmail || 'User'}</div>
            </div>
            <ChevronDown className="w-4 h-4 text-[#434655]" />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-[#e2e8f0] py-2 z-50">
              <div className="px-4 py-2 border-b border-[#e2e8f0]">
                <p className="text-sm font-medium text-[#131b2e] truncate">{userEmail || 'User'}</p>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#434655] hover:bg-[#f2f3ff] transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
