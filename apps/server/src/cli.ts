// Small admin CLI. Usage:
//   pnpm cli create-user --email a@b.c --name "Ada" --password secret123
//   pnpm cli set-password --email a@b.c --password newsecret
//   pnpm cli list-users
import { parseArgs } from 'node:util';
import { hashPassword } from './auth/password';
import { loadConfig } from './config';
import { createDb, migrate } from './db';
import { createUser, findUserByEmail, normaliseEmail } from './users';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { email: { type: 'string' }, name: { type: 'string' }, password: { type: 'string' } },
});
const command = positionals[0];
const config = loadConfig();
const db = createDb(config.DATABASE_URL);
await migrate(db);

try {
  switch (command) {
    case 'create-user': {
      if (!values.email || !values.name || !values.password) throw new Error('create-user needs --email, --name and --password');
      if (values.password.length < 8) throw new Error('Password must be at least 8 characters');
      if (await findUserByEmail(db, values.email)) throw new Error(`An account for ${values.email} already exists`);
      const user = await createUser(db, { email: values.email, name: values.name, password: values.password });
      console.log(`Created ${user.email} (${user.id})`);
      break;
    }
    case 'set-password': {
      if (!values.email || !values.password) throw new Error('set-password needs --email and --password');
      if (values.password.length < 8) throw new Error('Password must be at least 8 characters');
      const { rowCount } = await db.query('update users set password_hash = $2 where email = $1', [
        normaliseEmail(values.email),
        await hashPassword(values.password),
      ]);
      if (!rowCount) throw new Error(`No account for ${values.email}`);
      await db.query('delete from sessions where user_id = (select id from users where email = $1)', [normaliseEmail(values.email)]);
      console.log(`Password updated for ${values.email}; existing sessions signed out.`);
      break;
    }
    case 'list-users': {
      const { rows } = await db.query<{ email: string; name: string; created_at: Date }>('select email, name, created_at from users order by created_at');
      for (const r of rows) console.log(`${r.email}\t${r.name}\t${r.created_at.toISOString()}`);
      if (!rows.length) console.log('No accounts yet.');
      break;
    }
    default:
      console.log('Commands: create-user, set-password, list-users');
  }
} finally {
  await db.end();
}
