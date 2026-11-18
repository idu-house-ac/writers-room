import type { Config } from './config';
import type { Db } from './db';
import { createUser, findUserByEmail } from './users';

/**
 * Accounts are invite-only, so the very first Owner is created from environment variables on start.
 * Does nothing when the account already exists or the variables are unset.
 */
export async function bootstrapOwner(db: Db, config: Config, log: (msg: string) => void): Promise<void> {
  const { BOOTSTRAP_OWNER_EMAIL: email, BOOTSTRAP_OWNER_PASSWORD: password } = config;
  if (!email || !password) return;
  if (await findUserByEmail(db, email)) return;
  if (password.length < 8) {
    log(`Not creating bootstrap owner ${email}: BOOTSTRAP_OWNER_PASSWORD must be at least 8 characters.`);
    return;
  }
  await createUser(db, { email, name: config.BOOTSTRAP_OWNER_NAME ?? 'Owner', password });
  log(`Created first account ${email}. Sign in and invite the rest of the team from a project's Share dialog.`);
}
