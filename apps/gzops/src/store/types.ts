import type { AppRole } from '../auth/types.js';

/** Allow-list row. Approval creates one; removal deletes it. */
export interface AppUser {
  email: string;
  name: string | null;
  role: AppRole;
  status: 'active' | 'disabled';
  addedBy: string;
  addedAt: string;
  googleSub?: string;
  lastLoginAt?: string;
}

/** Self-service access request (403 gate → request → admin decision). */
export interface AccessRequest {
  id: string;
  email: string;
  name: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'denied';
  decidedBy?: string;
  decidedAt?: string;
}

/** In-app bell notification. `to` is a user email or the literal 'admins'. */
export interface AppNotification {
  id: string;
  to: string;
  text: string;
  at: string;
  read: boolean;
  /** Optional deep link rendered in the bell menu. */
  href?: string;
}

/** One section of a program dashboard: a project plus the facets to render. */
export interface ProgramSection {
  projectId: string;
  facets: string[];
}

/**
 * Program — a curated product-line view composed from platform projects.
 * NEW concept (not in the old webapp); owned by this app in its own DynamoDB
 * table rather than a platform endpoint (recorded decision — see README).
 */
export interface Program {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: 'draft' | 'published';
  version: number;
  updatedBy: string;
  updatedAt: string;
  sections: ProgramSection[];
}

/** Append-only access log entry (who approved/denied/changed what). */
export interface AccessLogEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}
