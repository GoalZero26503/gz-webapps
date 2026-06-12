import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { AppRole } from '../auth/types.js';

export const users = pgTable('users', {
  email: text('email').primaryKey(),
  name: text('name'),
  role: text('role').$type<AppRole>().notNull().default('user'),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  invitedBy: text('invited_by').notNull(),
  invitedAt: timestamp('invited_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  googleSub: text('google_sub'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'string' }),
});

export type AppUser = typeof users.$inferSelect;
