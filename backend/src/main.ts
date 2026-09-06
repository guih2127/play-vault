import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';
import { ensureSecrets } from './ensure-secrets.js';

// The built frontend, resolved relative to this file (works from dist/ and src/). The backend
// serves it so the app and API share one origin (the session cookie is same-origin). Override
// with STATIC_DIR.
const here = dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.STATIC_DIR ?? join(here, '..', '..', 'frontend', 'dist');

async function bootstrap() {
  ensureSecrets();
  const isProd = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  // Serve the built SPA at the root; API routes live under /api and are unaffected.
  app.useStaticAssets(staticDir);
  // SPA fallback: the client uses history-based routing (react-router), so deep links like
  // /users/5 have no matching file on disk. Serve index.html for any non-API GET that the
  // static handler didn't resolve, letting the client router take over.
  app.use((req: import('express').Request, res: import('express').Response, next: () => void) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/docs')) {
      return next();
    }
    res.sendFile(join(staticDir, 'index.html'));
  });
  // Behind a reverse proxy in production: trust it so req.ip is the real client (for rate
  // limiting) and Express knows the connection is HTTPS (for the Secure session cookie).
  if (isProd) app.set('trust proxy', 1);
  // In production only allow the app's own origin to send credentialed requests; reflect any
  // origin in development for convenience.
  app.enableCors({ origin: isProd ? (process.env.APP_URL ?? false) : true, credentials: true });
  app.use(cookieParser());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('PlayVault API')
    .setDescription('Auth, per-user PSN/Steam connections, sync, and the game library.')
    .setVersion('1.0')
    .addCookieAuth('pv_session')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
