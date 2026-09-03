import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { ensureSecrets } from './ensure-secrets.js';

async function bootstrap() {
  ensureSecrets();
  const isProd = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
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
