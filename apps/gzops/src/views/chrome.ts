/**
 * Builds the per-request page chrome: top-nav areas, the area-scoped sidebar,
 * and the notification bell. Routes spread the result into their view context
 * so `layout.eta` can render the shell. Mirrors the prototype IA: two areas for
 * everyone (Dashboard | CI/CD) plus Admin for user managers.
 */
import type { FastifyRequest } from 'fastify';
import { platform } from '../platform/client.js';
import { ensureSeeded, notificationsFor, programs as programsTable } from '../store/repo.js';
import type { AppNotification } from '../store/types.js';
import { programHealth } from './helpers.js';

export type Area = 'dashboard' | 'cicd' | 'admin';

export interface NavItem {
  key: string;
  label: string;
  icon: string;
  href: string;
  /** Health dot class for dashboard program links: 'ok' | 'info' | 'err'. */
  health?: string;
}

export interface NavGroup {
  heading?: string;
  items: NavItem[];
}

export interface AreaTab {
  key: Area;
  label: string;
  href: string;
}

export interface PageChrome {
  user: FastifyRequest['user'];
  area: Area;
  active: string;
  areaTabs: AreaTab[];
  sidebar: NavGroup[];
  unread: number;
  notifs: AppNotification[];
  /** Backend build identity for the sidebar footer; null if unreachable. */
  backend: { version?: string; gitSha?: string } | null;
}

const CICD_SIDEBAR: NavGroup[] = [
  {
    items: [
      { key: 'programs', label: 'Programs', icon: 'icon-box', href: '/cicd/programs' },
      { key: 'projects', label: 'Projects', icon: 'icon-folder-git-2', href: '/cicd/projects' },
      { key: 'environments', label: 'Environments', icon: 'icon-layers', href: '/cicd/environments' },
      { key: 'deployments', label: 'Deployments', icon: 'icon-rocket', href: '/cicd/deployments' },
      { key: 'access-groups', label: 'Access Groups', icon: 'icon-users-round', href: '/cicd/access-groups' },
    ],
  },
];

const ADMIN_SIDEBAR: NavGroup[] = [
  { items: [{ key: 'users', label: 'Users & Access', icon: 'icon-shield', href: '/admin/users' }] },
];

export async function chrome(request: FastifyRequest, area: Area, active: string): Promise<PageChrome> {
  await ensureSeeded();
  const user = request.user!;
  const [notifs, backend] = await Promise.all([notificationsFor(user), platform.serviceHealth()]);
  const unread = notifs.filter((n) => !n.read).length;

  const areaTabs: AreaTab[] = [
    { key: 'dashboard', label: 'Dashboard', href: '/' },
    { key: 'cicd', label: 'CI/CD', href: '/cicd/programs' },
  ];
  if (user.permissions.includes('users:read')) {
    areaTabs.push({ key: 'admin', label: 'Admin', href: '/admin/users' });
  }

  let sidebar: NavGroup[] = [];
  if (area === 'dashboard') {
    const [progs, projects] = await Promise.all([programsTable().list(), platform.listProjects()]);
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
    const canEdit = user.permissions.includes('programs:write');
    const items: NavItem[] = progs
      .filter((p) => p.status === 'published' || canEdit)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((pr) => {
        const h = programHealth(pr.sections, byId);
        return { key: pr.id, label: pr.name, icon: 'icon-box', href: `/dashboard/${pr.id}`, health: h.failed ? 'err' : h.deploying ? 'info' : 'ok' };
      });
    sidebar = [
      { items: [{ key: 'overview', label: 'Overview', icon: 'icon-layout-dashboard', href: '/' }] },
      { heading: 'Programs', items },
    ];
  } else if (area === 'cicd') {
    sidebar = CICD_SIDEBAR;
  } else {
    sidebar = ADMIN_SIDEBAR;
  }

  return { user, area, active, areaTabs, sidebar, unread, notifs, backend };
}
