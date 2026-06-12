import { getUser } from '../lib/auth';

export function Dashboard() {
  const user = getUser();

  return (
    <div className="page-padding">
      <div className="mb-6">
        <h1 className="text-[1.4rem] font-bold tracking-tight">Dashboard</h1>
        <p className="text-text-secondary text-[0.85rem] mt-1">
          Welcome, {user?.name || 'User'}
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-surface-card p-6">
        <h2 className="text-[1rem] font-semibold mb-2">Get Started</h2>
        <p className="text-text-secondary text-[0.85rem] leading-relaxed">
          This is your app's home page. Replace this placeholder with your application's
          dashboard content. Use{' '}
          <code className="font-mono text-[var(--gz-green)] text-[0.8rem] px-1.5 py-0.5 rounded bg-[var(--gz-green-dim)]">
            /gz:webapp:scaffold
          </code>{' '}
          to add features.
        </p>
      </div>
    </div>
  );
}
