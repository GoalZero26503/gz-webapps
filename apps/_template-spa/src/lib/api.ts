import type { AppRole } from './types';
import { getToken, refreshToken, clearAuth } from './auth';

const API_URL = import.meta.env.VITE_API_URL || '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res = await fetch(`${API_URL}${path}`, { ...init, headers });

  // Auto-refresh on 401
  if (res.status === 401 && token) {
    const refreshed = await refreshToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getToken()}`;
      res = await fetch(`${API_URL}${path}`, { ...init, headers });
    } else {
      clearAuth();
      window.location.href = '/login';
      throw new Error('Session expired');
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  listUsers: () =>
    apiFetch<{ users: unknown[] }>('/portal/users'),

  inviteUser: (email: string, role: AppRole) =>
    apiFetch<{ user: unknown }>('/portal/users', {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  setUserRole: (email: string, role: AppRole) =>
    apiFetch<{ email: string; role: string }>(`/portal/users/${encodeURIComponent(email)}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),

  removeUser: (email: string) =>
    apiFetch<{ email: string; status: string }>(`/portal/users/${encodeURIComponent(email)}`, {
      method: 'DELETE',
    }),
};
