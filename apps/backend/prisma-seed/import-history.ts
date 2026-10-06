/**
 * Writes a HistoryPlan (see history-plan.ts) into the database: rooms, every tenant who ever lived there,
 * their stays, every monthly bill since 2017 and the payments derived from the register.
 *
 * Rows are inserted directly in a few big batches (about 700 bills): going through the bill service one
 * bill at a time would take half an hour against a remote database. The arithmetic is the same pure code
 * the app uses, and the importer verifies the result afterwards against the plan.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { todayLocal } from '../src/common/dates';
import { HistoryPlan, PlanEntry, PlanStint, PlanTenant } from './history-plan';

const money = (n: number) => Math.round(n * 100) / 100;
const ymd = (ym: string, day = 1) => new Date(`${ym}-${String(day).padStart(2, '0')}T00:00:00.000Z`);
const lastDay = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0));
};
const nextMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const chunks = <T>(arr: T[], size = 400): T[][] => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size));

export interface HistoryWriteOptions {
  ownerId: string;
  propertyName: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  ratePerUnit: number;
  dueDay: number;
  billPrefix: string;
}

export interface HistoryResult {
  propertyId: string;
  bills: number;
  payments: number;
  tenants: number;
  /** Owed per tenant name when the register ends (only those who owe something). */
  dues: { name: string; current: boolean; amount: number }[];
}

type Flat = { tenant: PlanTenant; stint: PlanStint; stintIndex: number; entry: PlanEntry; index: number };

/** Deletes one property and everything under it. Payments are append-only, so that guard is lifted for the transaction. */
export async function wipeProperty(prisma: PrismaClient, propertyId: string) {
  const docs = await prisma.tenantDocument.count({ where: { tenant: { propertyId } } });
  if (docs > 0) throw new Error(`This property has ${docs} uploaded tenant documents. Delete them in the app first, then run --replace again.`);
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE payments DISABLE TRIGGER payments_append_only');
      await tx.payment.deleteMany({ where: { bill: { propertyId } } });
      await tx.$executeRawUnsafe('ALTER TABLE payments ENABLE TRIGGER payments_append_only');
      await tx.billItem.deleteMany({ where: { bill: { propertyId } } });
      await tx.electricityReading.deleteMany({ where: { assignment: { room: { propertyId } } } });
      await tx.bill.deleteMany({ where: { propertyId } });
      await tx.charge.deleteMany({ where: { assignment: { room: { propertyId } } } });
      await tx.rentHistory.deleteMany({ where: { assignment: { room: { propertyId } } } });
      await tx.roomAssignment.deleteMany({ where: { room: { propertyId } } });
      await tx.tenant.deleteMany({ where: { propertyId } });
      await tx.room.deleteMany({ where: { propertyId } });
      await tx.property.delete({ where: { id: propertyId } });
    },
    { timeout: 300_000, maxWait: 30_000 },
  );
}

export async function writeHistory(prisma: PrismaClient, plan: HistoryPlan, o: HistoryWriteOptions): Promise<HistoryResult> {
  const today = todayLocal(); // India date: an import run just after midnight IST must not cap dates at yesterday

  const propertyId = randomUUID();
  const roomId = new Map(plan.rooms.map((r) => [r.number, randomUUID()]));
  const tenantId = new Map(plan.tenants.map((t) => [t.key, randomUUID()]));
  const assignmentId = new Map<PlanStint, string>();
  const flat: Flat[] = [];
  for (const tenant of plan.tenants) {
    tenant.stints.forEach((stint, stintIndex) => {
      assignmentId.set(stint, randomUUID());
      stint.entries.forEach((entry, index) => flat.push({ tenant, stint, stintIndex, entry, index }));
    });
  }
  // Oldest first, so bill numbers (INV-YYYYMM-0001...) run in time order across the whole property.
  const roomOrder = new Map(plan.rooms.map((r, i) => [r.number, i]));
  flat.sort((a, b) => a.entry.month.localeCompare(b.entry.month) || roomOrder.get(a.entry.room)! - roomOrder.get(b.entry.room)! || a.tenant.name.localeCompare(b.tenant.name));
  const billId = new Map<PlanEntry, string>(flat.map((f) => [f.entry, randomUUID()]));
  const billNumber = new Map<PlanEntry, string>(flat.map((f, i) => [f.entry, `${o.billPrefix}-${f.entry.month.replace('-', '')}-${String(i + 1).padStart(4, '0')}`]));

  const bills: Prisma.BillCreateManyInput[] = [];
  const items: Prisma.BillItemCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const carryLinks: { id: string; next: string }[] = [];

  for (const f of flat) {
    const e = f.entry;
    const id = billId.get(e)!;
    const t = f.tenant;
    const discount = money(e.credit + e.deposit + Math.max(0, -e.adjustment));
    const other = money(e.societyElectricity + e.societyMaintenance + Math.max(0, e.adjustment));
    const status = e.paid >= e.total && e.total > 0 ? 'PAID' : e.paid > 0 ? 'PARTIALLY_PAID' : e.total === 0 ? 'PAID' : 'GENERATED';
    const stamp = ymd(e.month, 1);
    bills.push({
      id, billNumber: billNumber.get(e)!, propertyId, assignmentId: assignmentId.get(f.stint)!, tenantId: tenantId.get(t.key)!, roomId: roomId.get(e.room)!,
      billingPeriod: ymd(e.month), dueDate: ymd(e.month, o.dueDay), status,
      rentAmount: e.rent, electricityAmount: e.electricity, otherChargesAmount: other, lateFee: 0, discount, previousBalance: e.carried, totalDue: e.total, paidAmount: e.paid,
      notes: e.note ? `Imported from the Excel register. ${e.note}.` : 'Imported from the Excel register.', createdAt: stamp, updatedAt: stamp,
    });

    let sort = 0;
    const add = (type: Prisma.BillItemCreateManyInput['type'], description: string, amount: number, meta?: Prisma.InputJsonValue) =>
      items.push({ billId: id, type, description, amount, sortOrder: sort++, ...(meta ? { meta } : {}) });
    add('RENT', 'Rent', e.rent, { month: e.month });
    if (e.electricity > 0) add('ELECTRICITY', 'Electricity', e.electricity, { mode: 'METER', previousReading: null, currentReading: null, units: 0, ratePerUnit: o.ratePerUnit, calculatedAmount: e.electricity, isOverride: true });
    if (e.societyElectricity > 0) add('CHARGE', 'Society Electricity', e.societyElectricity, { chargeType: 'OTHER' });
    if (e.societyMaintenance > 0) add('CHARGE', 'Society Maintenance', e.societyMaintenance, { chargeType: 'MAINTENANCE' });
    if (e.adjustment > 0) add('CHARGE', 'Adjustment as per register', e.adjustment, { chargeType: 'OTHER' });
    if (e.credit > 0) add('DISCOUNT', 'Advance payment adjusted', -e.credit);
    if (e.deposit > 0) add('DISCOUNT', 'Security deposit adjusted', -e.deposit);
    if (e.adjustment < 0) add('DISCOUNT', 'Adjustment as per register', e.adjustment);
    if (e.carried > 0) add('PREVIOUS_BALANCE', 'Previous balance', e.carried, { bills: [], openingBalance: f.index === 0 && f.stintIndex === 0 ? e.carried : 0 });

    if (e.paid > 0) {
      const when = ymd(nextMonth(e.month), 10);
      payments.push({
        billId: id, tenantId: tenantId.get(t.key)!, amount: e.paid, paymentDate: when > today ? today : when, method: 'OTHER', reference: 'IMPORTED',
        notes: 'Derived from the Excel register (month total minus the balance carried into the next month).', createdAt: when > today ? today : when,
      });
    }
  }

  // A bill with an unpaid balance rolls into the same tenant's next bill.
  for (const t of plan.tenants) {
    const all = t.stints.flatMap((s) => s.entries);
    all.forEach((e, i) => {
      if (i < all.length - 1 && money(e.total - e.paid) > 0) carryLinks.push({ id: billId.get(e)!, next: billId.get(all[i + 1])! });
    });
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.property.create({
        data: {
          id: propertyId, ownerId: o.ownerId, name: o.propertyName, address: o.address, city: o.city, state: o.state, pincode: o.pincode,
          billPrefix: o.billPrefix, dueDayOfMonth: o.dueDay, defaultRatePerUnit: o.ratePerUnit, nextBillSeq: flat.length + 1,
        },
      });
      await tx.room.createMany({
        data: plan.rooms.map((r) => ({
          id: roomId.get(r.number)!, propertyId, roomNumber: r.number, defaultRent: r.latestRent, electricityMode: 'METER' as const, ratePerUnit: o.ratePerUnit,
          status: r.occupied ? ('OCCUPIED' as const) : ('VACANT' as const),
        })),
      });
      await tx.tenant.createMany({
        data: plan.tenants.map((t) => ({
          id: tenantId.get(t.key)!, propertyId, fullName: t.name, phone: '', joiningDate: ymd(t.stints[0].entries[0].month),
          status: t.stints.some((s) => s.current) ? ('ACTIVE' as const) : ('MOVED_OUT' as const),
          notes: t.due > 0 && !t.stints.some((s) => s.current) ? `Left with dues of Rs ${t.due} (from the Excel register).` : 'Imported from the Excel register.',
        })),
      });

      const assignments: Prisma.RoomAssignmentCreateManyInput[] = [];
      const rents: Prisma.RentHistoryCreateManyInput[] = [];
      const recurring: Prisma.ChargeCreateManyInput[] = [];
      for (const t of plan.tenants) {
        t.stints.forEach((stint, si) => {
          const id = assignmentId.get(stint)!;
          const first = stint.entries[0];
          const last = stint.entries[stint.entries.length - 1];
          assignments.push({
            id, tenantId: tenantId.get(t.key)!, roomId: roomId.get(stint.room)!, startDate: ymd(first.month), endDate: stint.current ? null : lastDay(last.month),
            agreedRent: last.rent, securityDeposit: 0, status: stint.current ? 'ACTIVE' : 'CLOSED', electricityMode: 'METER', ratePerUnit: o.ratePerUnit, initialMeterReading: 0,
            openingBalance: si === 0 ? t.openingBalance : 0,
            moveOutNotes: stint.current ? null : money(last.total - last.paid) > 0 ? `Imported. Left with Rs ${money(last.total - last.paid)} unpaid.` : 'Imported from the Excel register.',
            notes: 'Imported from the Excel register.',
          });
          let rent: number | null = null;
          for (const e of stint.entries) {
            if (rent !== e.rent) {
              rents.push({ assignmentId: id, amount: e.rent, effectiveFrom: ymd(e.month) });
              rent = e.rent;
            }
          }
          if (stint.current) {
            if (last.societyElectricity > 0) recurring.push({ assignmentId: id, type: 'OTHER', name: 'Society Electricity', amount: last.societyElectricity });
            if (last.societyMaintenance > 0) recurring.push({ assignmentId: id, type: 'MAINTENANCE', name: 'Society Maintenance', amount: last.societyMaintenance });
          }
        });
      }
      await tx.roomAssignment.createMany({ data: assignments });
      await tx.rentHistory.createMany({ data: rents });
      if (recurring.length) await tx.charge.createMany({ data: recurring });

      for (const c of chunks(bills)) await tx.bill.createMany({ data: c });
      for (const c of chunks(items, 800)) await tx.billItem.createMany({ data: c });
      for (const c of chunks(payments)) await tx.payment.createMany({ data: c });
      if (carryLinks.length) {
        await tx.$executeRaw`UPDATE bills b SET carried_forward_to_id = v.next_id
          FROM (SELECT unnest(${carryLinks.map((l) => l.id)}::uuid[]) AS id, unnest(${carryLinks.map((l) => l.next)}::uuid[]) AS next_id) v
          WHERE b.id = v.id`;
      }
      await tx.auditLog.create({
        data: { userId: o.ownerId, action: 'import.history', entity: 'property', entityId: propertyId, metadata: { bills: bills.length, payments: payments.length, tenants: plan.tenants.length } },
      });
    },
    { timeout: 600_000, maxWait: 30_000 },
  );

  const dues = plan.tenants.filter((t) => t.due > 0).map((t) => ({ name: t.name, current: t.stints.some((s) => s.current), amount: t.due }));
  return { propertyId, bills: bills.length, payments: payments.length, tenants: plan.tenants.length, dues };
}
