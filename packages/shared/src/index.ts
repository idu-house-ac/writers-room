// Types and rules shared by the server and the web app.
// The server is the source of truth for permissions; the web only hides what a role cannot do.

export const ROLES = ['owner', 'writer', 'commenter', 'reader'] as const;
export type Role = (typeof ROLES)[number];

export const FORMAT_PROFILES = ['feature', 'tv_single', 'tv_multi'] as const;
export type FormatProfileId = (typeof FORMAT_PROFILES)[number];

export const FORMAT_LABELS: Record<FormatProfileId, string> = {
  feature: 'Feature',
  tv_single: 'Single-camera TV',
  tv_multi: 'Multi-camera TV',
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  writer: 'Writer',
  commenter: 'Commenter',
  reader: 'Reader',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Everything, including inviting people, changing roles and archiving the project.',
  writer: 'Edit the script, cards, title page and notes. Comment, name drafts, restore versions.',
  commenter: 'Read and comment. Cannot change the script.',
  reader: 'Read and export only.',
};

// Every row of the "Who can do what" table in BRIEF.md.
export const ACTIONS = [
  'read',
  'export',
  'comment',
  'edit',
  'name_draft',
  'restore_version',
  'duplicate',
  'manage_members',
  'archive',
] as const;
export type Action = (typeof ACTIONS)[number];

export const PERMISSIONS: Record<Action, readonly Role[]> = {
  read: ['owner', 'writer', 'commenter', 'reader'],
  export: ['owner', 'writer', 'commenter', 'reader'],
  comment: ['owner', 'writer', 'commenter'],
  edit: ['owner', 'writer'],
  name_draft: ['owner', 'writer'],
  restore_version: ['owner', 'writer'],
  duplicate: ['owner', 'writer'],
  manage_members: ['owner'],
  archive: ['owner'],
};

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return PERMISSIONS[action].includes(role);
}

// Fixed presence colours, assigned round-robin when an account is created.
// Chosen to read on the dark chrome and to be distinct from the gold accent.
export const PRESENCE_COLOURS = [
  '#5BA8F5', // blue
  '#F26B8A', // rose
  '#4FC48B', // green
  '#B785F2', // violet
  '#F08A4B', // orange
  '#3FC7C4', // teal
  '#E85DBF', // magenta
  '#9BC53D', // lime
] as const;

// ---- API payload shapes ----

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  colour: string;
}

export interface CurrentUser extends UserSummary {
  createdAt: string;
}

export interface MemberSummary extends UserSummary {
  role: Role;
  addedAt: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  formatProfile: FormatProfileId;
  myRole: Role;
  pageCount: number | null; // null until the project has a script (M1)
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  lastEditedBy: UserSummary | null;
  members: MemberSummary[];
}

export interface InviteSummary {
  id: string;
  email: string;
  role: Role;
  invitedBy: UserSummary;
  createdAt: string;
  expiresAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  invites: InviteSummary[]; // only filled for owners
}

export interface InvitePreview {
  email: string;
  role: Role;
  project: { id: string; title: string };
  invitedBy: { name: string };
  accountExists: boolean;
  expired: boolean;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export * from './format/elements';
export * from './format/feature';
export * from './format/profiles';
export * from './format/wrap';
export * from './format/pagination';
export * from './format/script';
