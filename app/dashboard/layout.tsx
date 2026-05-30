import type { Metadata } from 'next';
import { AppShell } from '@/components/dashboard/AppShell';

export const metadata: Metadata = {
  title: 'Dashboard — PageVault',
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}