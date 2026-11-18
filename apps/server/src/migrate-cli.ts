import { loadConfig } from './config';
import { createDb, migrate } from './db';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const applied = await migrate(db);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
await db.end();
