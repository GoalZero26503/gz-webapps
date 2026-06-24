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

/** Result of one repo's milestone upsert during a sync. */
export interface MilestoneRepoRef {
  repo: string;
  number: number;
  url: string;
}

/**
 * A release milestone defined on a program (e.g. "R7"). Synced to GitHub via the
 * platform: the milestone is upserted across all member repos and a `Release`-type
 * issue is maintained in the kit repo. Sync results are stamped back here.
 */
export interface ProgramMilestone {
  /** Stable slug derived from the title at creation (the def's id within a program). */
  key: string;
  title: string;
  description: string;
  /** ISO date (YYYY-MM-DD) or null. */
  dueOn: string | null;
  state: 'open' | 'closed';
  /** The kit-repo Release issue, once synced. */
  releaseIssue?: MilestoneRepoRef;
  /** Per-member-repo milestones, from the last sync. */
  repos?: MilestoneRepoRef[];
  /** Set when the title changes after a sync, so the next sync renames in place. */
  renamedFrom?: string;
  /** Last-sync errors (repo → message), if any. */
  syncErrors?: { repo: string; error: string }[];
  syncedAt?: string;
  syncedBy?: string;
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
  /** Release milestones synced to the program's member repos. */
  milestones?: ProgramMilestone[];
}

/** Append-only access log entry (who approved/denied/changed what). */
export interface AccessLogEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}
