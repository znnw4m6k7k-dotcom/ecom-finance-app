import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ModelProvider } from '@efa/model-adapters';
import type { WorkspaceConnector } from '@efa/workspace-connectors';
import { AppModule } from './app.module';
import { AppConfig } from './config';

export async function createApp(deps: { config: AppConfig; model: ModelProvider; connector: WorkspaceConnector }, opts: { logger?: boolean } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(deps), { logger: opts.logger === false ? false : ['log', 'warn', 'error'] });
  app.setGlobalPrefix('api/v1');
  app.use(compression());
  app.useBodyParser('json', { limit: '2mb' });
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  // 前端静态页面（由 Demo 演进），与 API 同源，避免跨域与令牌泄露
  const webDir = deps.config.WEB_DIR ?? path.resolve(__dirname, '..', '..', 'web', 'src');
  if (fs.existsSync(webDir)) app.useStaticAssets(webDir, { index: 'index.html' });
  return app;
}
