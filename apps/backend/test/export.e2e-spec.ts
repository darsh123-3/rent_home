import { NestExpressApplication } from '@nestjs/platform-express';
import * as ExcelJS from 'exceljs';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { createTestApp, createUserAndLogin, resetClock, resetDb, setClock } from './helpers';

type Client = Awaited<ReturnType<typeof createUserAndLogin>>;

const download = (c: Client, app: NestExpressApplication, url: string) =>
  request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${c.token}`).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (d: Buffer) => chunks.push(d));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

async function open(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}
const table = (wb: ExcelJS.Workbook, name: string) => {
  const ws = wb.getWorksheet(name)!;
  const head = (ws.getRow(1).values as unknown[]).slice(1).map(String);
  const rows: Record<string, unknown>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const vals = (row.values as unknown[]).slice(1);
    if (vals[0] === 'Total') return; // the totals row
    rows.push(Object.fromEntries(head.map((h, i) => [h, vals[i] && typeof vals[i] === 'object' && 'result' in (vals[i] as object) ? (vals[i] as { result: unknown }).result : vals[i]])));
  });
  return rows;
};

describe('Excel export (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: Client;
  let other: Client;
  let propertyId: string;

  beforeAll(async () => {
    setClock('2026-09-28T06:00:00Z'); // the export covers the current month: September 2026
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    owner = await createUserAndLogin(app, prisma, 'owner');
    other = await createUserAndLogin(app, prisma, 'intruder');
    propertyId = (await owner.post('/properties', { name: 'Sunrise Residency', address: 'MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' })).body.data.id;
    const r101 = (await owner.post('/rooms', { propertyId, roomNumber: '101', defaultRent: 8000, electricityMode: 'METER', ratePerUnit: 8 })).body.data.id;
    const r102 = (await owner.post('/rooms', { propertyId, roomNumber: '102', defaultRent: 5000, electricityMode: 'NONE' })).body.data.id;
    const rahul = (await owner.post('/tenants', { fullName: 'Rahul Sharma', phone: '9876543210', joiningDate: '2026-04-01', assignment: { roomId: r101, startDate: '2026-04-01', agreedRent: 8000, initialMeterReading: 1200 } })).body.data;
    const left = (await owner.post('/tenants', { fullName: 'Left Behind', phone: '9000000099', joiningDate: '2026-04-01', assignment: { roomId: r102, startDate: '2026-04-01', agreedRent: 5000 } })).body.data;
    const bill = (await owner.post('/bills', { assignmentId: rahul.currentAssignment.id, billingPeriod: '2026-09', electricity: { currentReading: 1350 }, charges: [{ type: 'MAINTENANCE', amount: 500 }] })).body.data;
    await owner.post(`/bills/${bill.id}/payments`, { amount: 5000, paymentDate: '2026-09-10', method: 'UPI', reference: 'UTR1' }).expect(201);
    await owner.post('/bills', { assignmentId: left.currentAssignment.id, billingPeriod: '2026-09' }).expect(201);
    await owner.post(`/room-assignments/${left.currentAssignment.id}/move-out`, { moveOutDate: '2026-09-30' }).expect(200);
    // someone else's data must never appear
    const p2 = (await other.post('/properties', { name: 'Secret House', address: 'X', city: 'Y', state: 'Z', pincode: '111111' })).body.data.id;
    await other.post('/rooms', { propertyId: p2, roomNumber: 'S1', defaultRent: 1, electricityMode: 'NONE' });
  });
  afterAll(async () => { await app.close(); resetClock(); });

  it('requires a login', async () => {
    await request(app.getHttpServer()).get('/exports/excel').expect(401);
  });

  it('downloads a real workbook with every sheet', async () => {
    const res = await download(owner, app, '/exports/excel').expect(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="RentManager-export-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    const wb = await open(res.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Tenant Ledger', 'Rooms', 'Tenants', 'Stays', 'Bills', 'Bill items', 'Payments', 'Electricity', 'Outstanding', 'Monthly']);
  });

  it('exports rooms, tenants with what they owe, bills, payments and electricity readings', async () => {
    const wb = await open((await download(owner, app, '/exports/excel')).body as Buffer);
    expect(table(wb, 'Rooms').map((r) => [r['Room'], r['Status']])).toEqual([['101', 'Occupied'], ['102', 'Vacant']]);

    const tenants = table(wb, 'Tenants').filter((r) => r['Name']);
    expect(tenants.find((t) => t['Name'] === 'Rahul Sharma')).toMatchObject({ Status: 'Current', Room: '101', Outstanding: 4700 }); // 9700 billed, 5000 paid
    expect(tenants.find((t) => t['Name'] === 'Left Behind')).toMatchObject({ Status: 'Moved out', Outstanding: 5000 });

    const bills = table(wb, 'Bills').filter((r) => r['Bill no']);
    const b = bills.find((x) => x['Tenant'] === 'Rahul Sharma')!;
    expect(b).toMatchObject({ Rent: 8000, Electricity: 1200, 'Other charges': 500, Total: 9700, Paid: 5000, Balance: 4700 });

    const pay = table(wb, 'Payments').filter((r) => r['Tenant']);
    expect(pay).toHaveLength(1);
    expect(pay[0]).toMatchObject({ Tenant: 'Rahul Sharma', Amount: 5000, Method: 'UPI', Reference: 'UTR1' });

    const el = table(wb, 'Electricity').filter((r) => r['Tenant']);
    expect(el[0]).toMatchObject({ Tenant: 'Rahul Sharma', 'Previous reading': 1200, 'Current reading': 1350, Units: 150, 'Rate per unit': 8, Amount: 1200 });

    const out = table(wb, 'Outstanding').filter((r) => r['Tenant']);
    expect(out.map((r) => [r['Tenant'], r['Status'], r['Amount due']])).toEqual([['Left Behind', 'Moved out', 5000], ['Rahul Sharma', 'Current tenant', 4700]]);

    const summary = wb.getWorksheet('Summary')!;
    const text = summary.getSheetValues().flat().join(' ');
    expect(text).toContain('Outstanding now');
    expect(text).not.toContain('Secret House');
  });

  it('never includes another owner\'s data, and can be limited to one property', async () => {
    const wb = await open((await download(other, app, '/exports/excel')).body as Buffer);
    expect(table(wb, 'Rooms').map((r) => r['Room'])).toEqual(['S1']);
    expect(table(wb, 'Bills').filter((r) => r['Bill no'])).toHaveLength(0);
    await download(other, app, `/exports/excel?propertyId=${propertyId}`).expect(404);
    const one = await open((await download(owner, app, `/exports/excel?propertyId=${propertyId}`).expect(200)).body as Buffer);
    expect(table(one, 'Rooms')).toHaveLength(2);
    await download(owner, app, '/exports/excel?propertyId=nope').expect(400);
  });
});
