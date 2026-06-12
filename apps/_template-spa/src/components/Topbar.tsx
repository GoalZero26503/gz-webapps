import { useRef, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getUser, clearAuth } from '../lib/auth';
import { hasPermission } from '../lib/permissions';

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

export function Topbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = getUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const initial = user?.name ? user.name.charAt(0).toUpperCase() : '?';
  const env = getEnvironment();

  const handleLogout = () => {
    clearAuth();
    navigate('/login');
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const navLinkClass = (path: string) => {
    const isActive = location.pathname === path;
    return `px-3 py-1.5 rounded-md text-[0.82rem] font-medium transition-colors ${
      isActive
        ? 'text-[var(--gz-green)] bg-[var(--gz-green-dim)]'
        : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
    }`;
  };

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between h-14 px-6 bg-surface-primary border-b border-white/5">
      {/* Left: logo + nav */}
      <div className="flex items-center gap-6">
        <Link to="/" className="flex items-center gap-2.5 text-text-primary no-underline">
          <img src="/gz-logo-white.png" alt="Goal Zero" className="h-6" />
          <span className="text-[0.92rem] font-semibold tracking-tight">
            {'{{APP_DISPLAY_NAME}}'}
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link to="/" className={navLinkClass('/')}>Home</Link>
          {hasPermission('portal:user:read') && (
            <Link to="/settings" className={navLinkClass('/settings')}>Settings</Link>
          )}
        </nav>
      </div>

      {/* Right: env badge + user */}
      <div className="flex items-center gap-3">
        {env && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] text-[0.65rem] font-semibold uppercase tracking-widest">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: env.color }}
            />
            <span style={{ color: env.color }}>{env.name}</span>
          </div>
        )}

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 px-2 py-1 rounded-md transition-colors hover:bg-white/[0.04]"
            title="Account menu"
          >
            <span className="text-[0.82rem] text-text-secondary hidden sm:inline">
              {user?.name || 'User'}
            </span>
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--gz-green-dim)] text-[var(--gz-green)] text-[0.72rem] font-bold">
              {initial}
            </span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-lg bg-surface-elevated border border-white/[0.06] shadow-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.04]">
                <div className="text-[0.85rem] font-medium text-text-primary">{user?.name || 'Unknown'}</div>
                <div className="text-[0.72rem] text-text-tertiary font-mono">{user?.email || ''}</div>
                <span className="inline-block mt-1.5 px-2 py-0.5 rounded text-[0.6rem] font-semibold uppercase tracking-wide bg-[var(--gz-green-dim)] text-[var(--gz-green)]">
                  {user?.role || 'user'}
                </span>
              </div>
              <div className="py-1">
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2.5 text-[0.82rem] text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
