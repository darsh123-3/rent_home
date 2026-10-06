import { NestExpressApplication } from '@nestjs/platform-express';
import { SheetRow } from '../prisma-seed/excel-parser';
import { buildHistoryPlan } from '../prisma-seed/history-plan';
import { wipeProperty, writeHistory } from '../prisma-seed/import-history';
import { PrismaService } from '../src/common/prisma.service';
import { createTestApp, createUserAndLogin, resetDb } from './helpers';

let block = 0;
const rows = (month: string, people: Partial<SheetRow>[]): SheetRow[] => {
  const b = block++;
  return people.map((p) => ({ month, room: '1', name: 'A', rent: 5000, personalElectricity: 100, societyElectricity: 200, societyMaintenance: 0, outstanding: 0, total: null, kind: 'arrears' as const, block: b, ...p }));
};

describe('Excel history import (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: Awaited<ReturnType<typeof createUserAndLogin>>;
  let propertyId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    owner = await createUserAndLogin(app, prisma, 'owner');
    const plan = buildHistoryPlan([
      ...rows('2026-05', [{ name: 'Asha', room: '1' }, { name: 'Left Owing', room: '2' }, { name: 'Left Clean', room: '3' }]),
      ...rows('2026-06', [{ name: 'Asha', room: '1', outstanding: 800 }, { name: 'Left Owing', room: '2', outstanding: 1000 }, { name: 'New Tenant', room: '3', outstanding: 2000 }]),
      ...rows('2026-07', [{ name: 'Asha', room: '1', rent: 5500 }, { name: 'New Tenant', room: '3', personalElectricity: 150 }]),
    ]);
    const res = await writeHistory(prisma as never, plan, { ownerId: owner.user.id, propertyName: 'Imported House', address: 'x', city: 'Pune', state: 'MH', pincode: '411001', ratePerUnit: 12, dueDay: 10, billPrefix: 'INV' });
    propertyId = res.propertyId;
  });
  afterAll(async () => { await app.close(); });

  it('creates every bill with totals that add up and payments that match paid amounts', async () => {
    const bad = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM bills b WHERE total_due <> rent_amount + electricity_amount + other_charges_amount + late_fee + previous_balance - discount
      OR total_due <> (SELECT coalesce(sum(amount),0) FROM bill_items i WHERE i.bill_id = b.id) OR paid_amount <> (SELECT coalesce(sum(amount),0) FROM payments p WHERE p.bill_id = b.id)`;
    expect(Number(bad[0].n)).toBe(0);
    expect(await prisma.bill.count({ where: { propertyId } })).toBe(8);
  });

  it('numbers bills in time order and carries unpaid balances forward', async () => {
    const bills = (await owner.get(`/bills?propertyId=${propertyId}&search=Asha&pageSize=50`)).body.data.items as { id: string; billNumber: string; billingPeriod: string; status: string; totalDue: number; carriedForwardToId: string | null }[];
    const may = bills.find((b) => b.billingPeriod.startsWith('2026-05'))!;
    expect(may.carriedForwardToId).toBeTruthy(); // 800 of May was unpaid and rolled into June
    const june = (await owner.get(`/bills/${may.carriedForwardToId}`)).body.data;
    expect(Number(june.previousBalance)).toBe(800);
    expect(Number(june.totalDue)).toBe(5000 + 100 + 200 + 800);
    expect(may.billNumber < june.billNumber).toBe(true);
    // Month M is issued on the 1st of M+1 and due on the due day of M+1, like bills made in the app.
    const mayBill = (await owner.get(`/bills/${may.id}`)).body.data;
    expect(mayBill).toMatchObject({ billPeriodStart: '2026-05-01', billPeriodEnd: '2026-05-31', issuedOn: '2026-06-01' });
    expect(mayBill.dueDate.slice(0, 10)).toBe('2026-06-10');
  });

  it('shows a tenant who left but still owes money, and lets you collect it', async () => {
    const list = (await owner.get(`/tenants?propertyId=${propertyId}&status=MOVED_OUT`)).body.data.items as { id: string; fullName: string; balance: number }[];
    const owing = list.find((t) => t.fullName === 'Left Owing')!;
    expect(owing.balance).toBe(6300); // June total incl. the 1000 carried in, unpaid
    expect(list.find((t) => t.fullName === 'Left Clean')!.balance).toBe(0);
    const open = (await owner.get(`/tenants/${owing.id}/open-bill`)).body.data;
    const paid = await owner.post(`/bills/${open.id}/payments`, { amount: 2000, paymentDate: '2026-07-20', method: 'UPI' }).expect(201);
    expect(paid.body.data.bill.balance).toBe(4300);
    const dash = (await owner.get(`/dashboard?propertyId=${propertyId}`)).body.data;
    expect(dash.formerTenantDues.some((p: { fullName: string }) => p.fullName === 'Left Owing')).toBe(true);
  });

  it('keeps one live tenant per room and marks rooms correctly', async () => {
    const rooms = (await owner.get(`/rooms?propertyId=${propertyId}`)).body.data.items as { roomNumber: string; status: string }[];
    expect(Object.fromEntries(rooms.map((r) => [r.roomNumber, r.status]))).toEqual({ '1': 'OCCUPIED', '2': 'VACANT', '3': 'OCCUPIED' });
  });

  it('can be wiped and re-imported (payments are append-only otherwise)', async () => {
    await wipeProperty(prisma as never, propertyId);
    expect(await prisma.bill.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.property.count()).toBe(0);
  });
});
