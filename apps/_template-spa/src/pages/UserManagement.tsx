import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { hasPermission } from '../lib/permissions';
import { getUser } from '../lib/auth';
import type { AppRole } from '../lib/types';

interface PortalUser {
  email: string;
  name?: string;
  role: AppRole;
  status: string;
  invitedBy: string;
  invitedAt: string;
  lastLoginAt?: string;
}

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  admin: { bg: 'var(--gz-green-dim)', text: 'var(--gz-green)', border: 'rgba(191,210,43,0.15)' },
  user: { bg: 'var(--blue-dim)', text: 'var(--blue)', border: 'rgba(28,154,214,0.15)' },
};

const ROLES: AppRole[] = ['user', 'admin'];

export function UserManagement() {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('user');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const currentUser = getUser();

  if (!hasPermission('portal:user:read')) {
    return (
      <div className="page-padding">
        <div className="flex flex-col items-center justify-center py-24 text-text-tertiary">
          <div className="text-[1.1rem] font-semibold mb-2">Access Denied</div>
          <p className="text-[0.85rem]">You do not have permission to view this page.</p>
        </div>
      </div>
    );
  }

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await api.listUsers();
      setUsers(data.users as PortalUser[]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    try {
      await api.inviteUser(inviteEmail, inviteRole);
      setInviteEmail('');
      setShowInvite(false);
      loadUsers();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRoleChange = async (email: string, newRole: AppRole) => {
    try {
      await api.setUserRole(email, newRole);
      loadUsers();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async (email: string) => {
    setConfirmDelete(null);
    try {
      await api.removeUser(email);
      loadUsers();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const canManage = hasPermission('portal:user:write');

  return (
    <div className="page-padding" style={{ maxWidth: 1000 }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[1.4rem] font-bold tracking-tight">Users</h1>
          <p className="text-[0.78rem] text-text-tertiary mt-0.5">
            Manage who can access this application
          </p>
        </div>
        {hasPermission('portal:user:invite') && (
          <button
            onClick={() => setShowInvite(!showInvite)}
            className="px-4 py-2 text-[0.78rem] font-semibold rounded-md bg-gz-green text-text-inverse border border-gz-green cursor-pointer transition-all hover:shadow-[0_0_12px_rgba(191,210,43,0.2)]"
          >
            + Add User
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center justify-between px-4 py-3 mb-4 rounded-lg bg-[var(--red-dim)] border border-[rgba(255,83,29,0.2)] text-accent-red text-[0.85rem]">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="bg-transparent border-none text-accent-red cursor-pointer text-[0.85rem]"
          >
            x
          </button>
        </div>
      )}

      {/* Invite form */}
      {showInvite && (
        <div className="flex items-end gap-3 p-6 mb-4 rounded-xl bg-surface-card border border-white/[0.06]">
          <div className="flex-1">
            <label className="block text-[0.72rem] text-text-tertiary mb-1">Email</label>
            <input
              type="email"
              placeholder="user@bioliteenergy.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleInvite(); }}
              className="w-full px-3 py-2 text-[0.85rem] font-mono bg-[var(--bg-input)] border border-white/[0.06] rounded-md text-text-primary outline-none focus:border-[var(--border-focus)] focus:bg-[var(--bg-input-focus)] transition-colors"
            />
          </div>
          <div>
            <label className="block text-[0.72rem] text-text-tertiary mb-1">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as AppRole)}
              className="px-3 py-2 text-[0.85rem] bg-[var(--bg-input)] border border-white/[0.06] rounded-md text-text-primary outline-none"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            onClick={handleInvite}
            className="px-4 py-2 text-[0.78rem] font-semibold rounded-md bg-gz-green text-text-inverse border border-gz-green cursor-pointer"
          >
            Add
          </button>
        </div>
      )}

      {/* Users table */}
      <div className="rounded-xl bg-surface-card border border-white/[0.06] overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-text-tertiary">Loading...</div>
        ) : users.length === 0 ? (
          <div className="py-12 text-center text-text-tertiary">No users found</div>
        ) : (
          <table>
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left px-6 py-3 text-[0.7rem] font-semibold text-text-tertiary uppercase tracking-wider">User</th>
                <th className="text-left px-6 py-3 text-[0.7rem] font-semibold text-text-tertiary uppercase tracking-wider">Role</th>
                <th className="text-left px-6 py-3 text-[0.7rem] font-semibold text-text-tertiary uppercase tracking-wider">Status</th>
                <th className="text-left px-6 py-3 text-[0.7rem] font-semibold text-text-tertiary uppercase tracking-wider">Invited By</th>
                <th className="text-left px-6 py-3 text-[0.7rem] font-semibold text-text-tertiary uppercase tracking-wider">Last Login</th>
                {canManage && (
                  <th className="text-right px-6 py-3 text-[0.7rem] font-semibold text-text-tertiary uppercase tracking-wider">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isYou = u.email === currentUser?.email;
                const roleStyle = ROLE_COLORS[u.role] || ROLE_COLORS.user;
                return (
                  <tr
                    key={u.email}
                    className="border-b border-white/[0.04] last:border-b-0"
                    style={{ opacity: u.status === 'disabled' ? 0.4 : 1 }}
                  >
                    <td className="px-6 py-4">
                      <div className="text-[0.85rem] font-medium">{u.name || u.email}</div>
                      <div className="text-[0.72rem] text-text-tertiary font-mono">{u.email}</div>
                    </td>
                    <td className="px-6 py-4">
                      {canManage && !isYou ? (
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.email, e.target.value as AppRole)}
                          className="px-2 py-1 text-[0.7rem] bg-[var(--bg-input)] border border-white/[0.06] rounded text-text-primary outline-none"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[0.6rem] font-semibold uppercase tracking-wide"
                          style={{
                            background: roleStyle.bg,
                            color: roleStyle.text,
                            border: `1px solid ${roleStyle.border}`,
                          }}
                        >
                          {u.role}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-[0.78rem] text-text-secondary capitalize">
                      {u.status}
                    </td>
                    <td className="px-6 py-4 text-[0.72rem] text-text-tertiary font-mono">
                      {u.invitedBy}
                    </td>
                    <td className="px-6 py-4 text-[0.72rem] text-text-tertiary">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                    </td>
                    {canManage && (
                      <td className="px-6 py-4 text-right">
                        {isYou ? (
                          <span className="text-[0.7rem] text-text-tertiary">You</span>
                        ) : confirmDelete === u.email ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleDelete(u.email)}
                              className="px-2 py-1 text-[0.65rem] font-medium rounded bg-accent-red text-white border-none cursor-pointer"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="px-2 py-1 text-[0.65rem] font-medium rounded bg-surface-elevated text-text-primary border border-white/[0.06] cursor-pointer"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(u.email)}
                            title="Remove user"
                            className="bg-transparent border-none cursor-pointer text-text-tertiary text-[0.82rem] px-2 py-1 hover:text-accent-red transition-colors"
                          >
                            x
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
