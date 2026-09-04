import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { DatabaseService } from '../src/db/database.service.js';
import { makeTestDb } from './helpers/db.js';

describe('Auth + dashboard (e2e)', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    // Keep the suite self-contained: throwaway secrets and an in-memory (pg-mem) database.
    process.env.JWT_SECRET = 'e2e-secret';
    process.env.ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useFactory({ factory: () => makeTestDb() })
      .compile();

    // Mirror the real bootstrap (main.ts) so the HTTP stack behaves like production.
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    app.useStaticAssets(process.env.STATIC_DIR ?? 'nonexistent');
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the health check and the built SPA', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200).expect({ status: 'ok' });
    const root = await request(app.getHttpServer()).get('/').expect(200);
    expect(root.text.toLowerCase()).toContain('<!doctype html');
  });

  it('rejects an unauthenticated request to a protected route', () => {
    return request(app.getHttpServer()).get('/api/dashboard').expect(401);
  });

  it('lets a registered user reach their (empty) dashboard via the session cookie', async () => {
    const agent = request.agent(app.getHttpServer());

    const register = await agent
      .post('/api/auth/register')
      .send({ email: 'e2e@x.com', password: 'password123' });
    expect(register.status).toBe(201);
    expect(register.headers['set-cookie']?.[0]).toMatch(/pv_session=/);

    const dashboard = await agent.get('/api/dashboard').expect(200);
    expect(dashboard.body.totals.games).toBe(0);
    expect(dashboard.body.backlogCount).toBe(0);
  });
});
