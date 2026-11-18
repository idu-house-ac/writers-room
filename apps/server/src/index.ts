import { buildApp } from './app';
import { bootstrapOwner } from './bootstrap';
import { loadConfig } from './config';
import { createDb, migrate } from './db';
import { createMailer } from './mail';
import { createCollabServer } from './collab';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

// Wait for the database (Docker Compose may start us a moment before Postgres accepts connections).
for (let attempt = 1; ; attempt++) {
  try {
    await db.query('select 1');
    break;
  } catch (err) {
    if (attempt >= 30) throw err;
    console.log(`Database not ready (${(err as Error).message}); retrying...`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const applied = await migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

const collab = createCollabServer({ config, db });
const app = await buildApp({ config, db, mailer: createMailer(config, (m) => app.log.info(m)), rateLimit: true, collab });
await bootstrapOwner(db, config, (m) => app.log.info(m));

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info('Collaboration WebSocket mounted at /collab');
app.log.info(`Mail transport: ${config.mailTransport}${config.SMTP_HOST ? ` (${config.SMTP_HOST}:${config.SMTP_PORT})` : ''}`);

const shutdown = async () => {
  collab.closeConnections();
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
