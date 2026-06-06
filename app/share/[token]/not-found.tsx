import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-paper text-ink flex items-center justify-center px-6">
      <Card padding="xl" className="max-w-xl w-full">
        <div className="text-center">
          <div className="w-12 h-12 border border-ember mx-auto mb-5 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-ember" strokeWidth={1.5} />
          </div>
          <h2 className="font-display text-display-md text-ink mb-2">
            Link not found
          </h2>
          <p className="font-body text-body-md text-ink-2 mb-6">
            This share link is invalid, has been revoked, or has expired.
          </p>
          <Link href="/">
            <span className="font-mono text-mono-sm text-ink-2 hover:text-ink transition-colors uppercase tracking-archive">
              PageVault home
            </span>
          </Link>
        </div>
      </Card>
    </div>
  );
}
