import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { ensureSecrets } from './ensure-secrets.js';

async function bootstrap() {
  ensureSecrets();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, credentials: true });
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
