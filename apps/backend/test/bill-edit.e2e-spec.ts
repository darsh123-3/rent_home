import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/common/prisma.service';
import { createTestApp, createUserAndLogin, resetClock, resetDb, setClock } from './helpers';

type Client = Awaited<ReturnType<typeof createUserAndLogin>>;

describe('Editing a bill (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: Client;
  let other: Client;
  let tenantId: string;
  let assignmentId: string;
  let augId: string;
  let sepId: string;

  beforeAll(async () => {
    setClock('2026-10-15T06:00:00Z');
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    owner = await createUserAndLogin(app, prisma, 'owner');
    other = await createUserAndLogin(app, prisma, 'intruder');
    const propertyId = (await owner.post('/properties', { name: 'Sunrise Residency', address: 'MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' })).body.data.id;
    await owner.put(`/properties/${propertyId}`, { billPrefix: 'SUN', dueDayOfMonth: 10 });
    const roomId = (await owner.post('/rooms', { propertyId, roomNumber: '101', defaultRent: 6000, electricityMode: 'METER', ratePerUnit: 10 })).body.data.id;
    const t = (await owner.post('/tenants', { fullName: 'Rahul Sharma', phone: '9876543210', joiningDate: '2026-07-01', assignment: { roomId, startDate: '2026-07-01', agreedRent: 6000, initialMeterReading: 100 } })).body.data;
    tenantId = t.id;
    assignmentId = t.currentAssignment.id;
    // August is left unpaid, so September carries it.
    augId = (await owner.post('/bills', { assignmentId, billingPeriod: '2026-08', electricity: { currentReading: 150 } }).expect(201)).body.data.id; // 6000 + 500
    const sep = (await owner.post('/bills', { assignmentId, billingPeriod: '2026-09', electricity: { currentReading: 200 }, charges: [{ type: 'WATER', amount: 100 }] }).expect(201)).body.data;
    sepId = sep.id;
    expect(sep).toMatchObject({ previousBalance: 6500, totalDue: 6000 + 500 + 100 + 6500 });
  });
  afterAll(async () => { await app.close(); resetClock(); });

  it('previews the edit with the bill left out of the checks and its carried balance counted again', async () => {
    const p = (await owner.post('/bills/preview', { replacingBillId: sepId, electricity: { currentReading: 220 }, charges: [{ type: 'WATER', amount: 150 }] }).expect(200)).body.data;
    expect(p.billingPeriod.slice(0, 7)).toBe('2026-09');
    expect(p.electricity).toMatchObject({ previousReading: 150, currentReading: 220, units: 70, amount: 700 });
    expect(p.totals).toMatchObject({ previousBalance: 6500, totalDue: 6000 + 700 + 150 + 6500 });
    expect(p.carriedBills).toEqual([expect.objectContaining({ id: augId, balance: 6500 })]);
    await other.post('/bills/preview', { replacingBillId: sepId }).expect(404);
  });

  it('refuses to edit a bill whose balance was carried into a later bill', async () => {
    const res = await owner.post(`/bills/${augId}/revise`, { electricity: { currentReading: 160 } }).expect(409);
    expect(res.body.message).toMatch(/already part of SUN-202609-0002\. Edit that bill instead/);
  });

  it('replaces the bill with a corrected one for the same month, keeping the previous balance', async () => {
    const res = await owner.post(`/bills/${sepId}/revise`, { billingPeriod: '2026-07', electricity: { currentReading: 220 }, charges: [{ type: 'WATER', amount: 150 }], discount: 50 }).expect(201);
    const fixed = res.body.data;
    expect(fixed.billNumber).toBe('SUN-202609-0003');
    expect(fixed.billingPeriod.slice(0, 7)).toBe('2026-09'); // the month cannot be changed by an edit
    expect(fixed).toMatchObject({ electricityAmount: 700, otherChargesAmount: 150, discount: 50, previousBalance: 6500, totalDue: 6000 + 700 + 150 - 50 + 6500, status: 'OVERDUE' });
    expect(fixed.notes).toBe('Corrected version of SUN-202609-0002.');
    expect(fixed.items.at(-1)).toMatchObject({ type: 'PREVIOUS_BALANCE', amount: 6500 });
    expect(fixed.absorbed.map((b: { id: string }) => b.id)).toEqual([augId]);

    const old = (await owner.get(`/bills/${sepId}`)).body.data;
    expect(old).toMatchObject({ status: 'CANCELLED', totalDue: 13100 }); // the old bill's amounts never change
    expect(old.notes).toContain('Replaced by SUN-202609-0003 (bill edited).');
    expect((await owner.get(`/bills/${augId}`)).body.data.carriedInto).toMatchObject({ id: fixed.id });
    expect((await owner.get(`/tenants/${tenantId}`)).body.data.outstanding).toBe(fixed.totalDue); // counted once
    // The meter reading moved to the corrected bill
    expect(await prisma.electricityReading.findMany({ where: { assignmentId, billingPeriod: new Date('2026-09-01') }, select: { billId: true, currentReading: true } }))
      .toEqual([{ billId: fixed.id, currentReading: expect.anything() }]);
    expect(await prisma.auditLog.count({ where: { action: 'bill.revise' } })).toBe(1);
    sepId = fixed.id;
  });

  it('refuses edits for cancelled bills and for other owners', async () => {
    const old = await prisma.bill.findFirstOrThrow({ where: { billNumber: 'SUN-202609-0002' } });
    expect((await owner.post(`/bills/${old.id}/revise`, {}).expect(409)).body.message).toBe('A cancelled bill cannot be edited');
    await other.post(`/bills/${sepId}/revise`, { electricity: { currentReading: 230 } }).expect(404);
  });

  it('edits a paid bill: its payments move to the corrected bill with the same dates, and collections do not change', async () => {
    const pay = (await owner.post(`/bills/${sepId}/payments`, { amount: 1000, paymentDate: '2026-10-12', method: 'UPI', reference: 'UTR9' }).expect(201)).body.data;
    const before = (await owner.get(`/reports/collection?propertyId=${pay.bill.property.id}&month=2026-10`)).body.data;
    const owedBefore = (await owner.get(`/tenants/${tenantId}`)).body.data.outstanding;

    const fixed = (await owner.post(`/bills/${sepId}/revise`, { electricity: { currentReading: 230 }, charges: [{ type: 'WATER', amount: 150 }], discount: 50 }).expect(201)).body.data;
    expect(fixed).toMatchObject({ paidAmount: 1000, electricityAmount: 800, status: 'OVERDUE', storedStatus: 'PARTIALLY_PAID' });
    expect(fixed.payments).toEqual([expect.objectContaining({ amount: 1000, paymentDate: expect.stringMatching(/^2026-10-12/), method: 'UPI', reference: 'UTR9', reversed: null })]);
    expect(fixed.payments[0].notes).toMatch(/^Moved from SUN-202609-0003 \(bill edited\)\./);

    const old = (await owner.get(`/bills/${sepId}`)).body.data;
    expect(old).toMatchObject({ status: 'CANCELLED', paidAmount: 0 });
    expect(old.payments).toEqual([expect.objectContaining({ id: pay.payment.id, reversed: expect.objectContaining({ reason: 'moved to the corrected bill (bill edited)' }) })]);

    const after = (await owner.get(`/reports/collection?propertyId=${pay.bill.property.id}&month=2026-10`)).body.data;
    expect([after.collected, after.paymentCount]).toEqual([before.collected, before.paymentCount]); // the same money, counted once
    expect((await owner.get(`/tenants/${tenantId}`)).body.data.outstanding).toBe(owedBefore + 100); // only the change itself (10 more units = +₹100) adds to what is owed
    sepId = fixed.id;
  });

  it('refuses an edit that would make the bill smaller than what was already paid', async () => {
    const bill = (await owner.get(`/bills/${sepId}`)).body.data;
    await owner.post(`/bills/${sepId}/payments`, { amount: bill.balance, paymentDate: '2026-10-13', method: 'CASH' }).expect(201);
    const res = await owner.post(`/bills/${sepId}/revise`, { electricity: { currentReading: 230 }, discount: 2000 }).expect(400);
    expect(res.body.message).toMatch(/is less than the ₹[\d,]+ already paid on this bill/);
    expect((await owner.get(`/bills/${sepId}`)).body.data).toMatchObject({ status: 'PAID', balance: 0 }); // nothing changed
  });

  it('only edits the latest bill and still validates the new details', async () => {
    const t = (await owner.post('/tenants', { fullName: 'Paid Up', phone: '9000000001', joiningDate: '2026-07-01', propertyId: (await prisma.property.findFirstOrThrow()).id })).body.data;
    const room = (await owner.post('/rooms', { propertyId: (await prisma.property.findFirstOrThrow()).id, roomNumber: '102', defaultRent: 0, electricityMode: 'NONE' })).body.data.id;
    const a = (await owner.post('/room-assignments', { tenantId: t.id, roomId: room, startDate: '2026-07-01', agreedRent: 0 })).body.data.id;
    const zero = (await owner.post('/bills', { assignmentId: a, billingPeriod: '2026-08' }).expect(201)).body.data; // a ₹0 bill: paid, nothing carried
    await owner.post('/bills', { assignmentId: a, billingPeriod: '2026-09' }).expect(201);
    expect((await owner.post(`/bills/${zero.id}/revise`, {}).expect(409)).body.message).toMatch(/Only the latest bill can be edited/);
    const sep = (await owner.get(`/bills?tenantId=${t.id}&month=2026-09`)).body.data.items[0];
    await owner.post(`/bills/${sep.id}/revise`, { dueDate: '2026-09-15' }).expect(400); // due date must be after the month ends
    await owner.post(`/bills/${sep.id}/revise`, { charges: [{ type: 'WATER', amount: -1 }] }).expect(400);
    expect((await owner.get(`/bills/${sep.id}`)).body.data.status).not.toBe('CANCELLED'); // a refused edit changes nothing
  });
});
