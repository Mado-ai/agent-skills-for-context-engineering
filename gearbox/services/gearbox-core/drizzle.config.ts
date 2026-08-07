import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://gearbox:gearbox@localhost:5432/gearbox',
  },
  verbose: true,
  strict: true,
} satisfies Config;
