import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/common/prisma.service';
import { createTestApp, createUserAndLogin, resetClock, resetDb, setClock } from './helpers';

type Client = Awaited<ReturnType<typeof createUserAndLogin>>;

describe('Dashboard & reports (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: Client;
  let other: Client;
  let propertyId: string;
  let emptyPropertyId: string;
  let rahul: string;
  let amit: string;
  let sepBillRahul: string;

  beforeAll(async () => {
    setClock('2026-10-15T06:00:00Z'); // after the September bills fall due (10 Oct 2026)
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    owner = await createUserAndLogin(app, prisma, 'owner');
    other = await createUserAndLogin(app, prisma, 'intruder');
    propertyId = (await owner.post('/properties', { name: 'Sunrise Residency', address: 'MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' })).body.data.id;
    emptyPropertyId = (await owner.post('/properties', { name: 'Empty House', address: 'X', city: 'Pune', state: 'Maharashtra', pincode: '411002' })).body.data.id;
    const room = async (n: string, rent: number) => (await owner.post('/rooms', { propertyId, roomNumber: n, defaultRent: rent, electricityMode: 'NONE' })).body.data.id;
    const [r101, r102, r103, r104, r105] = [await room('101', 8000), await room('102', 5000), await room('103', 6000), await room('104', 7000), await room('105', 7500)];
    await owner.put(`/rooms/${r105}`, { status: 'MAINTENANCE' });
    void r103; void r104;
    const t1 = (await owner.post('/tenants', { fullName: 'Rahul Sharma', phone: '9876543210', joiningDate: '2026-04-01', assignment: { roomId: r101, startDate: '2026-04-01', agreedRent: 9000 } })).body.data;
    const t2 = (await owner.post('/tenants', { fullName: 'Amit Kumar', phone: '9000000001', joiningDate: '2026-04-01', assignment: { roomId: r102, startDate: '2026-04-01', agreedRent: 5000 } })).body.data;
    rahul = t1.id; amit = t2.id;
    const a1 = t1.currentAssignment.id; const a2 = t2.currentAssignment.id;

    const aug = (await owner.post('/bills', { assignmentId: a1, billingPeriod: '2026-08' })).body.data; // 9000
    await owner.post(`/bills/${aug.id}/payments`, { amount: 9000, paymentDate: '2026-08-05', method: 'CASH' }).expect(201);
    const sep1 = (await owner.post('/bills', { assignmentId: a1, billingPeriod: '2026-09', charges: [{ type: 'WATER', amount: 1000 }] })).body.data; // 10000
    sepBillRahul = sep1.id;
    const sep2 = (await owner.post('/bills', { assignmentId: a2, billingPeriod: '2026-09' })).body.data; // 5000
    await owner.post(`/bills/${sep1.id}/payments`, { amount: 6000, paymentDate: '2026-09-10', method: 'UPI' }).expect(201);
    await owner.post(`/bills/${sep2.id}/payments`, { amount: 5000, paymentDate: '2026-09-12', method: 'CASH' }).expect(201);
  });
  afterAll(async () => { await app.close(); resetClock(); });

  it('reports collection for a month: expected, collected, pending, methods', async () => {
    const c = (await owner.get(`/reports/collection?propertyId=${propertyId}&month=2026-09`).expect(200)).body.data;
    expect(c).toMatchObject({ month: '2026-09', monthLabel: 'September 2026', expected: 15000, collected: 11000, paymentCount: 2, pending: 4000 });
    expect(c.collectionRate).toBeCloseTo(11000 / 15000, 5);
    expect(c.byMethod).toEqual([{ method: 'CASH', amount: 5000, count: 1 }, { method: 'UPI', amount: 6000, count: 1 }].sort((a, b) => b.amount - a.amount));
    expect(c.trend).toHaveLength(6);
    expect(c.trend.at(-1)).toMatchObject({ month: '2026-09', expected: 15000, collected: 11000 });
    expect(c.trend.at(-2)).toMatchObject({ month: '2026-08', expected: 9000, collected: 9000 });
    expect(c.trend[0].month).toBe('2026-04');
  });

  it('keeps arrears out of next month\'s expected amount', async () => {
    const a1 = (await owner.get(`/tenants/${rahul}`)).body.data.currentAssignment.id;
    const oct = (await owner.post('/bills', { assignmentId: a1, billingPeriod: '2026-10' })).body.data;
    expect(oct).toMatchObject({ previousBalance: 4000, totalDue: 13000 });
    const c = (await owner.get(`/reports/collection?propertyId=${propertyId}&month=2026-10`)).body.data;
    expect(c.expected).toBe(9000); // October's own rent only
    expect(c.pending).toBe(13000); // everything still owed by the tenant (single, non-double-counted figure)
    // clean up for the following tests
    await owner.post(`/bills/${oct.id}/cancel`, {}).expect(200);
    expect((await owner.get(`/reports/collection?propertyId=${propertyId}&month=2026-09`)).body.data.pending).toBe(4000);
  });

  it('lists outstanding balances, largest first, with overdue days', async () => {
    const o = (await owner.get(`/reports/outstanding?propertyId=${propertyId}`).expect(200)).body.data;
    expect(o).toMatchObject({ total: 4000, count: 1 });
    expect(o.items[0]).toMatchObject({ tenantId: rahul, fullName: 'Rahul Sharma', roomNumber: '101', balance: 4000, billId: sepBillRahul });
    expect(o.items[0].overdueDays).toBeGreaterThan(0);
    expect(o.items.find((i: any) => i.tenantId === amit)).toBeUndefined();
  });

  it('reports occupancy', async () => {
    const o = (await owner.get(`/reports/occupancy?propertyId=${propertyId}`).expect(200)).body.data;
    expect(o).toMatchObject({ totalRooms: 5, occupied: 2, vacant: 2, maintenance: 1, occupancyPercent: 40, rentableOccupancyPercent: 50 });
    expect(o.vacantRooms.map((r: any) => r.roomNumber)).toEqual(['103', '104']);
    expect(o.vacantRentPotential).toBe(13000);
  });

  it('builds the dashboard for the selected property', async () => {
    const d = (await owner.get(`/dashboard?propertyId=${propertyId}&month=2026-09`).expect(200)).body.data;
    expect(d.property).toMatchObject({ id: propertyId, name: 'Sunrise Residency' });
    expect(d.properties).toHaveLength(2);
    expect(d.collection).toMatchObject({ expected: 15000, collected: 11000, pending: 4000 });
    expect(d.collection.trend).toBeUndefined();
    expect(d.occupancy).toEqual({ totalRooms: 5, occupied: 2, vacant: 2, maintenance: 1, occupancyPercent: 40 });
    expect(d.pendingPayments).toHaveLength(1);
    expect(d.pendingPayments[0]).toMatchObject({ fullName: 'Rahul Sharma', roomNumber: '101', balance: 4000 });
    expect(d.username).toBe('owner');
  });

  it('falls back to the latest billed month when the current month has no bills', async () => {
    const d = (await owner.get(`/dashboard?propertyId=${propertyId}`).expect(200)).body.data;
    // the suite bills August to October 2026; whichever is the newest month with bills is shown, never an empty current month
    expect(d.collection.month <= '2026-10' || d.collection.expected > 0).toBe(true);
    expect(d.collection.expected).toBeGreaterThan(0);
  });

  it('defaults to the first property and handles a property with no data', async () => {
    expect((await owner.get('/dashboard')).body.data.property.id).toBe(propertyId);
    const empty = (await owner.get(`/dashboard?propertyId=${emptyPropertyId}`)).body.data;
    expect(empty.collection).toMatchObject({ expected: 0, collected: 0, pending: 0, collectionRate: 0 });
    expect(empty.occupancy).toMatchObject({ totalRooms: 0, occupancyPercent: 0 });
    expect(empty.pendingPayments).toEqual([]);
  });

  it('returns an empty dashboard for a brand new account', async () => {
    const d = (await other.get('/dashboard')).body.data;
    expect(d).toMatchObject({ property: null, collection: null, occupancy: null, pendingPayments: [] });
  });

  it('never leaks another owner\'s numbers and validates input', async () => {
    await other.get(`/reports/collection?propertyId=${propertyId}`).expect(404);
    await other.get(`/reports/outstanding?propertyId=${propertyId}`).expect(404);
    await other.get(`/dashboard?propertyId=${propertyId}`).expect(200); // unknown property falls back to their own (none)
    expect((await other.get('/reports/outstanding')).body.data).toMatchObject({ total: 0, count: 0 });
    await owner.get('/reports/collection?month=2026-13').expect(400);
    await owner.get('/reports/collection?propertyId=nope').expect(400);
  });

  it('separates what former tenants still owe from current dues, with overdue and KPI figures', async () => {
    const rooms = (await owner.get(`/rooms?propertyId=${propertyId}&status=VACANT`)).body.data.items as { id: string; roomNumber: string }[];
    const room = rooms.find((r) => r.roomNumber === '103')!;
    const t = (await owner.post('/tenants', { fullName: 'Left Behind', phone: '9000000099', joiningDate: '2026-06-01', assignment: { roomId: room.id, startDate: '2026-06-01', agreedRent: 3000 } })).body.data;
    await owner.post('/bills', { assignmentId: t.currentAssignment.id, billingPeriod: '2026-09', dueDate: '2026-10-01' }).expect(201);
    await owner.post(`/room-assignments/${t.currentAssignment.id}/move-out`, { moveOutDate: '2026-09-30' }).expect(200);

    const d = (await owner.get(`/dashboard?propertyId=${propertyId}&month=2026-09`).expect(200)).body.data;
    expect(d.kpis.dues.total).toBe(7000); // Rahul 4000 + the tenant who left 3000
    expect(d.kpis.dues.currentTenants).toMatchObject({ amount: 4000, count: 1 });
    expect(d.kpis.dues.formerTenants).toMatchObject({ amount: 3000, count: 1 });
    expect(d.kpis.dues.overdue).toMatchObject({ amount: 7000, count: 2 }); // both due dates have passed
    expect(d.formerTenantDues).toHaveLength(1);
    expect(d.formerTenantDues[0]).toMatchObject({ fullName: 'Left Behind', balance: 3000, tenantStatus: 'MOVED_OUT' });
    expect(d.pendingPayments.map((p: { fullName: string }) => p.fullName)).toEqual(['Rahul Sharma']); // current tenants only
    expect(d.pendingCount).toBe(1);
    expect(d.kpis.composition).toMatchObject({ rent: 17000, bills: 3 }); // Rahul 9000 + Amit 5000 + the tenant who left 3000
    expect(d.kpis.rentRoll).toMatchObject({ tenants: 2 });
    expect(d.kpis.vacancy.lostRent).toBeGreaterThan(0);
    expect(d.kpis.trend).toHaveLength(6);
    expect(d.recentPayments[0]).toMatchObject({ tenantName: expect.any(String), roomNumber: expect.any(String) });
    expect(d.kpis.toBill.count).toBeGreaterThanOrEqual(0);

    const names = async (qs: string) => ((await owner.get(`/tenants?propertyId=${propertyId}&${qs}`).expect(200)).body.data.items as { fullName: string }[]).map((x) => x.fullName).sort();
    expect(await names('dues=true')).toEqual(['Left Behind', 'Rahul Sharma']);
    expect(await names('status=MOVED_OUT&dues=true')).toEqual(['Left Behind']);

    // The money can still be collected after move-out.
    const open = (await owner.get(`/tenants/${t.id}/open-bill`)).body.data;
    await owner.post(`/bills/${open.id}/payments`, { amount: 3000, paymentDate: '2026-10-01', method: 'CASH' }).expect(201);
    const after = (await owner.get(`/dashboard?propertyId=${propertyId}&month=2026-09`)).body.data;
    expect(after.kpis.dues.formerTenants).toMatchObject({ amount: 0, count: 0 });
    expect(after.formerTenantDues).toEqual([]);
  });
});
