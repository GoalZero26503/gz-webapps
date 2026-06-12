import type { AuthUser, StoredAuth } from './types';

const API_URL = import.meta.env.VITE_API_URL || '';
const STORAGE_KEY = '{{APP_NAME}}_auth';

export function getStoredAuth(): StoredAuth | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredAuth(auth: StoredAuth): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

export function clearAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function isAuthenticated(): boolean {
  const auth = getStoredAuth();
  if (!auth?.token) return false;
  try {
    const payload = JSON.parse(atob(auth.token.split('.')[1]));
    return payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function getToken(): string | null {
  return getStoredAuth()?.token || null;
}

export function getUser(): AuthUser | null {
  return getStoredAuth()?.user || null;
}

export async function startGoogleLogin(): Promise<void> {
  const redirectUri = `${window.location.origin}/auth/callback`;

  // Generate PKCE code verifier
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  sessionStorage.setItem('pkce_verifier', verifier);

  // Generate code challenge (S256)
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch(`${API_URL}/auth/google/redirect?redirect_uri=${encodeURIComponent(redirectUri)}`);
  const { authorization_url } = await res.json();

  // Append PKCE challenge to Google OAuth URL
  const url = new URL(authorization_url);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  window.location.href = url.toString();
}

export async function exchangeCode(code: string): Promise<StoredAuth> {
  const redirectUri = `${window.location.origin}/auth/callback`;
  const codeVerifier = sessionStorage.getItem('pkce_verifier');

  const res = await fetch(`${API_URL}/auth/google/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Login failed');
  }

  const data = await res.json();
  sessionStorage.removeItem('pkce_verifier');

  const auth: StoredAuth = {
    token: data.token,
    refreshToken: data.refresh_token,
    user: data.user,
  };
  setStoredAuth(auth);
  return auth;
}

export async function refreshToken(): Promise<boolean> {
  const auth = getStoredAuth();
  if (!auth?.refreshToken) return false;

  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: auth.refreshToken }),
    });

    if (!res.ok) return false;

    const data = await res.json();
    const payload = JSON.parse(atob(data.token.split('.')[1]));
    setStoredAuth({
      ...auth,
      token: data.token,
      user: {
        email: payload.email,
        name: payload.name,
        role: payload.role,
        permissions: payload.permissions,
      },
    });
    return true;
  } catch {
    return false;
  }
}
