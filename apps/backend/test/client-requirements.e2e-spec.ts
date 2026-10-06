import { NestExpressApplication } from '@nestjs/platform-express';
import pdfParse from 'pdf-parse';
import request from 'supertest';
import { billPeriodLabel, depositLine, paymentDateLine } from '../src/billing/bill-pdf';
import { orderCharges } from '../src/billing/bills.service';
import { agreementInfo } from '../src/common/agreement';
import { isoDate, monthBounds } from '../src/common/dates';
import { PrismaService } from '../src/common/prisma.service';
import { createTestApp, createUserAndLogin, resetClock, resetDb, setClock } from './helpers';

type Client = Awaited<ReturnType<typeof createUserAndLogin>>;
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const pdfText = async (c: Client, app: NestExpressApplication, url: string) => {
  const res = await request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${c.token}`).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (x: Buffer) => chunks.push(x));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  }).expect(200);
  const parsed = await pdfParse(res.body as Buffer);
  return { text: parsed.text.replace(/\s+/g, ' '), pages: parsed.numpages };
};

describe('Bill period (computed, no column)', () => {
  it('runs from the first to the last day of the billing month', () => {
    const range = (iso: string) => { const b = monthBounds(d(iso)); return [isoDate(b.start), isoDate(b.end)]; };
    expect(range('2026-09-01')).toEqual(['2026-09-01', '2026-09-30']); // 30 days
    expect(range('2026-08-01')).toEqual(['2026-08-01', '2026-08-31']); // 31 days
    expect(range('2028-02-01')).toEqual(['2028-02-01', '2028-02-29']); // leap year
    expect(range('2027-02-01')).toEqual(['2027-02-01', '2027-02-28']);
    expect(billPeriodLabel(d('2026-08-01'))).toBe('01 Aug 2026 – 31 Aug 2026');
  });
});

describe('Agreement status (India date)', () => {
  const end = { agreementStartDate: d('2026-01-01'), agreementEndDate: d('2026-12-31') };
  it('is VALID up to and including the end date, then EXPIRED', () => {
    expect(agreementInfo(end, d('2026-06-15'))).toMatchObject({ agreementStatus: 'VALID', agreementEndDate: '2026-12-31', agreementDaysLeft: 199 });
    expect(agreementInfo(end, d('2026-12-31'))).toMatchObject({ agreementStatus: 'VALID', agreementDaysLeft: 0 }); // green on the end date
    expect(agreementInfo(end, d('2027-01-01'))).toMatchObject({ agreementStatus: 'EXPIRED', agreementDaysLeft: -1 }); // red the day after
  });
  it('is NOT_STARTED before the start date, and NONE without an end date', () => {
    expect(agreementInfo(end, d('2025-12-31'))).toMatchObject({ agreementStatus: 'NOT_STARTED' });
    expect(agreementInfo({ agreementStartDate: null, agreementEndDate: d('2026-12-31') }, d('2020-01-01'))).toMatchObject({ agreementStatus: 'VALID' });
    expect(agreementInfo({ agreementStartDate: d('2026-01-01'), agreementEndDate: null }, d('2026-06-01'))).toEqual({ agreementStartDate: '2026-01-01', agreementEndDate: null, agreementStatus: 'NONE', agreementDaysLeft: null });
  });
});

describe('Charge lines order', () => {
  it('puts Water, Housekeeping, MNGL fuel and WiFi first, drops 0 lines and allows one line per category', () => {
    const lines = orderCharges([
      { type: 'MAINTENANCE', amount: 100 }, { type: 'INTERNET', amount: 500 }, { type: 'MNGL_GAS', amount: 450, note: '38 units' },
      { type: 'PARKING', amount: 0 }, { type: 'CLEANING', amount: 300 }, { type: 'WATER', amount: 200 },
    ]);
    expect(lines.map((l) => [l.name, l.amount])).toEqual([['Water bill', 200], ['Housekeeping', 300], ['MNGL fuel bill', 450], ['WiFi connection', 500], ['Maintenance', 100]]);
    expect(lines[2].note).toBe('38 units');
    expect(() => orderCharges([{ type: 'WATER', amount: 1 }, { type: 'WATER', amount: 2 }])).toThrow('Only one Water bill line is allowed per bill');
    expect(orderCharges([{ type: 'OTHER', name: 'Gas cylinder', amount: 1 }, { type: 'OTHER', name: 'Repair', amount: 2 }])).toHaveLength(2); // custom lines may repeat
  });
  it('words the payment and deposit lines', () => {
    expect(paymentDateLine({ status: 'PAID', paidInFullOn: '2026-10-12', lastPayment: null })).toBe('Paid in full on 12 Oct 2026');
    expect(paymentDateLine({ status: 'PARTIALLY_PAID', paidInFullOn: null, lastPayment: { amount: 3000, paymentDate: '2026-10-12' } })).toBe('Last payment ₹3,000 on 12 Oct 2026');
    expect(paymentDateLine({ status: 'GENERATED', paidInFullOn: null, lastPayment: null })).toBe('');
    expect(depositLine({ securityDeposit: { totalReceived: 15000, lastReceivedOn: '2026-01-20' } })).toBe('Security deposit received: ₹15,000 (last received 20 Jan 2026)');
    expect(depositLine({ securityDeposit: null })).toBe('');
  });
});

describe('Client requirements (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: Client;
  let other: Client;
  let propertyId: string;
  let roomId: string;
  let tenantId: string;
  let assignmentId: string;
  let augBillId: string;

  beforeAll(async () => {
    setClock('2026-09-05T06:00:00Z'); // 05 Sep 2026: August readings are in, August is billed
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    owner = await createUserAndLogin(app, prisma, 'owner');
    other = await createUserAndLogin(app, prisma, 'intruder');
    propertyId = (await owner.post('/properties', { name: 'Sunrise Residency', address: 'MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' })).body.data.id;
    await owner.put(`/properties/${propertyId}`, { billPrefix: 'SUN', dueDayOfMonth: 10, contactPhone: '98220 12345' }).expect(200);
    roomId = (await owner.post('/rooms', { propertyId, roomNumber: '101', defaultRent: 6000, electricityMode: 'METER', ratePerUnit: 12 })).body.data.id;
  });
  afterAll(async () => { await app.close(); resetClock(); });

  it('creates the first deposit receipt and the agreement dates with the tenant, in one request', async () => {
    const res = await owner.post('/tenants', {
      fullName: 'Rahul Sharma', phone: '9876543210', joiningDate: '2026-07-01',
      assignment: {
        roomId, startDate: '2026-07-01', agreedRent: 6000, securityDeposit: 20000, initialMeterReading: 4304,
        depositReceived: 10000, depositReceivedOn: '2026-01-05', depositMethod: 'UPI', agreementStartDate: '2026-01-01', agreementEndDate: '2026-12-31',
      },
    }).expect(201);
    const t = res.body.data;
    tenantId = t.id;
    assignmentId = t.currentAssignment.id;
    expect(t.currentAssignment).toMatchObject({ agreementStartDate: '2026-01-01', agreementEndDate: '2026-12-31', agreementStatus: 'VALID', agreementDaysLeft: 117 });
    expect(t.securityDeposit).toMatchObject({ agreed: 20000, totalReceived: 10000, pending: 10000, lastReceivedOn: '2026-01-05' });
    expect(t.securityDeposit.receipts).toEqual([expect.objectContaining({ amount: 10000, receivedOn: '2026-01-05', method: 'UPI' })]);
    expect(await prisma.auditLog.count({ where: { action: 'deposit.create' } })).toBe(1);
  });

  it('rejects a bad deposit at move-in or agreement order without creating anything', async () => {
    const r2 = (await owner.post('/rooms', { propertyId, roomNumber: '102', defaultRent: 5000, electricityMode: 'NONE' })).body.data.id;
    const base = { fullName: 'Bad Input', phone: '9000000001', joiningDate: '2026-07-01' };
    await owner.post('/tenants', { ...base, assignment: { roomId: r2, startDate: '2026-07-01', agreedRent: 5000, depositReceived: 1000, depositReceivedOn: '2026-09-06' } }).expect(400); // future
    await owner.post('/tenants', { ...base, assignment: { roomId: r2, startDate: '2026-07-01', agreedRent: 5000, agreementStartDate: '2026-07-01', agreementEndDate: '2026-06-30' } }).expect(400);
    await owner.post('/tenants', { ...base, assignment: { roomId: r2, startDate: '2026-07-01', agreedRent: 5000, depositReceived: 10.555 } }).expect(400);
    expect(await prisma.tenant.count({ where: { fullName: 'Bad Input' } })).toBe(0);
    expect((await owner.get(`/rooms/${r2}`)).body.data.status).toBe('VACANT');
  });

  it('adds, lists and deletes deposit instalments; totals are computed', async () => {
    const added = await owner.post(`/room-assignments/${assignmentId}/deposits`, { amount: 5000, receivedOn: '2026-01-20', method: 'CASH', note: 'Second part' }).expect(201);
    expect(added.body.data).toMatchObject({ agreed: 20000, totalReceived: 15000, pending: 5000, lastReceivedOn: '2026-01-20' });
    expect(added.body.data.receipts.map((r: { amount: number }) => r.amount)).toEqual([5000, 10000]); // newest first
    await owner.post(`/room-assignments/${assignmentId}/deposits`, { amount: 1, receivedOn: '2026-09-06', method: 'CASH' }).expect(400); // tomorrow in India
    await owner.post(`/room-assignments/${assignmentId}/deposits`, { amount: 0, receivedOn: '2026-09-05', method: 'CASH' }).expect(400);
    await owner.post(`/room-assignments/${assignmentId}/deposits`, { amount: 1.234, receivedOn: '2026-09-05', method: 'CASH' }).expect(400);
    await owner.post(`/room-assignments/${assignmentId}/deposits`, { amount: 1, receivedOn: '2026-09-05', method: 'CHEQUE' }).expect(400);
    await other.post(`/room-assignments/${assignmentId}/deposits`, { amount: 1, receivedOn: '2026-09-05', method: 'CASH' }).expect(404);
    await other.get(`/room-assignments/${assignmentId}/deposits`).expect(404);

    const extra = await owner.post(`/room-assignments/${assignmentId}/deposits`, { amount: 100, receivedOn: '2026-09-05', method: 'CASH' }).expect(201);
    const id = extra.body.data.receipts.find((r: { amount: number }) => r.amount === 100).id;
    await other.delete(`/room-assignments/${assignmentId}/deposits/${id}`).expect(404);
    const after = await owner.delete(`/room-assignments/${assignmentId}/deposits/${id}`).expect(200);
    expect(after.body.data).toMatchObject({ totalReceived: 15000, lastReceivedOn: '2026-01-20' });
    await owner.delete(`/room-assignments/${assignmentId}/deposits/${id}`).expect(404);
    expect(await prisma.auditLog.count({ where: { action: 'deposit.delete', entityId: id } })).toBe(1);

    const listed = (await owner.get(`/room-assignments/${assignmentId}/deposits`).expect(200)).body.data;
    expect(listed).toMatchObject({ totalReceived: 15000, pending: 5000 });

    // The agreed amount can be set or corrected later; pending follows, receipts stay.
    expect((await owner.post(`/room-assignments/${assignmentId}/agreed-deposit`, { amount: 25000 }).expect(200)).body.data).toMatchObject({ agreed: 25000, totalReceived: 15000, pending: 10000 });
    await owner.post(`/room-assignments/${assignmentId}/agreed-deposit`, { amount: -1 }).expect(400);
    await owner.post(`/room-assignments/${assignmentId}/agreed-deposit`, { amount: 1.234 }).expect(400);
    await other.post(`/room-assignments/${assignmentId}/agreed-deposit`, { amount: 1 }).expect(404);
    expect(await prisma.auditLog.count({ where: { action: 'deposit.agreed_change', entityId: assignmentId } })).toBe(1);
    await owner.post(`/room-assignments/${assignmentId}/agreed-deposit`, { amount: 20000 }).expect(200);
    expect((await owner.get(`/tenants/${tenantId}`)).body.data.securityDeposit).toMatchObject({ totalReceived: 15000, lastReceivedOn: '2026-01-20' });
  });

  it('bills the worked example: ₹8,362 with the four monthly lines in order (preview matches)', async () => {
    const body = {
      assignmentId, billingPeriod: '2026-08', electricity: { currentReading: 4380 },
      // sent out of order on purpose; a 0 line is left off
      charges: [{ type: 'INTERNET', amount: 500 }, { type: 'MNGL_GAS', amount: 450, note: '38 SCM' }, { type: 'PARKING', amount: 0 }, { type: 'CLEANING', amount: 300 }, { type: 'WATER', amount: 200 }],
    };
    const preview = (await owner.post('/bills/preview', body).expect(200)).body.data;
    expect(preview.totals).toMatchObject({ rent: 6000, electricity: 912, otherCharges: 1450, totalDue: 8362 });
    expect(preview.charges.map((c: { name: string }) => c.name)).toEqual(['Water bill', 'Housekeeping', 'MNGL fuel bill', 'WiFi connection']);

    const bill = (await owner.post('/bills', body).expect(201)).body.data;
    augBillId = bill.id;
    expect(bill).toMatchObject({ totalDue: 8362, otherChargesAmount: 1450, billPeriodStart: '2026-08-01', billPeriodEnd: '2026-08-31', issuedOn: '2026-09-05', paidInFullOn: null, lastPayment: null });
    expect(bill.dueDate.slice(0, 10)).toBe('2026-09-10');
    expect(bill.items.map((i: { type: string; description: string; amount: number }) => [i.type, i.description, i.amount])).toEqual([
      ['RENT', 'Rent', 6000], ['ELECTRICITY', 'Electricity (76 units x 12)', 912],
      ['CHARGE', 'Water bill', 200], ['CHARGE', 'Housekeeping', 300], ['CHARGE', 'MNGL fuel bill', 450], ['CHARGE', 'WiFi connection', 500],
    ]);
    expect(bill.items.slice(2).map((i: { meta: { chargeType: string } }) => i.meta.chargeType)).toEqual(['WATER', 'CLEANING', 'MNGL_GAS', 'INTERNET']);
    expect(bill.items[4].meta.note).toBe('38 SCM');
    // The deposit is shown, never added
    expect(bill.securityDeposit).toEqual({ totalReceived: 15000, lastReceivedOn: '2026-01-20' });
    expect(bill.agreement).toMatchObject({ agreementStatus: 'VALID', agreementEndDate: '2026-12-31' });
    expect(bill.property.contactPhone).toBe('9822012345');
    expect((await owner.get(`/bills?tenantId=${tenantId}`)).body.data.items[0]).toMatchObject({ billPeriodStart: '2026-08-01', billPeriodEnd: '2026-08-31' });
  });

  it('validates the monthly charges', async () => {
    const base = { assignmentId, billingPeriod: '2026-09', electricity: { currentReading: 4400 } };
    expect((await owner.post('/bills/preview', { ...base, charges: [{ type: 'WATER', amount: 1 }, { type: 'WATER', amount: 2 }] }).expect(400)).body.message).toMatch(/Only one Water bill line/);
    await owner.post('/bills/preview', { ...base, charges: [{ type: 'GAS', amount: 1 }] }).expect(400);
    await owner.post('/bills/preview', { ...base, charges: [{ type: 'WATER', amount: -1 }] }).expect(400);
    await owner.post('/bills/preview', { ...base, charges: [{ type: 'WATER', amount: 1.001 }] }).expect(400);
  });

  it('prints the new lines, bill period, landlord phone and the informational deposit line on one A4 page', async () => {
    const { text, pages } = await pdfText(owner, app, `/bills/${augBillId}/pdf`);
    expect(pages).toBe(1);
    for (const s of [
      'Phone: 9822012345', 'Bill period', '01 Aug 2026 – 31 Aug 2026', 'Issued on 05 Sep 2026', 'Due date 10 Sep 2026',
      'Water bill', 'Housekeeping', 'MNGL fuel bill', '38 SCM', 'WiFi connection', '₹8,362',
      'Security deposit received: ₹15,000 (last received 20 Jan 2026)', 'No payment received yet',
    ]) expect(text).toContain(s);
    expect(text.indexOf('Water bill')).toBeLessThan(text.indexOf('Housekeeping'));
    expect(text.indexOf('Housekeeping')).toBeLessThan(text.indexOf('MNGL fuel bill'));
    expect(text.indexOf('MNGL fuel bill')).toBeLessThan(text.indexOf('WiFi connection'));
    expect(text).not.toContain('Last payment');
    expect(text).not.toContain('Paid in full on');

    const invoice = (await pdfText(owner, app, `/bills/${augBillId}/pdf?format=invoice`)).text;
    for (const s of ['Bill period 01 Aug 2026 – 31 Aug 2026', 'Invoice date 05 Sep 2026', 'Phone: 9822012345', 'MNGL fuel bill (38 SCM)', 'Security deposit received: ₹15,000']) expect(invoice).toContain(s);
    const statement = (await pdfText(owner, app, `/bills/${augBillId}/pdf?format=statement`)).text;
    for (const s of ['Bill period 01 Aug 2026 – 31 Aug 2026', 'Issued 05 Sep 2026', 'Due 10 Sep 2026', 'Water bill', 'WiFi connection', '8362']) expect(statement).toContain(s);
  });

  it('shows the payment received date: last payment while part paid, paid in full once settled', async () => {
    const part = (await owner.post(`/bills/${augBillId}/payments`, { amount: 3000, paymentDate: '2026-09-02', method: 'UPI' }).expect(201)).body.data.bill;
    expect(part).toMatchObject({ paidInFullOn: null, lastPayment: { amount: 3000, paymentDate: '2026-09-02' } });
    expect((await pdfText(owner, app, `/bills/${augBillId}/pdf`)).text).toContain('Last payment ₹3,000 on 02 Sep 2026');

    const full = (await owner.post(`/bills/${augBillId}/payments`, { amount: 5362, paymentDate: '2026-09-04', method: 'CASH' }).expect(201)).body.data.bill;
    expect(full).toMatchObject({ balance: 0, paidInFullOn: '2026-09-04', lastPayment: null });
    expect(full.totalDue).toBe(8362); // the deposit never changed the total
    const { text } = await pdfText(owner, app, `/bills/${augBillId}/pdf`);
    expect(text).toContain('Paid in full on 04 Sep 2026');
    expect(text).toContain('PAYMENTS RECEIVED');
    expect((await pdfText(owner, app, `/bills/${augBillId}/pdf?format=invoice`)).text).toContain('Paid in full on 04 Sep 2026');
  });

  it('reports the month by charge category', async () => {
    const c = (await owner.get(`/reports/collection?propertyId=${propertyId}&month=2026-08`).expect(200)).body.data;
    expect(c.byCategory).toEqual([
      { category: 'WATER', label: 'Water bill', amount: 200, count: 1 }, { category: 'CLEANING', label: 'Housekeeping', amount: 300, count: 1 },
      { category: 'MNGL_GAS', label: 'MNGL fuel bill', amount: 450, count: 1 }, { category: 'INTERNET', label: 'WiFi connection', amount: 500, count: 1 },
      { category: 'OTHER', label: 'Other charges', amount: 0, count: 0 },
    ]);
  });

  it('edits agreement dates from Edit Tenant and shows them on lists, rooms and bills', async () => {
    await owner.put(`/tenants/${tenantId}`, { agreementStartDate: '2026-12-31', agreementEndDate: '2026-01-01' }).expect(400);
    await owner.put(`/tenants/${tenantId}`, { agreementEndDate: '2026-09-04' }).expect(200);
    const list = (await owner.get(`/tenants?propertyId=${propertyId}`)).body.data.items.find((t: { id: string }) => t.id === tenantId);
    expect(list.agreement).toMatchObject({ agreementStatus: 'EXPIRED', agreementEndDate: '2026-09-04', agreementDaysLeft: -1 });
    expect((await owner.get(`/rooms/${roomId}`)).body.data.currentTenant).toMatchObject({ agreementStatus: 'EXPIRED' });
    expect((await owner.get(`/bills/${augBillId}`)).body.data.agreement).toMatchObject({ agreementStatus: 'EXPIRED' });
    // '' clears the end date: nothing to show
    await owner.put(`/tenants/${tenantId}`, { agreementEndDate: '' }).expect(200);
    expect((await owner.get(`/tenants/${tenantId}`)).body.data.currentAssignment).toMatchObject({ agreementStartDate: '2026-01-01', agreementEndDate: null, agreementStatus: 'NONE' });
  });

  it('exports deposits, bill period and one column per charge category', async () => {
    const ExcelJS = await import('exceljs');
    const res = await request(app.getHttpServer()).get('/exports/excel').set('Authorization', `Bearer ${owner.token}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (x: Buffer) => chunks.push(x));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    const headers = (name: string) => (wb.getWorksheet(name)!.getRow(1).values as unknown[]).slice(1);
    const row = (name: string, n = 2) => Object.fromEntries(headers(name).map((h, i) => [String(h), (wb.getWorksheet(name)!.getRow(n).values as unknown[])[i + 1]]));
    expect(headers('Tenants')).toEqual(expect.arrayContaining(['Deposit agreed', 'Deposit received', 'Last deposit date']));
    expect(row('Tenants')).toMatchObject({ 'Deposit agreed': 20000, 'Deposit received': 15000 });
    expect((row('Tenants')['Last deposit date'] as Date).toISOString().slice(0, 10)).toBe('2026-01-20');
    expect(headers('Payments')[0]).toBe('Received date');
  });

  it('still renders an old bill that has none of the new fields', async () => {
    // An older bill as stored before this release: a "Cleaning" charge without a chargeType, no payments.
    const old = await prisma.bill.create({
      data: {
        billNumber: 'OLD-202607-0001', propertyId, assignmentId, tenantId, roomId, billingPeriod: d('2026-07-01'), dueDate: d('2026-08-10'),
        rentAmount: 6000, electricityAmount: 0, otherChargesAmount: 150, totalDue: 6150, createdAt: new Date('2026-08-01T04:00:00Z'),
        items: { create: [{ type: 'RENT', description: 'Rent', amount: 6000, sortOrder: 0 }, { type: 'CHARGE', description: 'Cleaning', amount: 150, sortOrder: 1 }] },
      },
    });
    const got = (await owner.get(`/bills/${old.id}`).expect(200)).body.data;
    expect(got).toMatchObject({ billPeriodStart: '2026-07-01', billPeriodEnd: '2026-07-31', issuedOn: '2026-08-01', paidInFullOn: null, lastPayment: null });
    for (const format of ['premium', 'invoice', 'statement']) {
      const { text, pages } = await pdfText(owner, app, `/bills/${old.id}/pdf?format=${format}`);
      expect(text).toContain('Cleaning');
      if (format !== 'statement') expect(pages).toBe(1);
    }
  });
});
