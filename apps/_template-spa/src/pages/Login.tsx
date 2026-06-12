import { Navigate } from 'react-router-dom';
import { isAuthenticated, startGoogleLogin } from '../lib/auth';

function getEnvironment(): { name: string; color: string } | null {
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return { name: 'local', color: '#a78bfa' };
  }
  if (hostname.includes('dev')) {
    return { name: 'dev', color: '#00e5ff' };
  }
  if (hostname.includes('test')) {
    return { name: 'test', color: '#ff9531' };
  }
  if (hostname.includes('stage') || hostname.includes('staging')) {
    return { name: 'stage', color: '#ffcd1d' };
  }
  return null;
}

export function Login() {
  if (isAuthenticated()) return <Navigate to="/" replace />;

  const env = getEnvironment();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8">
      <div className="text-center">
        <img
          src="/gz-logo-white.png"
          alt="Goal Zero"
          className="h-14 mx-auto mb-4"
        />
        <h1 className="text-[1.6rem] font-bold tracking-tight mb-2">
          {'{{APP_DISPLAY_NAME}}'}
        </h1>
        {env && (
          <div
            className="inline-block px-3 py-0.5 text-[0.6rem] font-semibold uppercase tracking-widest rounded mb-2"
            style={{ backgroundColor: env.color, color: 'var(--text-inverse)' }}
          >
            {env.name}
          </div>
        )}
        <p className="text-text-secondary text-[0.9rem]">
          Sign in with your Goal Zero account
        </p>
      </div>

      <button
        onClick={startGoogleLogin}
        className="px-7 py-2.5 text-[0.9rem] font-semibold bg-gz-green text-text-inverse rounded-lg border-none cursor-pointer transition-all hover:shadow-[0_0_20px_rgba(191,210,43,0.3)]"
      >
        Sign in with Google
      </button>

      <p className="text-text-tertiary text-[0.75rem] text-center max-w-xs">
        Access restricted to @bioliteenergy.com and @goalzero.com accounts
      </p>
    </div>
  );
}
