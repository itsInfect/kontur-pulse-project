import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL;
if (!databaseUrl) {
  throw new Error('Configure DATABASE_URL or connect a Postgres integration before deploying the backend');
}

const env = { ...process.env, DATABASE_URL: databaseUrl };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const script of ['db:generate', 'db:deploy', 'build']) {
  const result = spawnSync(npm, ['run', script], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
