import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { fromPaise, toPaise } from '../billing/bill-calculator';
import { monthLabel } from '../billing/bills.service';
import { chargesByCategory } from '../common/charges';
import { todayLocal } from '../common/dates';
import { OUTSTANDING_BILL_WHERE } from '../common/outstanding';
import { STANDING_PAYMENT_WHERE } from '../common/payment-filters';
import { PrismaService } from '../common/prisma.service';
import { PropertiesService } from '../properties/properties.service';

const MS_DAY = 86_400_000;
const CATEGORY_ORDER = ['WATER', 'CLEANING', 'MNGL_GAS', 'INTERNET', 'OTHER'] as const;
const CATEGORY_LABEL = { WATER: 'Water bill', CLEANING: 'Housekeeping', MNGL_GAS: 'MNGL fuel bill', INTERNET: 'WiFi connection', OTHER: 'Other charges' } as const;
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : typeof d === 'number' ? d : d.toNumber());
const ymOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export const currentMonth = () => ymOf(todayLocal());
const bounds = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0)) };
};
export const shift = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number);
  return ymOf(new Date(Date.UTC(y, m - 1 + delta, 1)));
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly properties: PropertiesService) {}

  async scope(userId: string, propertyId?: string) {
    return propertyId ? [(await this.properties.assertOwned(userId, propertyId)).id] : this.properties.ownedIds(userId);
  }

  /** This month, unless nothing is billed yet: then the most recent month that has bills, so the dashboard is never empty by accident. */
  private async defaultMonth(propertyIds: string[]) {
    const now = currentMonth();
    const live = { propertyId: { in: propertyIds }, status: { notIn: ['CANCELLED' as const, 'DRAFT' as const] } };
    // One query: the latest billed month up to (and including) the current one; the current month wins when it has bills.
    const latest = await this.prisma.bill.findFirst({ where: { ...live, billingPeriod: { lte: bounds(now).start } }, orderBy: { billingPeriod: 'desc' }, select: { billingPeriod: true } });
    return latest ? ymOf(latest.billingPeriod) : now;
  }

  /** What was billed for the month, what came in during it, and what is still owed right now. */
  async collection(userId: string, q: { propertyId?: string; month?: string }) {
    return this.collectionFor(await this.scope(userId, q.propertyId), q.month);
  }

  /** Same as `collection` for property ids the caller has already verified as the user's own. */
  async collectionFor(propertyIds: string[], requestedMonth?: string) {
    const month = requestedMonth ?? (await this.defaultMonth(propertyIds));
    const { start, end } = bounds(month);

    const [billed, collected, byMethod, outstanding, trend, chargeItems] = await Promise.all([
      this.prisma.bill.findMany({
        where: { propertyId: { in: propertyIds }, billingPeriod: start, status: { notIn: ['CANCELLED', 'DRAFT'] } },
        select: { totalDue: true, previousBalance: true, rentAmount: true, electricityAmount: true, otherChargesAmount: true },
      }),
      this.prisma.payment.aggregate({ where: { ...STANDING_PAYMENT_WHERE, bill: { propertyId: { in: propertyIds } }, paymentDate: { gte: start, lte: end } }, _sum: { amount: true }, _count: true }),
      this.prisma.payment.groupBy({ by: ['method'], where: { ...STANDING_PAYMENT_WHERE, bill: { propertyId: { in: propertyIds } }, paymentDate: { gte: start, lte: end } }, _sum: { amount: true }, _count: true }),
      this.totalOutstanding(propertyIds),
      this.trend(propertyIds, month),
      this.prisma.billItem.findMany({
        where: { type: 'CHARGE', bill: { propertyId: { in: propertyIds }, billingPeriod: start, status: { notIn: ['CANCELLED', 'DRAFT'] } } },
        select: { type: true, amount: true, meta: true },
      }),
    ]);
    const cat = chargesByCategory(chargeItems);
    const counts = chargesByCategory(chargeItems.map((i) => ({ ...i, amount: 1 })));
    // "Expected" is this month's own charges, not the arrears that were rolled into them.
    const expected = fromPaise(billed.reduce((s, b) => s + toPaise(num(b.totalDue)) - toPaise(num(b.previousBalance)), 0));
    const collectedAmount = num(collected._sum.amount);
    const sumOf = (pick: (b: (typeof billed)[number]) => Prisma.Decimal) => fromPaise(billed.reduce((s, b) => s + toPaise(num(pick(b))), 0));
    return {
      /** What this month's bills are made of (rent, electricity, other charges), excluding carried-over arrears. */
      composition: { rent: sumOf((b) => b.rentAmount), electricity: sumOf((b) => b.electricityAmount), other: sumOf((b) => b.otherChargesAmount), bills: billed.length },
      month,
      monthLabel: monthLabel(start),
      expected,
      collected: collectedAmount,
      paymentCount: collected._count,
      pending: outstanding,
      collectionRate: expected > 0 ? Math.min(1, collectedAmount / expected) : 0,
      // Water, Housekeeping, MNGL gas, WiFi and every other charge billed for the month.
      byCategory: CATEGORY_ORDER.map((c) => ({ category: c, label: CATEGORY_LABEL[c], amount: cat[c], count: counts[c] })),
      byMethod: byMethod.map((m) => ({ method: m.method, amount: num(m._sum.amount), count: m._count })).sort((a, b) => b.amount - a.amount),
      trend,
    };
  }

  /** Last six months ending at `month`: billed vs collected. */
  private async trend(propertyIds: string[], month: string) {
    const months = Array.from({ length: 6 }, (_, i) => shift(month, i - 5));
    const from = bounds(months[0]).start;
    const to = bounds(month).end;
    const [billed, paid] = await Promise.all([
      this.prisma.$queryRaw<{ ym: string; amount: Prisma.Decimal }[]>`
        SELECT to_char(billing_period, 'YYYY-MM') AS ym, COALESCE(SUM(total_due - previous_balance), 0) AS amount
          FROM bills WHERE property_id = ANY(${propertyIds}::uuid[]) AND status NOT IN ('CANCELLED', 'DRAFT') AND billing_period BETWEEN ${from} AND ${to}
         GROUP BY 1`,
      this.prisma.$queryRaw<{ ym: string; amount: Prisma.Decimal }[]>`
        SELECT to_char(p.payment_date, 'YYYY-MM') AS ym, COALESCE(SUM(p.amount), 0) AS amount
          FROM payments p JOIN bills b ON b.id = p.bill_id
         WHERE b.property_id = ANY(${propertyIds}::uuid[]) AND p.payment_date BETWEEN ${from} AND ${to}
           AND p.reversal_of_id IS NULL AND NOT EXISTS (SELECT 1 FROM payments r WHERE r.reversal_of_id = p.id)
         GROUP BY 1`,
    ]);
    const get = (rows: { ym: string; amount: Prisma.Decimal }[], ym: string) => num(rows.find((r) => r.ym === ym)?.amount);
    return months.map((ym) => ({ month: ym, label: monthLabel(bounds(ym).start).slice(0, 3), expected: get(billed, ym), collected: get(paid, ym) }));
  }

  private async openBills(propertyIds: string[]) {
    const bills = await this.prisma.bill.findMany({
      relationLoadStrategy: 'join',
      where: { propertyId: { in: propertyIds }, ...OUTSTANDING_BILL_WHERE },
      select: {
        id: true, tenantId: true, billNumber: true, dueDate: true, totalDue: true, paidAmount: true, roomId: true, status: true,
        tenant: { select: { id: true, fullName: true, phone: true, status: true } }, room: { select: { roomNumber: true } },
      },
    });
    return bills.map((b) => ({ ...b, balance: fromPaise(toPaise(num(b.totalDue)) - toPaise(num(b.paidAmount))) })).filter((b) => b.balance > 0);
  }

  async totalOutstanding(propertyIds: string[]) {
    const open = await this.openBills(propertyIds);
    return fromPaise(open.reduce((s, b) => s + toPaise(b.balance), 0));
  }

  async outstanding(userId: string, q: { propertyId?: string }) {
    return this.outstandingFor(await this.scope(userId, q.propertyId));
  }

  async outstandingFor(propertyIds: string[]) {
    const open = await this.openBills(propertyIds);
    const today = todayLocal();
    const byTenant = new Map<string, { balance: number; oldestDue: Date; billCount: number; billId: string; roomId: string; tenant: (typeof open)[number]['tenant']; roomNumber: string }>();
    for (const b of open) {
      const cur = byTenant.get(b.tenantId);
      byTenant.set(b.tenantId, {
        balance: fromPaise(toPaise(cur?.balance ?? 0) + toPaise(b.balance)),
        oldestDue: cur && cur.oldestDue < b.dueDate ? cur.oldestDue : b.dueDate,
        billCount: (cur?.billCount ?? 0) + 1,
        billId: b.id,
        roomId: b.roomId,
        tenant: b.tenant,
        roomNumber: b.room.roomNumber,
      });
    }
    const items = [...byTenant.values()]
      .map((v) => {
        const t = v.tenant;
        const overdueDays = Math.max(0, Math.floor((today.getTime() - v.oldestDue.getTime()) / MS_DAY));
        return {
          tenantId: t.id, fullName: t.fullName, phone: t.phone, tenantStatus: t.status,
          roomNumber: v.roomNumber ?? '-',
          balance: v.balance, billId: v.billId, billCount: v.billCount, dueDate: v.oldestDue, overdueDays,
        };
      })
      .sort((a, b) => b.balance - a.balance);
    // Who owes it, and how late: lets the dashboard separate current tenants from people who have moved out.
    const sumBills = (list: typeof open) => fromPaise(list.reduce((s, b) => s + toPaise(b.balance), 0));
    const tenantsIn = (list: typeof open) => new Set(list.map((b) => b.tenantId)).size;
    const former = open.filter((b) => b.tenant.status !== 'ACTIVE');
    const current = open.filter((b) => b.tenant.status === 'ACTIVE');
    const overdue = open.filter((b) => b.dueDate < today);
    const dueSoon = open.filter((b) => b.dueDate >= today && b.dueDate.getTime() - today.getTime() <= 7 * MS_DAY);
    const oldest = former.reduce<Date | null>((m, b) => (!m || b.dueDate < m ? b.dueDate : m), null);
    const stats = {
      currentTenants: { amount: sumBills(current), count: tenantsIn(current) },
      formerTenants: { amount: sumBills(former), count: tenantsIn(former), oldestDue: oldest },
      overdue: { amount: sumBills(overdue), count: tenantsIn(overdue) },
      dueSoon: { amount: sumBills(dueSoon), count: tenantsIn(dueSoon) },
    };
    return { total: fromPaise(items.reduce((s, i) => s + toPaise(i.balance), 0)), count: items.length, items, stats };
  }

  /** Smaller numbers the Home screen shows next to the big ones. All run in parallel with the other dashboard queries. */
  async extrasFor(propertyIds: string[]) {
    const today = todayLocal();
    const thisMonth = shift(ymOf(today), -1); // the month whose bills are being prepared now (last month's readings)
    const week = new Date(today.getTime() - 6 * MS_DAY);
    const inProperty = { room: { propertyId: { in: propertyIds } } };
    const [rentRoll, lastWeek, recent, toBill] = await Promise.all([
      this.prisma.roomAssignment.aggregate({ where: { status: 'ACTIVE', ...inProperty }, _sum: { agreedRent: true }, _count: true }),
      this.prisma.payment.aggregate({ where: { ...STANDING_PAYMENT_WHERE, bill: { propertyId: { in: propertyIds } }, paymentDate: { gte: week, lte: today } }, _sum: { amount: true }, _count: true }),
      this.prisma.payment.findMany({
        relationLoadStrategy: 'join',
        where: { ...STANDING_PAYMENT_WHERE, bill: { propertyId: { in: propertyIds } } },
        orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
        take: 5,
        select: { id: true, amount: true, paymentDate: true, method: true, billId: true, tenant: { select: { id: true, fullName: true } }, bill: { select: { room: { select: { roomNumber: true } } } } },
      }),
      this.prisma.roomAssignment.findMany({
        where: { status: 'ACTIVE', ...inProperty, bills: { none: { billingPeriod: bounds(thisMonth).start, status: { notIn: ['CANCELLED'] } } } },
        orderBy: { room: { roomNumber: 'asc' } },
        select: { tenant: { select: { id: true, fullName: true } }, room: { select: { roomNumber: true } } },
      }),
    ]);
    return {
      rentRoll: { monthly: num(rentRoll._sum.agreedRent), tenants: rentRoll._count },
      last7Days: { amount: num(lastWeek._sum.amount), count: lastWeek._count },
      recentPayments: recent.map((p) => ({ id: p.id, amount: num(p.amount), paymentDate: p.paymentDate, method: p.method, billId: p.billId, tenantId: p.tenant.id, tenantName: p.tenant.fullName, roomNumber: p.bill.room.roomNumber })),
      toBill: { month: thisMonth, monthLabel: monthLabel(bounds(thisMonth).start), count: toBill.length, tenants: toBill.map((a) => ({ tenantId: a.tenant.id, tenantName: a.tenant.fullName, roomNumber: a.room.roomNumber })) },
    };
  }

  async occupancy(userId: string, q: { propertyId?: string }) {
    return this.occupancyFor(await this.scope(userId, q.propertyId));
  }

  async occupancyFor(propertyIds: string[]) {
    const rooms = await this.prisma.room.findMany({ where: { propertyId: { in: propertyIds } }, select: { id: true, roomNumber: true, status: true, defaultRent: true }, orderBy: { roomNumber: 'asc' } });
    const count = (s: string) => rooms.filter((r) => r.status === s).length;
    const occupied = count('OCCUPIED');
    const rentable = rooms.length - count('MAINTENANCE');
    const vacant = rooms.filter((r) => r.status === 'VACANT');
    return {
      totalRooms: rooms.length,
      occupied,
      vacant: vacant.length,
      maintenance: count('MAINTENANCE'),
      occupancyPercent: rooms.length ? Math.round((occupied / rooms.length) * 100) : 0,
      rentableOccupancyPercent: rentable ? Math.round((occupied / rentable) * 100) : 0,
      vacantRooms: vacant.map((r) => ({ id: r.id, roomNumber: r.roomNumber, defaultRent: num(r.defaultRent) })),
      vacantRentPotential: fromPaise(vacant.reduce((s, r) => s + toPaise(num(r.defaultRent)), 0)),
    };
  }
}