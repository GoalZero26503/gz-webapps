/**
 * Local-dev demo seed for the app-owned store (memory mode only). Mirrors the
 * prototype's seed (`ui-prototype/js/data.js`): astout pre-seeded as the only
 * admin, one pending request from Priya so the admin queue isn't empty, and the
 * curated programs. In AWS the DynamoDB tables start empty and the
 * SEED_ADMIN_EMAIL bootstrap (auth/google.ts) creates the first admin on login.
 */
import { getConfig } from '../config.js';
import type { AccessLogEntry, AccessRequest, AppNotification, AppUser, Program } from './types.js';
import { typedTable } from './client.js';

const ago = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();
const HOUR = 3_600_000;
const DAY = 86_400_000;

const PROGRAMS: Program[] = [
  { id: 'yeti-pro-4000', name: 'Yeti PRO 4000 (6GXL)', slug: 'yeti-pro-4000', description: 'Complete 6GXL system: kit firmware, cloud, and app', status: 'published', version: 3, updatedBy: 'astout', updatedAt: ago(2 * DAY), sections: [{ projectId: 'yeti-pro-4000-kit', facets: ['channels', 'components'] }, { projectId: 'iot-cloud-backend', facets: ['rail', 'health'] }, { projectId: 'goal-zero-app', facets: ['envs', 'stores', 'groups'] }] },
  { id: 'yeti-1000-1500', name: 'Yeti 1000/1500 (6GMD)', slug: 'yeti-1000-1500', description: 'Medium platform: kit firmware, cloud, and app', status: 'published', version: 1, updatedBy: 'astout', updatedAt: ago(5 * DAY), sections: [{ projectId: 'bms-firmware', facets: ['rail'] }, { projectId: 'iot-cloud-backend', facets: ['rail', 'health'] }, { projectId: 'goal-zero-app', facets: ['envs'] }] },
  { id: 'yeti-mobile-app', name: 'Yeti Mobile App', slug: 'yeti-mobile-app', description: 'The Goal Zero app and the cloud it talks to', status: 'draft', version: 1, updatedBy: 'astout', updatedAt: ago(1 * DAY), sections: [{ projectId: 'goal-zero-app', facets: ['envs', 'stores', 'groups'] }, { projectId: 'iot-cloud-backend', facets: ['rail', 'health'] }] },
  { id: 'yeti-300-500-700', name: 'Yeti 300/500/700 (6GSM)', slug: 'yeti-300-500-700', description: 'Small platform: kit firmware, cloud, and app', status: 'published', version: 2, updatedBy: 'astout', updatedAt: ago(9 * DAY), sections: [{ projectId: 'bms-firmware', facets: ['rail'] }, { projectId: 'iot-cloud-backend', facets: ['rail', 'health'] }] },
  { id: 'yeti-inspector-program', name: 'Yeti Inspector (internal)', slug: 'yeti-inspector', description: 'Service & QA tooling app', status: 'published', version: 1, updatedBy: 'astout', updatedAt: ago(12 * DAY), sections: [{ projectId: 'yeti-inspector', facets: ['envs', 'stores'] }, { projectId: 'iot-cloud-backend', facets: ['rail'] }] },
  { id: 'alta-fridges', name: 'Alta 50/80 Fridges', slug: 'alta-fridges', description: 'Portable fridge firmware + app surface', status: 'published', version: 4, updatedBy: 'astout', updatedAt: ago(20 * DAY), sections: [{ projectId: 'bms-firmware', facets: ['rail'] }, { projectId: 'goal-zero-app', facets: ['envs'] }] },
  { id: 'haven-home-backup', name: 'Haven 10 Home Backup', slug: 'haven-home-backup', description: 'Home integration kit: transfer switch + cloud', status: 'published', version: 2, updatedBy: 'astout', updatedAt: ago(30 * DAY), sections: [{ projectId: 'iot-cloud-backend', facets: ['rail', 'health'] }] },
  { id: 'escape-ecosystem', name: 'Escape Ecosystem', slug: 'escape-ecosystem', description: 'Escape lights & accessories line', status: 'draft', version: 1, updatedBy: 'astout', updatedAt: ago(45 * DAY), sections: [{ projectId: 'bms-firmware', facets: ['rail'] }] },
  { id: 'skylight', name: 'Skylight', slug: 'skylight', description: 'Skylight lamp firmware + app pairing', status: 'published', version: 1, updatedBy: 'astout', updatedAt: ago(60 * DAY), sections: [{ projectId: 'bms-firmware', facets: ['rail'] }, { projectId: 'goal-zero-app', facets: ['envs'] }] },
];

export async function seedMemoryStore(): Promise<void> {
  const admin = getConfig().seedAdminEmail ?? 'astout@bioliteenergy.com';

  const users = typedTable<AppUser>((t) => t.users);
  await users.put({ email: admin, name: 'A. Stout', role: 'admin', status: 'active', addedBy: 'seed', addedAt: ago(11 * DAY) });

  const requests = typedTable<AccessRequest>((t) => t.requests);
  await requests.put({ id: 'req-1', email: 'priya@bioliteenergy.com', name: 'Priya Nair', requestedAt: ago(2 * HOUR), status: 'pending' });

  const notifications = typedTable<AppNotification>((t) => t.notifications);
  await notifications.put({ id: 'n-1', to: 'admins', text: 'Priya Nair requested access', at: ago(2 * HOUR), read: false, href: '/admin/users' });

  const accessLog = typedTable<AccessLogEntry>((t) => t.accessLog);
  await accessLog.put({ id: 'log-1', at: ago(11 * DAY), actor: 'system', action: 'seeded', detail: `${admin} pre-populated as admin` });

  const programs = typedTable<Program>((t) => t.programs);
  for (const p of PROGRAMS) await programs.put(p);
}
