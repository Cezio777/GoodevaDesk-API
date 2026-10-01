import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AiService } from '../src/ai/ai.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const keyA = `test_${randomUUID()}`;
  const keyB = `test_${randomUUID()}`;
  let orgAId = '';
  let orgBId = '';
  let ticketAId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiService)
      .useValue({ analyzeTicket: async () => ({ category: 'general', suggested_reply: 'Terima kasih.' }) })
      .overrideProvider(RedisService)
      .useValue({ get: async () => null, set: async () => undefined })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    const orgA = await prisma.organization.create({ data: { name: 'Org A (test)', api_key: keyA } });
    const orgB = await prisma.organization.create({ data: { name: 'Org B (test)', api_key: keyB } });
    orgAId = orgA.id;
    orgBId = orgB.id;

    const res = await request(app.getHttpServer())
      .post('/tickets')
      .set('x-api-key', keyA)
      .send({ customer_email: 'a@example.com', subject: 'Tagihan ganda', message: 'Saya ditagih dua kali' })
      .expect(201);
    ticketAId = res.body.id;
  });

  afterAll(async () => {
    await prisma.ticket.deleteMany({ where: { organization_id: { in: [orgAId, orgBId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
    await app.close();
  });

  it('menolak request tanpa atau dengan API key salah (401)', async () => {
    await request(app.getHttpServer()).get('/tickets').expect(401);
    await request(app.getHttpServer()).get('/tickets').set('x-api-key', 'salah').expect(401);
  });

  it('org A melihat tiketnya sendiri', async () => {
    const res = await request(app.getHttpServer()).get(`/tickets/${ticketAId}`).set('x-api-key', keyA).expect(200);
    expect(res.body.organization_id).toBe(orgAId);
  });

  it('org B tidak bisa membaca tiket org A (404)', async () => {
    await request(app.getHttpServer()).get(`/tickets/${ticketAId}`).set('x-api-key', keyB).expect(404);
  });

  it('org B tidak bisa mengubah status tiket org A (404) dan status tetap open', async () => {
    await request(app.getHttpServer())
      .patch(`/tickets/${ticketAId}/status`)
      .set('x-api-key', keyB)
      .send({ status: 'closed' })
      .expect(404);

    const res = await request(app.getHttpServer()).get(`/tickets/${ticketAId}`).set('x-api-key', keyA).expect(200);
    expect(res.body.status).toBe('open');
  });

  it('list tiket org B tidak memuat tiket org A', async () => {
    const res = await request(app.getHttpServer()).get('/tickets').set('x-api-key', keyB).expect(200);
    expect(res.body.data.map((t: { id: string }) => t.id)).not.toContain(ticketAId);
  });

  it('validasi input mengembalikan 400, bukan 500', async () => {
    await request(app.getHttpServer()).get('/tickets?status=ngawur').set('x-api-key', keyA).expect(400);
    await request(app.getHttpServer()).get('/tickets/bukan-uuid').set('x-api-key', keyA).expect(400);
    await request(app.getHttpServer())
      .patch(`/tickets/${ticketAId}/status`)
      .set('x-api-key', keyA)
      .send({ status: 'ngawur' })
      .expect(400);
  });
});