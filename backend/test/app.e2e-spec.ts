import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('Auth + dashboard (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    // Keep the suite self-contained: in-memory DB and throwaway secrets.
    process.env.DATABASE_PATH = ':memory:';
    process.env.JWT_SECRET = 'e2e-secret';
    process.env.ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Mirror the real bootstrap (main.ts) so the HTTP stack behaves like production.
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
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
