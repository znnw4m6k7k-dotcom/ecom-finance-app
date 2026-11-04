import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { MockModelProvider } from '@efa/model-adapters';
import { MockConnector } from '@efa/workspace-connectors';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import { seed } from '../src/seed';

export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgresql://app:app_dev_only@localhost:5432/ecomfin_test?schema=public';

export async function bootTestApp() {
  process.env.DATABASE_URL = TEST_DB;
  execSync('npx prisma migrate deploy', { cwd: path.join(__dirname, '..'), env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: 'pipe' });
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
  await seed(prisma, { reset: true, passwords: { owner: 'owner-pass-1', finance: 'finance-pass-1', viewer: 'viewer-pass-1' } });
  const model = new MockModelProvider('ok');
  const connector = new MockConnector();
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DB, JWT_SECRET: 'test-secret-0123456789', PUBLIC_BASE_URL: 'http://localhost:3000' });
  const app = await createApp({ config, model, connector }, { logger: false });
  await app.init();
  return { app, prisma, model, connector };
}
