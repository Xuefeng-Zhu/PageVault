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
    <div className="min-h-screen flex bg-paper text-ink relative">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 lg:pl-72">
        <TopBar onRunScan={handleRunScan} scanning={scanning} />
        <main className="flex-1 pt-20 px-6 lg:px-10 pb-16 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
