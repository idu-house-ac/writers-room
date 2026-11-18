import { z } from 'zod';

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  COOKIE_SECURE: boolish.optional(),

  // Mail. SMTP when SMTP_HOST is set; otherwise emails are printed to the server log.
  MAIL_TRANSPORT: z.enum(['smtp', 'console', 'memory']).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: boolish.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Writers Room <writers-room@localhost>'),

  // First account, created on start if missing. Accounts are invite-only otherwise.
  BOOTSTRAP_OWNER_EMAIL: z.string().optional(),
  BOOTSTRAP_OWNER_NAME: z.string().optional(),
  BOOTSTRAP_OWNER_PASSWORD: z.string().optional(),

  // Serve a built web app from this folder (production). Unset in development.
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof schema> & { cookieSecure: boolean; mailTransport: 'smtp' | 'console' | 'memory' };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid configuration:\n  ${issues}`);
  }
  const c = parsed.data;
  return {
    ...c,
    cookieSecure: c.COOKIE_SECURE ?? c.APP_ORIGIN.startsWith('https://'),
    mailTransport: c.MAIL_TRANSPORT ?? (c.SMTP_HOST ? 'smtp' : 'console'),
  };
}
