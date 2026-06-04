'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Search, Bell, ChevronDown, LogOut, Settings, User, Radar, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface TopBarProps {
  onRunScan?: () => Promise<void>;
  scanning?: boolean;
  title?: string;
}

export function TopBar({ onRunScan, scanning = false }: TopBarProps) {
  const { data: session } = useSession();
  const [searchQuery, setSearchQuery] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const userEmail = session?.user?.email || 'analyst@pagevault';
  const userInitial = userEmail ? userEmail.charAt(0).toUpperCase() : 'A';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Close user menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header
      className="
        fixed top-0 right-0 left-0 lg:left-72 z-30
        h-16 flex items-center justify-between
        bg-paper/80 backdrop-blur-md border-b border-rule
        px-6 lg:px-10
      "
    >
      {/* Left: date + status */}
      <div className="flex items-center gap-5">
        <div className="hidden md:flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-signal-bright opacity-60 animate-pulse-dot" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-signal-bright" />
          </span>
          <span className="font-mono text-mono-sm text-ink-2 uppercase tracking-archive">
            Live · 24 rooms · 156 snapshots today
          </span>
        </div>
        <div className="hidden lg:block font-mono text-mono-sm text-ink-3 tabular tracking-archive uppercase">
          {today}
        </div>
      </div>

      {/* Center: search */}
      <div className="flex-1 max-w-md mx-6 hidden md:block">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" strokeWidth={1.75} />
          <input
            type="text"
            placeholder="Search rooms, changes, URLs…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="
              w-full h-9 pl-9 pr-12
              bg-surface-raised border border-rule rounded-sm
              font-body text-body-sm text-ink placeholder:text-ink-4
              focus:outline-none focus:border-ink focus:shadow-paper-sm
              transition-all duration-150
            "
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center px-1.5 h-5 font-mono text-[0.625rem] text-ink-3 border border-rule rounded-sm bg-paper-2">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2.5">
        {/* Run scan */}
        <Button
          size="sm"
          variant="primary"
          onClick={onRunScan}
          loading={scanning}
          icon={scanning ? undefined : <Radar className="w-3.5 h-3.5" />}
        >
          {scanning ? 'Scanning…' : 'Run Scan'}
        </Button>

        {/* Notifications */}
        <button
          className="
            relative w-9 h-9 flex items-center justify-center
            border border-rule bg-surface-raised
            hover:border-ink hover:bg-surface transition-all duration-150
          "
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4 text-ink-2" strokeWidth={1.75} />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-ember-bright rounded-full" />
        </button>

        <div className="w-px h-6 bg-rule mx-1.5" />

        {/* User menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu((s) => !s)}
            className="
              flex items-center gap-2 pl-1.5 pr-2 py-1
              border border-rule bg-surface-raised
              hover:border-ink transition-all duration-150
            "
            aria-haspopup="menu"
            aria-expanded={showUserMenu}
          >
            <span className="
              w-7 h-7 flex items-center justify-center
              bg-ink text-paper font-display font-medium text-[0.875rem]
            ">
              {userInitial}
            </span>
            <span className="hidden sm:flex flex-col items-start leading-none">
              <span className="font-body text-body-sm text-ink truncate max-w-[140px]">
                {userEmail.split('@')[0]}
              </span>
              <span className="font-mono text-[0.625rem] text-ink-3 mt-0.5 uppercase tracking-archive">
                Analyst
              </span>
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-ink-3 transition-transform duration-150 ${showUserMenu ? 'rotate-180' : ''}`}
              strokeWidth={1.75}
            />
          </button>

          {showUserMenu && (
            <div
              role="menu"
              className="
                absolute right-0 top-full mt-2 w-64 z-50
                bg-surface-raised border border-rule shadow-paper-lg
                animate-[fade-up_0.2s_ease-out_both]
              "
            >
              <div className="px-4 py-3 border-b border-rule">
                <p className="font-body text-body-sm text-ink truncate">{userEmail}</p>
                <p className="font-mono text-mono-sm text-ink-3 mt-0.5 uppercase tracking-archive">
                  Signed in via OAuth
                </p>
              </div>
              <div className="py-1">
                <button className="w-full flex items-center gap-3 px-4 py-2 font-body text-body-sm text-ink-2 hover:bg-paper-2 hover:text-ink transition-colors text-left">
                  <User className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Profile
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-2 font-body text-body-sm text-ink-2 hover:bg-paper-2 hover:text-ink transition-colors text-left">
                  <Settings className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Settings
                </button>
              </div>
              <div className="border-t border-rule py-1">
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="w-full flex items-center gap-3 px-4 py-2 font-body text-body-sm text-ember hover:bg-ember-wash transition-colors text-left"
                >
                  <LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
