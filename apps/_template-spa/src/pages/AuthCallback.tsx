import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { exchangeCode } from '../lib/auth';

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setError('No authorization code received');
      return;
    }

    exchangeCode(code)
      .then(() => navigate('/', { replace: true }))
      .catch((err) => setError(err.message));
  }, [searchParams, navigate]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <div className="text-accent-red text-[1.1rem] font-semibold">
          Login Failed
        </div>
        <div className="text-text-secondary max-w-[400px] text-center">
          {error}
        </div>
        <button
          onClick={() => navigate('/login')}
          className="px-5 py-2 text-[0.85rem] bg-surface-elevated text-text-primary border border-white/[0.06] rounded-md cursor-pointer mt-2 transition-colors hover:bg-surface-card-hover"
        >
          Back to Login
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen text-text-secondary">
      Signing in...
    </div>
  );
}
