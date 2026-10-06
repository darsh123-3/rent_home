import { NestExpressApplication } from '@nestjs/platform-express';
import pdfParse from 'pdf-parse';
import request from 'supertest';
import { effectiveStatus } from '../src/billing/bills.service';
import { localDateOf, todayLocal } from '../src/common/dates';
import { formatDateLocal } from '../src/common/format';
import { PrismaService } from '../src/common/prisma.service';
import { currentMonth } from '../src/reports/reports.service';
import { createTestApp, createUserAndLogin, resetClock, resetDb, setClock } from './helpers';

type Client = Awaited<ReturnType<typeof createUserAndLogin>>;

/** 2026-10-05T20:40:00Z is 06 Oct 2026, 02:10 AM in India: the UTC date is still the 5th. */
const AFTER_MIDNIGHT_IST = '2026-10-05T20:40:00Z';

const pdfText = async (c: Client, app: NestExpressApplication, url: string) => {
  const res = await request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${c.token}`).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (d: Buffer) => chunks.push(d));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  }).expect(200);
  return (await pdfParse(res.body as Buffer)).text.replace(/\s+/g, ' ');
};

describe('India dates (mocked clock)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: Client;
  let assignmentId: string;
  let billId: string;

  beforeAll(async () => {
    setClock(AFTER_MIDNIGHT_IST);
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    owner = await createUserAndLogin(app, prisma, 'owner');
    const propertyId = (await owner.post('/properties', { name: 'Sunrise Residency', address: 'MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' })).body.data.id;
    const roomId = (await owner.post('/rooms', { propertyId, roomNumber: '101', defaultRent: 6000, electricityMode: 'NONE' })).body.data.id;
    const t = (await owner.post('/tenants', { fullName: 'Rahul Sharma', phone: '9876543210', joiningDate: '2026-04-01', assignment: { roomId, startDate: '2026-04-01', agreedRent: 6000 } })).body.data;
    assignmentId = t.currentAssignment.id;
  });
  afterAll(async () => { await app.close(); resetClock(); });

  it('takes today from India time, not the server clock', () => {
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-05'); // UTC
    expect(todayLocal().toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(formatDateLocal(new Date())).toBe('06 Oct 2026');
    expect(localDateOf(new Date('2026-10-05T18:29:59Z')).toISOString().slice(0, 10)).toBe('2026-10-05'); // 23:59:59 IST
    expect(localDateOf(new Date('2026-10-05T18:30:00Z')).toISOString().slice(0, 10)).toBe('2026-10-06'); // 00:00 IST
    expect(currentMonth()).toBe('2026-10');
  });

  it('suggests the last completed India month (September) as the billing month', async () => {
    const p = (await owner.post('/bills/preview', { assignmentId }).expect(200)).body.data;
    expect(p.suggestedPeriod.slice(0, 10)).toBe('2026-09-01');
    expect(p.dueDate.slice(0, 10)).toBe('2026-10-10');
    // up to one month ahead of the India month: November is allowed, December is not
    await owner.post('/bills/preview', { assignmentId, billingPeriod: '2026-11' }).expect(200);
    await owner.post('/bills/preview', { assignmentId, billingPeriod: '2026-12' }).expect(400);
  });

  it('prints "Issued on" as the India day the bill was generated', async () => {
    const bill = (await owner.post('/bills', { assignmentId, billingPeriod: '2026-09' }).expect(201)).body.data;
    billId = bill.id;
    expect(bill.issuedOn).toBe('2026-10-06');
    expect((await owner.get(`/bills/${billId}`)).body.data.issuedOn).toBe('2026-10-06');
    expect(await pdfText(owner, app, `/bills/${billId}/pdf`)).toContain('Issued on 06 Oct 2026');
    expect(await pdfText(owner, app, `/bills/${billId}/pdf?format=invoice`)).toContain('Invoice date 06 Oct 2026');
  });

  it('accepts a payment dated today in India and rejects tomorrow, with no extra slack', async () => {
    const tomorrow = await owner.post(`/bills/${billId}/payments`, { amount: 100, paymentDate: '2026-10-07', method: 'CASH' }).expect(400);
    expect(tomorrow.body.message).toBe('Payment date cannot be in the future');
    await owner.post(`/bills/${billId}/payments`, { amount: 100, paymentDate: '2026-10-06', method: 'CASH' }).expect(201);
  });

  it('flips a bill to overdue on the right India day', async () => {
    const dueOct5 = { status: 'GENERATED' as const, dueDate: new Date('2026-10-05T00:00:00Z') };
    expect(effectiveStatus(dueOct5)).toBe('OVERDUE'); // 06 Oct in India
    expect(effectiveStatus({ ...dueOct5, dueDate: new Date('2026-10-06T00:00:00Z') })).toBe('GENERATED'); // due today: not late yet
    setClock('2026-10-05T18:00:00Z'); // 23:30 on 05 Oct in India: still the due day
    expect(effectiveStatus(dueOct5)).toBe('GENERATED');
    setClock(AFTER_MIDNIGHT_IST);
  });
});
