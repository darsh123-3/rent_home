import { NestExpressApplication } from '@nestjs/platform-express';
import pdfParse from 'pdf-parse';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { createTestApp, createUserAndLogin, resetClock, resetDb, setClock } from './helpers';

type Client = Awaited<ReturnType<typeof createUserAndLogin>>;

const pdfText = async (c: Client, app: NestExpressApplication, url: string) => {
  const res = await request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${c.token}`).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (x: Buffer) => chunks.push(x));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  }).expect(200);
  return (await pdfParse(res.body as Buffer)).text.replace(/\s+/g, ' ');
};

describe('Bill corrections: payment reversal, previous balance adjustment, rent on the bill (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: Client;
  let other: Client;
  let propertyId: string;
  let tenantId: string;
  let assignmentId: string;

  beforeAll(async () => {
    setClock('2026-10-15T06:00:00Z');
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    owner = await createUserAndLogin(app, prisma, 'owner');
    other = await createUserAndLogin(app, prisma, 'intruder');
    propertyId = (await owner.post('/properties', { name: 'Sunrise Residency', address: 'MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' })).body.data.id;
    await owner.put(`/properties/${propertyId}`, { billPrefix: 'SUN', dueDayOfMonth: 10 });
    const roomId = (await owner.post('/rooms', { propertyId, roomNumber: '101', defaultRent: 6000, electricityMode: 'NONE' })).body.data.id;
    const t = (await owner.post('/tenants', { fullName: 'Rahul Sharma', phone: '9876543210', joiningDate: '2026-06-01', assignment: { roomId, startDate: '2026-06-01', agreedRent: 6000 } })).body.data;
    tenantId = t.id;
    assignmentId = t.currentAssignment.id;
  });
  afterAll(async () => { await app.close(); resetClock(); });

  describe('reversing a payment recorded by mistake', () => {
    let billId: string;
    let paymentId: string;

    it('makes a paid bill unpaid again, keeps both entries, and updates every total', async () => {
      billId = (await owner.post('/bills', { assignmentId, billingPeriod: '2026-06' }).expect(201)).body.data.id;
      const paid = (await owner.post(`/bills/${billId}/payments`, { amount: 6000, paymentDate: '2026-07-05', method: 'UPI', reference: 'UTR1' }).expect(201)).body.data;
      paymentId = paid.payment.id;
      expect(paid.bill).toMatchObject({ status: 'PAID', balance: 0, paidInFullOn: '2026-07-05' });

      await owner.post(`/payments/${paymentId}/reverse`, { reason: '' }).expect(400);
      await other.post(`/payments/${paymentId}/reverse`, { reason: 'x' }).expect(404);
      const res = (await owner.post(`/payments/${paymentId}/reverse`, { reason: 'Recorded twice' }).expect(200)).body.data;
      expect(res.reversal).toMatchObject({ amount: -6000, reversalOfId: paymentId, notes: 'Reversal: Recorded twice' });
      expect(res.bill).toMatchObject({ status: 'OVERDUE', storedStatus: 'GENERATED', paidAmount: 0, balance: 6000, paidInFullOn: null, lastPayment: null });
      expect(res.bill.payments).toEqual([expect.objectContaining({ id: paymentId, amount: 6000, reversed: expect.objectContaining({ reason: 'Recorded twice' }) })]);

      expect((await owner.get(`/tenants/${tenantId}`)).body.data.outstanding).toBe(6000);
      const list = (await owner.get(`/payments?tenantId=${tenantId}`)).body.data;
      expect(list.items).toHaveLength(1); // the reversal row is not listed; the payment is shown as reversed
      expect(list.items[0].reversed).toMatchObject({ reason: 'Recorded twice' });
      expect(list.summary).toMatchObject({ totalAmount: 0, count: 0 });
      const july = (await owner.get(`/reports/collection?propertyId=${propertyId}&month=2026-07`)).body.data;
      expect(july).toMatchObject({ collected: 0, paymentCount: 0, byMethod: [] });
      expect(await prisma.auditLog.count({ where: { action: 'payment.reverse', entityId: paymentId } })).toBe(1);
      const text = await pdfText(owner, app, `/bills/${billId}/pdf`);
      expect(text).toContain('No payment received yet');
      expect(text).not.toContain('PAYMENTS RECEIVED');
    });

    it('cannot reverse twice or reverse a reversal; the unpaid bill can now be edited', async () => {
      expect((await owner.post(`/payments/${paymentId}/reverse`, { reason: 'again' }).expect(409)).body.message).toBe('This payment has already been reversed');
      const reversal = await prisma.payment.findFirstOrThrow({ where: { reversalOfId: paymentId } });
      await owner.post(`/payments/${reversal.id}/reverse`, { reason: 'x' }).expect(409);
      await expect(prisma.payment.create({ data: { billId, tenantId, amount: -1, paymentDate: new Date('2026-07-05'), method: 'CASH' } })).rejects.toThrow(); // only reversals may be negative
      await expect(prisma.payment.update({ where: { id: paymentId }, data: { amount: 1 } })).rejects.toThrow(/cannot be modified/); // still append-only
      const fixed = (await owner.post(`/bills/${billId}/revise`, { lateFee: 0 }).expect(201)).body.data;
      expect(fixed.notes).toMatch(/^Corrected version of/);
      billId = fixed.id;
    });

    it('is refused once the bill was carried into a later bill', async () => {
      const p = (await owner.post(`/bills/${billId}/payments`, { amount: 1000, paymentDate: '2026-07-06', method: 'CASH' }).expect(201)).body.data.payment;
      await owner.post('/bills', { assignmentId, billingPeriod: '2026-07' }).expect(201); // carries the 5000 still open
      const res = await owner.post(`/payments/${p.id}/reverse`, { reason: 'mistake' }).expect(409);
      expect(res.body.message).toMatch(/already part of SUN-202607-\d{4}, which counted this payment\. Adjust the previous balance on that bill instead/);
    });
  });

  describe('adjusting the previous balance', () => {
    it('adds a separate, explained line and changes the total by exactly that amount', async () => {
      const base = (await owner.post('/bills/preview', { assignmentId, billingPeriod: '2026-08' }).expect(200)).body.data;
      const carried = base.totals.previousBalance;
      expect(carried).toBeGreaterThan(0);
      // The reason is optional
      expect((await owner.post('/bills/preview', { assignmentId, billingPeriod: '2026-08', previousBalanceAdjustment: 500 }).expect(200)).body.data.totals.previousBalance).toBe(carried + 500);
      await owner.post('/bills/preview', { assignmentId, billingPeriod: '2026-08', previousBalanceAdjustment: -(carried + 1), previousBalanceNote: 'x' }).expect(400); // not below zero
      const up = (await owner.post('/bills/preview', { assignmentId, billingPeriod: '2026-08', previousBalanceAdjustment: 500, previousBalanceNote: 'Old dues from the register' }).expect(200)).body.data;
      expect(up).toMatchObject({ carriedBalance: carried, previousBalanceAdjustment: 500 });
      expect(up.totals).toMatchObject({ previousBalance: carried + 500, totalDue: base.totals.totalDue + 500 });

      const bill = (await owner.post('/bills', { assignmentId, billingPeriod: '2026-08', previousBalanceAdjustment: 500, previousBalanceNote: 'Old dues from the register' }).expect(201)).body.data;
      expect(bill.previousBalance).toBe(carried + 500);
      expect(bill.items.slice(-2)).toEqual([
        expect.objectContaining({ type: 'PREVIOUS_BALANCE', description: 'Previous balance', amount: carried }),
        expect.objectContaining({ type: 'PREVIOUS_BALANCE', description: 'Previous balance adjustment', amount: 500, meta: { adjustment: true, note: 'Old dues from the register' } }),
      ]);
      expect(bill.items.reduce((s: number, i: { amount: number }) => s + i.amount, 0)).toBe(bill.totalDue);
      expect((await owner.get(`/tenants/${tenantId}`)).body.data.outstanding).toBe(bill.totalDue);
      expect(await pdfText(owner, app, `/bills/${bill.id}/pdf`)).toContain('Old dues from the register');
      expect(await pdfText(owner, app, `/bills/${bill.id}/pdf?format=invoice`)).toContain('Previous balance adjustment (Old dues from the register)');

      // Lowering it works too, e.g. when the owner forgives part of the old dues
      const down = (await owner.post(`/bills/${bill.id}/revise`, { previousBalanceAdjustment: -1000, previousBalanceNote: 'Waived' }).expect(201)).body.data;
      expect(down).toMatchObject({ previousBalance: carried - 1000, totalDue: bill.totalDue - 1500 });
    });
  });

  describe('rent set on the bill', () => {
    it('changes only this bill, or also the rent from this month onward', async () => {
      const once = (await owner.post('/bills', { assignmentId, billingPeriod: '2026-09', rent: 6500 }).expect(201)).body.data;
      expect(once.rentAmount).toBe(6500);
      expect(once.items[0]).toMatchObject({ type: 'RENT', amount: 6500, meta: expect.objectContaining({ standardRent: 6000 }) });
      expect((await owner.get(`/tenants/${tenantId}`)).body.data.currentAssignment.agreedRent).toBe(6000);
      expect((await owner.post('/bills/preview', { assignmentId, billingPeriod: '2026-10' }).expect(200)).body.data.rent).toBe(6000);

      const fromNow = (await owner.post(`/bills/${once.id}/revise`, { rent: 7000, applyRentFromThisMonth: true }).expect(201)).body.data;
      expect(fromNow.rentAmount).toBe(7000);
      expect(fromNow.items[0].meta.standardRent).toBeUndefined(); // 7000 is now the usual rent, not a one-off
      const t = (await owner.get(`/tenants/${tenantId}`)).body.data;
      expect(t.currentAssignment.agreedRent).toBe(7000);
      expect(t.currentAssignment.rents[0]).toMatchObject({ amount: 7000, effectiveFrom: expect.stringMatching(/^2026-09-01/) });
      expect((await owner.post('/bills/preview', { assignmentId, billingPeriod: '2026-10' }).expect(200)).body.data).toMatchObject({ rent: 7000, standardRent: 7000 });
      expect(await prisma.auditLog.count({ where: { action: 'assignment.rent_change', entityId: assignmentId } })).toBe(1);
      await owner.post('/bills/preview', { assignmentId, billingPeriod: '2026-10', rent: -1 }).expect(400);
    });
  });

  describe('a part payment', () => {
    it('leaves the rest as outstanding everywhere, then carries it into the next bill', async () => {
      // Tenant A: rent ₹2,000 for September, pays ₹1,800.
      const roomId = (await owner.post('/rooms', { propertyId, roomNumber: 'A1', defaultRent: 2000, electricityMode: 'NONE' })).body.data.id;
      const a = (await owner.post('/tenants', { fullName: 'Tenant A', phone: '9000000111', joiningDate: '2026-09-01', assignment: { roomId, startDate: '2026-09-01', agreedRent: 2000 } })).body.data;
      const sep = (await owner.post('/bills', { assignmentId: a.currentAssignment.id, billingPeriod: '2026-09' }).expect(201)).body.data;
      const paid = (await owner.post(`/bills/${sep.id}/payments`, { amount: 1800, paymentDate: '2026-10-05', method: 'CASH' }).expect(201)).body.data.bill;

      // ₹200 outstanding: on the bill, the tenant, the tenant list and the outstanding report
      expect(paid).toMatchObject({ totalDue: 2000, paidAmount: 1800, balance: 200, storedStatus: 'PARTIALLY_PAID', lastPayment: { amount: 1800, paymentDate: '2026-10-05' } });
      expect((await owner.get(`/tenants/${a.id}`)).body.data.outstanding).toBe(200);
      expect((await owner.get(`/tenants?propertyId=${propertyId}&search=Tenant A`)).body.data.items[0].balance).toBe(200);
      const report = (await owner.get(`/reports/outstanding?propertyId=${propertyId}`)).body.data;
      expect(report.items.find((i: { tenantId: string }) => i.tenantId === a.id)).toMatchObject({ balance: 200, billCount: 1 });

      // The October bill brings the ₹200 in as "Previous balance", and it is counted once
      const oct = (await owner.post('/bills', { assignmentId: a.currentAssignment.id, billingPeriod: '2026-10' }).expect(201)).body.data;
      expect(oct).toMatchObject({ previousBalance: 200, totalDue: 2200 });
      expect(oct.items.at(-1)).toMatchObject({ type: 'PREVIOUS_BALANCE', amount: 200 });
      expect(oct.absorbed).toEqual([expect.objectContaining({ id: sep.id, billNumber: sep.billNumber })]);
      expect((await owner.get(`/bills/${sep.id}`)).body.data.carriedInto).toMatchObject({ id: oct.id });
      expect((await owner.get(`/tenants/${a.id}`)).body.data.outstanding).toBe(2200);
      expect(await pdfText(owner, app, `/bills/${oct.id}/pdf`)).toContain(`Unpaid from ${sep.billNumber}`);
    });
  });
});
