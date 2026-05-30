'use client';

import { ReactNode, useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [scanning, setScanning] = useState(false);

  const handleRunScan = async () => {
    setScanning(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setScanning(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8fafc]">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-[260px]">
        <TopBar onRunScan={handleRunScan} scanning={scanning} />
        <main className="flex-1 overflow-auto p-6 mt-16">
          {children}
        </main>
      </div>
    </div>
  );
}
