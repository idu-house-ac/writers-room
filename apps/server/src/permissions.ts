// Server-side enforcement of every row in the permissions table. Routes call these; the UI only hides buttons.
import { can, type Action, type Role } from '@writers-room/shared';
import type { Queryable } from './db';
import { forbidden, notFound } from './errors';

export async function getRole(db: Queryable, projectId: string, userId: string): Promise<Role | null> {
  const { rows } = await db.query<{ role: Role }>(
    'select role from project_members where project_id = $1 and user_id = $2',
    [projectId, userId],
  );
  return rows[0]?.role ?? null;
}

/**
 * Returns the caller's role if it allows the action.
 * Non-members get 404 (so the existence of a project is not revealed); members without permission get 403.
 */
export async function requireAction(db: Queryable, projectId: string, userId: string, action: Action): Promise<Role> {
  const role = await getRole(db, projectId, userId);
  if (!role) throw notFound('Project not found.');
  if (!can(role, action)) throw forbidden();
  return role;
}
