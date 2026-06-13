/**
 * Typed accessors and domain operations over the app-owned store. Routes use
 * these instead of touching the KV client directly. Everything here is state
 * THIS app owns (charter §3.5 KV escape hatch); platform data goes through
 * `../platform/`.
 */
import { randomUUID } from 'node:crypto';
import { ensureSeeded, typedTable } from './client.js';
import type {
  AccessLogEntry,
  AccessRequest,
  AppNotification,
  AppUser,
  Program,
} from './types.js';
import type { AppJwtPayload } from '../auth/types.js';

export const users = () => typedTable<AppUser>((t) => t.users);
export const requests = () => typedTable<AccessRequest>((t) => t.requests);
export const notifications = () => typedTable<AppNotification>((t) => t.notifications);
export const programs = () => typedTable<Program>((t) => t.programs);
export const accessLog = () => typedTable<AccessLogEntry>((t) => t.accessLog);

/** Call before any store read so memory mode is seeded lazily (no-op in dynamo). */
export { ensureSeeded };

export const newId = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`;

// ── Notifications ─────────────────────────────────────────────
/** `to` is a user email or the literal 'admins' (fans out to all admins). */
export async function addNotification(to: string, text: string, href?: string): Promise<void> {
  await notifications().put({ id: newId('n'), to, text, at: new Date().toISOString(), read: false, href });
}

export async function notificationsFor(user: AppJwtPayload): Promise<AppNotification[]> {
  const all = await notifications().list();
  return all
    .filter((n) => n.to === user.email || (n.to === 'admins' && user.role === 'admin'))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

export async function markNotificationsRead(user: AppJwtPayload): Promise<void> {
  const mine = await notificationsFor(user);
  await Promise.all(mine.filter((n) => !n.read).map((n) => notifications().put({ ...n, read: true })));
}

// ── Access log ────────────────────────────────────────────────
export async function addAccessLog(actor: string, action: string, detail: string): Promise<void> {
  await accessLog().put({ id: newId('log'), at: new Date().toISOString(), actor, action, detail });
}

export async function recentAccessLog(limit = 12): Promise<AccessLogEntry[]> {
  const all = await accessLog().list();
  return all.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}
