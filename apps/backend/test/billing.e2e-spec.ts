import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/common/prisma.service';
import { createTestApp, createUserAndLogin, resetClock, resetDb, setClock } from './helpers';

type Client = Awaited<ReturnType<typeof createUserAndLogin>>;

describe('Billing (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: Client;
  let other: Client;
  let propertyId: string;
  let roomId: string;
  let tenantId: string;
  let assignmentId: string;
  let sepBillId: string;

  beforeAll(async () => {
    setClock('2026-10-15T06:00:00Z'); // after the September bills fall due (10 Oct 2026)
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    owner = await createUserAndLogin(app, prisma, 'owner');
    other = await createUserAndLogin(app, prisma, 'intruder');
    propertyId = (await owner.post('/properties', { name: 'Sunrise Residency', address: 'MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' })).body.data.id;
    await owner.put(`/properties/${propertyId}`, { billPrefix: 'SUN', dueDayOfMonth: 10 });
    roomId = (await owner.post('/rooms', { propertyId, roomNumber: '101', defaultRent: 8000, electricityMode: 'METER', ratePerUnit: 8 })).body.data.id;
    const t = (await owner.post('/tenants', {
      fullName: 'Rahul Sharma', phone: '9876543210', joiningDate: '2026-04-01',
      assignment: { roomId, startDate: '2026-04-01', agreedRent: 8000, securityDeposit: 16000, initialMeterReading: 1200 },
    })).body.data;
    tenantId = t.id;
    assignmentId = t.currentAssignment.id;
  });
  afterAll(async () => { await app.close(); resetClock(); });

  const septemberBody = (extra: object = {}) => ({
    assignmentId, billingPeriod: '2026-09',
    electricity: { currentReading: 1350 },
    charges: [{ type: 'MAINTENANCE', amount: 500 }, { type: 'WATER', amount: 200 }],
    ...extra,
  });

  it('uses the stay\'s own rate, a one-off rate for a single bill, and a changed rate afterwards', async () => {
    // Default: the room's rate of 8 per unit.
    expect((await owner.post('/bills/preview', septemberBody()).expect(200)).body.data.electricity).toMatchObject({ ratePerUnit: 8, amount: 1200 });
    // One bill only: the typed rate wins and nothing is stored on the stay.
    expect((await owner.post('/bills/preview', septemberBody({ electricity: { currentReading: 1350, ratePerUnit: 10 } })).expect(200)).body.data.electricity).toMatchObject({ ratePerUnit: 10, amount: 1500 });
    expect((await owner.post('/bills/preview', septemberBody()).expect(200)).body.data.electricity.ratePerUnit).toBe(8);
    // A change on the stay applies to later bills; the room keeps its own default unless asked.
    await owner.post(`/room-assignments/${assignmentId}/electricity`, { ratePerUnit: 11 }).expect(200);
    expect((await owner.post('/bills/preview', septemberBody()).expect(200)).body.data.electricity).toMatchObject({ ratePerUnit: 11, amount: 1650 });
    expect(Number((await owner.get(`/rooms/${roomId}`)).body.data.ratePerUnit)).toBe(8);
    await owner.post(`/room-assignments/${assignmentId}/electricity`, { ratePerUnit: 8, applyToRoom: true }).expect(200);
    await owner.post(`/room-assignments/${assignmentId}/electricity`, { ratePerUnit: -1 }).expect(400);
    await other.post(`/room-assignments/${assignmentId}/electricity`, { ratePerUnit: 1 }).expect(404);
  });

  it('previews a bill with server-calculated totals (spec example: 9,900)', async () => {
    const res = await owner.post('/bills/preview', septemberBody()).expect(200);
    const d = res.body.data;
    expect(d.rent).toBe(8000);
    expect(d.electricity).toMatchObject({ previousReading: 1200, currentReading: 1350, units: 150, ratePerUnit: 8, amount: 1200 });
    expect(d.totals).toMatchObject({ rent: 8000, electricity: 1200, otherCharges: 700, subtotal: 9900, previousBalance: 0, totalDue: 9900 });
    expect(d.dueDate.slice(0, 10)).toBe('2026-10-10'); // September's bill is payable on 10 October
    expect(d.tenant.fullName).toBe('Rahul Sharma');
  });

  it('preview works before a reading is typed, but a bill cannot be created without one', async () => {
    const p = await owner.post('/bills/preview', { assignmentId, billingPeriod: '2026-09' }).expect(200);
    expect(p.body.data.electricity).toMatchObject({ needsReading: true, previousReading: 1200, amount: 0 });
    expect(p.body.data.totals).toMatchObject({ rent: 8000, totalDue: 8000 });
    const res = await owner.post('/bills', { assignmentId, billingPeriod: '2026-09' }).expect(400);
    expect(res.body.message).toBe('Enter the current meter reading');
  });

  it('refuses client-supplied totals and unknown fields', async () => {
    const res = await owner.post('/bills', septemberBody({ totalDue: 1, rentAmount: 1 })).expect(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects bad input: missing month, lower reading, negative charge, late fee as charge, oversize discount', async () => {
    await owner.post('/bills', { assignmentId }).expect(400);
    const low = await owner.post('/bills/preview', septemberBody({ electricity: { currentReading: 1199 } })).expect(400);
    expect(low.body.message).toBe('Current reading (1199) cannot be lower than the previous reading (1200)');
    await owner.post('/bills/preview', septemberBody({ charges: [{ type: 'WATER', amount: -5 }] })).expect(400);
    expect((await owner.post('/bills/preview', septemberBody({ charges: [{ type: 'LATE_FEE', amount: 50 }] })).expect(400)).body.message).toMatch(/late fee field/);
    await owner.post('/bills/preview', septemberBody({ discount: 999999 })).expect(400);
    await owner.post('/bills/preview', septemberBody({ billingPeriod: '2026-02' })).expect(400); // before move-in
    await owner.post('/bills/preview', septemberBody({ billingPeriod: '2031-01' })).expect(400); // too far ahead
  });

  it('generates the September bill; items always add up to the total', async () => {
    const res = await owner.post('/bills', septemberBody({ dueDate: '2026-09-10' })).expect(201); // explicit date so the bill is already overdue
    const b = res.body.data;
    sepBillId = b.id;
    expect(b).toMatchObject({ billNumber: 'SUN-202609-0001', status: 'OVERDUE', storedStatus: 'GENERATED', totalDue: 9900, paidAmount: 0, balance: 9900 });
    // Water is one of the monthly lines, which come right after electricity; other charges follow.
    expect(b.items.map((i: any) => [i.type, i.amount])).toEqual([['RENT', 8000], ['ELECTRICITY', 1200], ['CHARGE', 200], ['CHARGE', 500]]);
    expect(b.items.reduce((s: number, i: any) => s + i.amount, 0)).toBe(b.totalDue);
    expect(b.items[1].meta).toMatchObject({ previousReading: 1200, currentReading: 1350, units: 150, ratePerUnit: 8 });
    expect(b.tenant.fullName).toBe('Rahul Sharma');
    expect(b.property.name).toBe('Sunrise Residency');
    expect(await prisma.electricityReading.count({ where: { assignmentId, billId: b.id } })).toBe(1);
  });

  it('prevents a duplicate bill for the same tenant assignment and period', async () => {
    const res = await owner.post('/bills', septemberBody()).expect(409);
    expect(res.body.message).toBe('A bill for September 2026 already exists for this tenant (SUN-202609-0001)');
  });

  it('prevents duplicates under concurrency', async () => {
    const t2 = (await owner.post('/tenants', { fullName: 'Racer', phone: '9000000099', joiningDate: '2026-04-01', propertyId })).body.data.id;
    const r2 = (await owner.post('/rooms', { propertyId, roomNumber: '202', defaultRent: 5000, electricityMode: 'NONE' })).body.data.id;
    const a2 = (await owner.post('/room-assignments', { tenantId: t2, roomId: r2, startDate: '2026-04-01', agreedRent: 5000 })).body.data.id;
    const [x, y] = await Promise.all([owner.post('/bills', { assignmentId: a2, billingPeriod: '2026-09' }), owner.post('/bills', { assignmentId: a2, billingPeriod: '2026-09' })]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect(await prisma.bill.count({ where: { assignmentId: a2, status: { not: 'CANCELLED' } } })).toBe(1);
  });

  it('enforces the database rule directly too', async () => {
    await expect(prisma.bill.create({
      data: { billNumber: 'DUP-1', propertyId, assignmentId, tenantId, roomId, billingPeriod: new Date('2026-09-01'), dueDate: new Date('2026-09-10'), rentAmount: 1, electricityAmount: 0, otherChargesAmount: 0, totalDue: 1 },
    })).rejects.toBeTruthy();
  });

  it('applies rent changes to new months only; the old bill never changes', async () => {
    await owner.post(`/room-assignments/${assignmentId}/rent`, { amount: 8500, effectiveFrom: '2026-10-01' }).expect(200);
    const oct = await owner.post('/bills', { assignmentId, billingPeriod: '2026-10', electricity: { currentReading: 1400 } }).expect(201);
    expect(oct.body.data.rentAmount).toBe(8500);
    expect(oct.body.data.items[0]).toMatchObject({ type: 'RENT', amount: 8500 });
    const sep = (await owner.get(`/bills/${sepBillId}`)).body.data;
    expect(sep.rentAmount).toBe(8000);
    expect(sep.totalDue).toBe(9900);
    expect(sep.items[0].amount).toBe(8000);
  });

  it('carries the unpaid balance forward without double counting', async () => {
    const list = (await owner.get(`/bills?tenantId=${tenantId}`)).body.data.items;
    expect(list.map((b: any) => b.billNumber)).toEqual(['SUN-202610-0003', 'SUN-202609-0001']);
    const oct = (await owner.get(`/bills/${list[0].id}`)).body.data;
    // Oct: rent 8500 + electricity (1400-1350)*8 = 400 + previous 9900
    expect(oct).toMatchObject({ previousBalance: 9900, electricityAmount: 400, totalDue: 18800 });
    expect(oct.items.at(-1)).toMatchObject({ type: 'PREVIOUS_BALANCE', amount: 9900 });
    expect(oct.items.reduce((s: number, i: any) => s + i.amount, 0)).toBe(oct.totalDue);
    expect(oct.absorbed.map((b: any) => b.billNumber)).toEqual(['SUN-202609-0001']);
    const sep = (await owner.get(`/bills/${sepBillId}`)).body.data;
    expect(sep.carriedInto.billNumber).toBe('SUN-202610-0003');
    expect(sep.totalDue).toBe(9900); // the old bill itself is untouched

    expect((await owner.get(`/tenants/${tenantId}`)).body.data.outstanding).toBe(18800);
    expect((await owner.get(`/rooms/${roomId}`)).body.data.balance).toBe(18800);
    expect((await owner.get('/tenants?search=rahul')).body.data.items[0].balance).toBe(18800);
  });

  it('requires bills in order and uses the last reading as the next previous reading', async () => {
    const res = await owner.post('/bills', { assignmentId, billingPeriod: '2026-08' }).expect(409);
    expect(res.body.message).toMatch(/Bills must be generated in order/);
    const nov = await owner.post('/bills/preview', { assignmentId, billingPeriod: '2026-11', electricity: { currentReading: 1399 } }).expect(400);
    expect(nov.body.message).toBe('Current reading (1399) cannot be lower than the previous reading (1400)');
  });

  it('supports manual electricity override, late fee, discount and zero-total bills', async () => {
    const p = await owner.post('/bills/preview', { assignmentId, billingPeriod: '2026-11', electricity: { currentReading: 1500, overrideAmount: 700 }, lateFee: 100, discount: 300 }).expect(200);
    expect(p.body.data.electricity).toMatchObject({ units: 100, calculatedAmount: 800, amount: 700, isOverride: true });
    // 8500 + 700 + 100 late - 300 discount + 18800 previous
    expect(p.body.data.totals).toMatchObject({ subtotal: 9000, totalDue: 27800 });
  });

  it('keeps bill amounts immutable at the database level', async () => {
    await expect(prisma.bill.update({ where: { id: sepBillId }, data: { totalDue: 1 } })).rejects.toThrow(/immutable/);
    await expect(prisma.bill.update({ where: { id: sepBillId }, data: { rentAmount: 1 } })).rejects.toThrow(/immutable/);
    const item = await prisma.billItem.findFirstOrThrow({ where: { billId: sepBillId } });
    await expect(prisma.billItem.update({ where: { id: item.id }, data: { amount: 1 } })).rejects.toThrow(/immutable/);
    // allowed: workflow fields
    await prisma.bill.update({ where: { id: sepBillId }, data: { notes: 'called tenant' } });
  });

  it('filters bills by status (overdue), month and search', async () => {
    expect((await owner.get('/bills?status=OVERDUE')).body.data.total).toBeGreaterThanOrEqual(1);
    expect((await owner.get('/bills?month=2026-09')).body.data.items.map((b: any) => b.billNumber)).toContain('SUN-202609-0001');
    expect((await owner.get('/bills?search=rahul')).body.data.total).toBeGreaterThanOrEqual(2);
    expect((await owner.get('/bills?search=SUN-202610')).body.data.total).toBe(1);
    await owner.get('/bills?status=NOPE').expect(400);
  });

  it('hides billing from other users', async () => {
    await other.get(`/bills/${sepBillId}`).expect(404);
    await other.post('/bills/preview', { assignmentId, billingPeriod: '2026-11' }).expect(404);
    await other.post('/bills', { assignmentId, billingPeriod: '2026-11' }).expect(404);
    await other.post(`/bills/${sepBillId}/cancel`, {}).expect(404);
    expect((await other.get('/bills')).body.data.total).toBe(0);
  });

  it('cancels a bill, un-carries earlier balances, frees the period and meter reading', async () => {
    const oct = (await owner.get(`/bills?tenantId=${tenantId}&month=2026-10`)).body.data.items[0];
    await owner.post(`/bills/${sepBillId}/cancel`, {}).expect(409); // carried into October
    const res = await owner.post(`/bills/${oct.id}/cancel`, { reason: 'Wrong reading' }).expect(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect((await owner.get(`/tenants/${tenantId}`)).body.data.outstanding).toBe(9900);
    expect((await owner.get(`/bills/${sepBillId}`)).body.data.carriedInto).toBeNull();
    await owner.post(`/bills/${oct.id}/cancel`, {}).expect(409);
    // Regenerate October with the corrected reading; previous reading is back to September's 1350
    const again = await owner.post('/bills', { assignmentId, billingPeriod: '2026-10', electricity: { currentReading: 1450 } }).expect(201);
    expect(again.body.data.electricityAmount).toBe(800);
    expect(again.body.data.totalDue).toBe(8500 + 800 + 9900);
  });

  it('recurring charges pre-fill the bill preview', async () => {
    const c = await owner.post(`/room-assignments/${assignmentId}/charges`, { type: 'INTERNET', name: 'Wi-Fi', amount: 300 }).expect(201);
    await owner.post(`/room-assignments/${assignmentId}/charges`, { type: 'LATE_FEE', name: 'x', amount: 1 }).expect(400);
    const p = await owner.post('/bills/preview', { assignmentId, billingPeriod: '2026-11', electricity: { currentReading: 1500 } }).expect(200);
    expect(p.body.data.recurringCharges).toEqual([expect.objectContaining({ name: 'Wi-Fi', amount: 300, type: 'INTERNET' })]);
    await owner.delete(`/room-assignments/${assignmentId}/charges/${c.body.data.id}`).expect(200);
    expect((await owner.get(`/room-assignments/${assignmentId}/charges`)).body.data).toEqual([]);
  });

  it('bills a closed assignment only up to the move-out month', async () => {
    await owner.post(`/room-assignments/${assignmentId}/move-out`, { moveOutDate: '2026-10-20', finalMeterReading: 1460 }).expect(200);
    await owner.post('/bills/preview', { tenantId, billingPeriod: '2026-11' }).expect(400);
    const p = await owner.post('/bills/preview', { tenantId, billingPeriod: '2026-10' });
    expect(p.status).toBe(409); // October already billed
  });

  it('adds a migrated opening balance to the first bill only', async () => {
    const r = (await owner.post('/rooms', { propertyId, roomNumber: 'M1', defaultRent: 6000, electricityMode: 'NONE' })).body.data.id;
    const t = (await owner.post('/tenants', { fullName: 'Migrated Tenant', phone: '9000000077', joiningDate: '2026-07-01', assignment: { roomId: r, startDate: '2026-07-01', agreedRent: 6000, openingBalance: 1000 } })).body.data;
    const a = t.currentAssignment.id;
    const p = (await owner.post('/bills/preview', { assignmentId: a, billingPeriod: '2026-08' }).expect(200)).body.data;
    expect(p).toMatchObject({ openingBalance: 1000 });
    expect(p.totals).toMatchObject({ previousBalance: 1000, totalDue: 7000 });
    const first = (await owner.post('/bills', { assignmentId: a, billingPeriod: '2026-08' }).expect(201)).body.data;
    expect(first.previousBalance).toBe(1000);
    expect(first.items.at(-1)).toMatchObject({ type: 'PREVIOUS_BALANCE', amount: 1000 });
    expect((await owner.get(`/tenants/${t.id}`)).body.data.outstanding).toBe(7000);
    // cancelling and regenerating the first bill still includes it (never lost, never doubled)
    await owner.post(`/bills/${first.id}/cancel`, {}).expect(200);
    expect((await owner.post('/bills', { assignmentId: a, billingPeriod: '2026-08' }).expect(201)).body.data.totalDue).toBe(7000);
    // the next bill carries the unpaid first bill (which already contains the opening balance) once
    const next = (await owner.post('/bills', { assignmentId: a, billingPeriod: '2026-09' }).expect(201)).body.data;
    expect(next).toMatchObject({ previousBalance: 7000, totalDue: 13000 });
    await owner.post('/room-assignments', { tenantId: t.id, roomId: r, startDate: '2026-07-01', agreedRent: 1, openingBalance: -5 }).expect(400);
  });

  it('lists a tenant\'s electricity history with readings, rate and totals', async () => {
    const h = (await owner.get(`/tenants/${tenantId}/electricity`).expect(200)).body.data;
    expect(h.rows.length).toBeGreaterThan(0);
    const row = h.rows.find((r: { currentReading: number | null }) => r.currentReading === 1350)!;
    expect(row).toMatchObject({ previousReading: 1200, currentReading: 1350, units: 150, amount: 1200, roomNumber: '101' });
    expect(row.ratePerUnit).toBe(8);
    expect(h.summary.months).toBe(h.rows.length);
    expect(h.summary.totalAmount).toBeCloseTo(h.rows.reduce((s: number, r: { amount: number }) => s + r.amount, 0), 2);
    expect(h.summary.averageMonthly).toBeCloseTo(h.summary.totalAmount / h.rows.length, 2);
    expect(h.rows.map((r: { month: string }) => r.month)).toEqual([...h.rows.map((r: { month: string }) => r.month)].sort().reverse()); // newest first
    await other.get(`/tenants/${tenantId}/electricity`).expect(404);
  });
});