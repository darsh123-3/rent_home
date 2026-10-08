import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { BillItemType, BillStatus, ChargeType, Prisma } from '@prisma/client';
import { agreementInfo } from '../common/agreement';
import { AuditService } from '../common/audit.service';
import { isoDate, localDateOf, monthBounds, monthStart, parseDate, todayLocal } from '../common/dates';
import { depositSummaries } from '../common/deposits';
import { formatDate } from '../common/format';
import { OUTSTANDING_BILL_WHERE } from '../common/outstanding';
import { paginate, skipTake } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { pdfToJpeg } from './bill-image';
import { renderBillPdf } from './bill-pdf';
import { renderBillPremiumPdf } from './bill-premium-pdf';
import { renderBillStatementPdf } from './bill-statement-pdf';
import { calculateBill, calculateElectricity, fromPaise, rentForPeriod, toPaise } from './bill-calculator';
import { CreateBillDto, ListBillsQuery, PreviewBillDto, RecurringChargeDto } from './bills.dto';

/** Bill line names. CLEANING is shown as Housekeeping and INTERNET as WiFi; the stored categories keep their meaning. */
export const CHARGE_LABEL: Record<ChargeType, string> = {
  WATER: 'Water bill', CLEANING: 'Housekeeping', MNGL_GAS: 'MNGL fuel bill', INTERNET: 'WiFi connection',
  MAINTENANCE: 'Maintenance', PARKING: 'Parking', REPAIR: 'Repair', LATE_FEE: 'Late fee', OTHER: 'Other',
};

/** Monthly charges with their own line on every bill, in this order after electricity (at most one line each). */
export const MONTHLY_CHARGES = ['WATER', 'CLEANING', 'MNGL_GAS', 'INTERNET'] as const satisfies readonly ChargeType[];
export const isMonthlyCharge = (t: ChargeType): t is (typeof MONTHLY_CHARGES)[number] => (MONTHLY_CHARGES as readonly ChargeType[]).includes(t);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const money = (d: Prisma.Decimal | number) => (typeof d === 'number' ? d : d.toNumber());

/** OVERDUE is derived from the due date, so no background job is needed. */
export function effectiveStatus(bill: { status: BillStatus; dueDate: Date }, today = todayLocal()): BillStatus {
  return (bill.status === 'GENERATED' || bill.status === 'PARTIALLY_PAID') && bill.dueDate < today ? 'OVERDUE' : bill.status;
}

type DraftCharge = { type: ChargeType; name: string; amount: number; note?: string };

/**
 * Bill lines for the charges: Water, Housekeeping, MNGL fuel and WiFi first in that fixed order (at most one line each),
 * then any other charges as entered. A 0 amount leaves the line off the bill. Totals are unaffected by the order.
 */
export function orderCharges(input: { type: ChargeType; name?: string; amount: number; note?: string }[]): DraftCharge[] {
  const seen = new Set<ChargeType>();
  const lines = input.map((c) => {
    if (c.type === 'LATE_FEE') throw new BadRequestException('Enter late fees in the late fee field');
    if (isMonthlyCharge(c.type)) {
      if (seen.has(c.type)) throw new BadRequestException(`Only one ${CHARGE_LABEL[c.type]} line is allowed per bill`);
      seen.add(c.type);
    }
    const note = c.note?.trim();
    return { type: c.type, name: c.name?.trim() || CHARGE_LABEL[c.type], amount: c.amount, ...(note ? { note } : {}) };
  });
  const rank = (t: ChargeType) => (isMonthlyCharge(t) ? MONTHLY_CHARGES.indexOf(t) : MONTHLY_CHARGES.length);
  // Array.prototype.sort is stable, so other charges keep the order they were entered in.
  return lines.filter((c) => c.amount > 0).sort((a, b) => rank(a.type) - rank(b.type));
}

interface Draft {
  assignment: Prisma.RoomAssignmentGetPayload<{ include: { room: { include: { property: true } }; tenant: true } }>;
  period: Date;
  dueDate: Date;
  rent: number;
  electricity: ReturnType<typeof calculateElectricity>;
  charges: DraftCharge[];
  totals: ReturnType<typeof calculateBill>;
  carry: { id: string; billNumber: string; billingPeriod: Date; balance: number }[];
  /** Pre-system balance, only on an assignment's first live bill. */
  openingBalance: number;
  notes?: string;
}

@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService, private readonly properties: PropertiesService, private readonly audit: AuditService) {}

  private async resolveAssignment(userId: string, dto: PreviewBillDto) {
    const include = { room: { include: { property: true } }, tenant: true } as const;
    if (dto.assignmentId) {
      const a = await this.prisma.roomAssignment.findFirst({ where: { id: dto.assignmentId, room: { property: { ownerId: userId } }, tenant: { deletedAt: null } }, include });
      if (!a) throw new NotFoundException('Tenant assignment not found');
      return a;
    }
    if (dto.tenantId) {
      const a = await this.prisma.roomAssignment.findFirst({
        where: { tenantId: dto.tenantId, room: { property: { ownerId: userId } }, tenant: { deletedAt: null } },
        orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
        include,
      });
      if (!a) throw new NotFoundException('This tenant has no room assignment to bill');
      return a;
    }
    throw new BadRequestException('Choose a tenant to bill');
  }

  private async suggestPeriod(a: { id: string; startDate: Date; endDate: Date | null }) {
    const last = await this.prisma.bill.findFirst({ where: { assignmentId: a.id, status: { not: 'CANCELLED' } }, orderBy: { billingPeriod: 'desc' } });
    // Month M is billed in month M+1, once M's meter reading is in: the first suggestion is the last completed month.
    let period = last ? addMonths(last.billingPeriod, 1) : addMonths(monthStart(todayLocal()), -1);
    if (period < monthStart(a.startDate)) period = monthStart(a.startDate);
    if (a.endDate && period > monthStart(a.endDate)) period = monthStart(a.endDate);
    return period;
  }

  /** Builds the full, server-calculated bill without saving anything. */
  private async buildDraft(userId: string, dto: PreviewBillDto, db: Prisma.TransactionClient | PrismaService = this.prisma, lenient = false, replacing?: { id: string; billingPeriod: Date }): Promise<{ draft: Draft; suggestedPeriod: Date; needsReading: boolean }> {
    const assignment = await this.resolveAssignment(userId, dto);
    const suggestedPeriod = await this.suggestPeriod(assignment);
    // An edited bill keeps its month.
    const period = replacing ? replacing.billingPeriod : dto.billingPeriod ? monthStart(parseDate(`${dto.billingPeriod.slice(0, 7)}-01`, 'Billing month')) : suggestedPeriod;

    if (period < monthStart(assignment.startDate)) throw new BadRequestException('This is before the tenant moved in');
    if (assignment.endDate && period > monthStart(assignment.endDate)) throw new BadRequestException('This is after the tenant moved out');
    if (!replacing && period > addMonths(monthStart(todayLocal()), 1)) throw new BadRequestException('Bills can be generated up to one month ahead');

    const live = { assignmentId: assignment.id, status: { not: 'CANCELLED' as BillStatus }, ...(replacing ? { id: { not: replacing.id } } : {}) };
    const existing = await db.bill.findFirst({ where: { ...live, billingPeriod: period } });
    if (existing) throw new ConflictException(`A bill for ${monthLabel(period)} already exists for this tenant (${existing.billNumber})`);
    const later = await db.bill.findFirst({ where: { ...live, billingPeriod: { gt: period } } });
    if (later) throw new ConflictException(`A bill for ${monthLabel(later.billingPeriod)} already exists. Bills must be generated in order.`);

    // Rent comes from the effective-dated history, never from the client.
    const history = await db.rentHistory.findMany({ where: { assignmentId: assignment.id } });
    const rent = rentForPeriod(history.map((h) => ({ amount: money(h.amount), effectiveFrom: h.effectiveFrom })), period, money(assignment.agreedRent));

    // Electricity
    const lastReading = await db.electricityReading.findFirst({ where: { assignmentId: assignment.id, billingPeriod: { lt: period } }, orderBy: { billingPeriod: 'desc' } });
    const storedPrevious = lastReading ? money(lastReading.currentReading) : money(assignment.initialMeterReading ?? 0);
    const el = dto.electricity ?? {};
    const electricityInput = {
      mode: assignment.electricityMode,
      previousReading: el.previousReading ?? storedPrevious,
      currentReading: el.currentReading,
      ratePerUnit: el.ratePerUnit ?? money(assignment.ratePerUnit ?? assignment.room.ratePerUnit ?? assignment.room.property.defaultRatePerUnit),
      fixedAmount: money(assignment.fixedElectricity ?? 0),
      overrideAmount: el.overrideAmount,
    };
    // The preview may be requested before the meter reading is typed; creating a bill never is.
    const needsReading = lenient && electricityInput.mode === 'METER' && el.currentReading == null && el.overrideAmount == null;
    const electricity = needsReading
      ? { mode: 'METER' as const, previousReading: electricityInput.previousReading, currentReading: null, units: 0, ratePerUnit: electricityInput.ratePerUnit, calculatedAmount: 0, amount: 0, isOverride: false }
      : calculateElectricity(electricityInput);
    if (el.previousReading != null && el.previousReading !== storedPrevious && assignment.electricityMode === 'METER') electricity.isOverride = true;

    const charges = orderCharges(dto.charges ?? []);

    // Unpaid balance of earlier bills rolls into this one.
    // When editing, balances that were carried into the bill being replaced are open again for the corrected one.
    const openWhere: Prisma.BillWhereInput = replacing
      ? { status: { notIn: ['CANCELLED', 'DRAFT'] }, OR: [{ carriedForwardToId: null }, { carriedForwardToId: replacing.id }], id: { not: replacing.id } }
      : OUTSTANDING_BILL_WHERE;
    const open = await db.bill.findMany({ where: { tenantId: assignment.tenantId, ...openWhere, billingPeriod: { lt: period } }, orderBy: { billingPeriod: 'asc' } });
    const carry = open
      .map((b) => ({ id: b.id, billNumber: b.billNumber, billingPeriod: b.billingPeriod, balance: fromPaise(toPaise(money(b.totalDue)) - toPaise(money(b.paidAmount))) }))
      .filter((b) => b.balance > 0);
    // A balance owed from before this system (e.g. a spreadsheet) joins the very first bill of the assignment.
    const hasEarlierBill = await db.bill.findFirst({ where: { assignmentId: assignment.id, status: { not: 'CANCELLED' }, billingPeriod: { lt: period } }, select: { id: true } });
    const openingBalance = hasEarlierBill ? 0 : money(assignment.openingBalance);
    const previousBalance = fromPaise(carry.reduce((s, b) => s + toPaise(b.balance), 0) + toPaise(openingBalance));

    const totals = calculateBill({ rent, electricity: electricity.amount, charges, lateFee: dto.lateFee, discount: dto.discount, previousBalance });
    const dueDate = dto.dueDate ? parseDate(dto.dueDate, 'Due date') : new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, assignment.room.property.dueDayOfMonth)) // payable the month after the billing month;
    // The bill includes the month's electricity, which is only known once the month is over: it falls due after the month ends.
    const periodEnd = monthBounds(period).end;
    if (dueDate <= periodEnd) throw new BadRequestException(`Due date must be after the billing month ends (${formatDate(periodEnd)})`);

    return { draft: { assignment, period, dueDate, rent, electricity, charges, totals, carry, openingBalance, notes: dto.notes }, suggestedPeriod, needsReading };
  }

  async preview(userId: string, dto: PreviewBillDto) {
    // Editing: the bill keeps its own tenant and month, and is left out of the checks.
    const replacing = dto.replacingBillId ? await this.editableBill(userId, dto.replacingBillId) : undefined;
    const body = replacing ? { ...dto, assignmentId: replacing.assignmentId, tenantId: undefined } : dto;
    const { draft, suggestedPeriod, needsReading } = await this.buildDraft(userId, body, this.prisma, true, replacing);
    const a = draft.assignment;
    const recurring = await this.prisma.charge.findMany({ where: { assignmentId: a.id, isActive: true }, orderBy: { createdAt: 'asc' } });
    return {
      assignmentId: a.id,
      tenant: { id: a.tenant.id, fullName: a.tenant.fullName },
      room: { id: a.room.id, roomNumber: a.room.roomNumber },
      billingPeriod: draft.period,
      suggestedPeriod,
      dueDate: draft.dueDate,
      rent: draft.rent,
      // `defaultRatePerUnit` is the rate stored for this stay, so a one-off override typed in the bill form can be told apart from it.
      electricity: { ...draft.electricity, needsReading, defaultRatePerUnit: a.electricityMode === 'METER' ? money(a.ratePerUnit ?? a.room.ratePerUnit ?? a.room.property.defaultRatePerUnit) : null },
      charges: draft.charges,
      totals: draft.totals,
      carriedBills: draft.carry,
      openingBalance: draft.openingBalance,
      recurringCharges: recurring.map((c) => ({ id: c.id, type: c.type, name: c.name, amount: c.amount })),
    };
  }

  async create(userId: string, dto: CreateBillDto) {
    if (!dto.billingPeriod) throw new BadRequestException('Select the billing month');
    try {
      const bill = await this.prisma.$transaction((tx) => this.createInTx(tx, userId, { ...dto, replacingBillId: undefined }));
      await this.audit.log(userId, 'bill.create', 'bill', bill.id, { billNumber: bill.billNumber });
      return this.get(userId, bill.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A bill for this month already exists for this tenant');
      throw e;
    }
  }

  /**
   * A bill that can be edited: not cancelled, nothing paid on it, and its balance not yet carried into a later bill.
   * Bill amounts are frozen in the database, so an edit replaces the bill (see `revise`) instead of changing it.
   */
  private async editableBill(userId: string, id: string) {
    const bill = await this.ownedBill(userId, id);
    if (bill.status === 'CANCELLED') throw new ConflictException('A cancelled bill cannot be edited');
    if (money(bill.paidAmount) > 0) throw new ConflictException('This bill already has payments, so it cannot be edited. Put any correction on the next bill as an extra charge or a discount.');
    if (bill.carriedForwardToId) {
      const next = await this.prisma.bill.findUnique({ where: { id: bill.carriedForwardToId }, select: { billNumber: true } });
      throw new ConflictException(`This bill's balance is already part of ${next?.billNumber ?? 'a later bill'}. Edit that bill instead.`);
    }
    const later = await this.prisma.bill.findFirst({ where: { assignmentId: bill.assignmentId, status: { not: 'CANCELLED' }, billingPeriod: { gt: bill.billingPeriod } }, select: { billNumber: true } });
    if (later) throw new ConflictException(`Only the latest bill can be edited (${later.billNumber} comes after this one)`);
    return bill;
  }

  /**
   * Edits a bill: in one transaction the old bill is cancelled and a corrected bill for the same tenant and month is created
   * from the new details. Balances that were carried into the old bill are carried into the corrected one. Each bill notes the other.
   */
  async revise(userId: string, id: string, dto: CreateBillDto) {
    const old = await this.editableBill(userId, id);
    try {
      const bill = await this.prisma.$transaction(async (tx) => {
        // Re-checked atomically: a payment recorded meanwhile, or a carry into a later bill, stops the edit.
        const cancelled = await tx.bill.updateMany({
          where: { id, status: { notIn: ['CANCELLED', 'DRAFT'] }, paidAmount: 0, carriedForwardToId: null },
          data: { status: 'CANCELLED' },
        });
        if (cancelled.count === 0) throw new ConflictException('This bill changed while you were editing it. Open it again and retry.');
        await tx.electricityReading.deleteMany({ where: { billId: id } });
        await tx.bill.updateMany({ where: { carriedForwardToId: id }, data: { carriedForwardToId: null } });
        const created = await this.createInTx(tx, userId, {
          ...dto, assignmentId: old.assignmentId, tenantId: undefined, replacingBillId: undefined,
          billingPeriod: old.billingPeriod.toISOString().slice(0, 7),
          notes: [`Corrected version of ${old.billNumber}.`, dto.notes?.trim()].filter(Boolean).join(' '),
        });
        await tx.bill.update({ where: { id }, data: { notes: [old.notes, `Replaced by ${created.billNumber} (bill edited).`].filter(Boolean).join('\n') } });
        return created;
      });
      await this.audit.log(userId, 'bill.revise', 'bill', bill.id, { replaces: old.billNumber, billNumber: bill.billNumber });
      return this.get(userId, bill.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A bill for this month already exists for this tenant');
      throw e;
    }
  }

  /** Builds and saves a bill inside a transaction: every check re-runs there and the client's numbers are never stored. */
  private async createInTx(tx: Prisma.TransactionClient, userId: string, dto: CreateBillDto) {
    const { draft } = await this.buildDraft(userId, dto, tx);
    const { assignment: a, totals } = draft;
    const property = await tx.property.update({ where: { id: a.room.propertyId }, data: { nextBillSeq: { increment: 1 } }, select: { billPrefix: true, nextBillSeq: true } });
    const seq = property.nextBillSeq - 1;
    const billNumber = `${property.billPrefix}-${draft.period.getUTCFullYear()}${String(draft.period.getUTCMonth() + 1).padStart(2, '0')}-${String(seq).padStart(4, '0')}`;

    const el = draft.electricity;
    const items: { type: BillItemType; description: string; amount: number; meta?: Prisma.InputJsonValue }[] = [
      { type: 'RENT', description: 'Rent', amount: totals.rent, meta: { month: monthLabel(draft.period) } },
    ];
    if (el.mode !== 'NONE' && (el.amount > 0 || el.currentReading != null)) {
      items.push({
        type: 'ELECTRICITY',
        description: el.mode === 'METER' && el.currentReading != null ? `Electricity (${el.units} units x ${el.ratePerUnit})` : 'Electricity',
        amount: el.amount,
        meta: { mode: el.mode, previousReading: el.previousReading, currentReading: el.currentReading, units: el.units, ratePerUnit: el.ratePerUnit, calculatedAmount: el.calculatedAmount, isOverride: el.isOverride },
      });
    }
    for (const c of draft.charges) items.push({ type: 'CHARGE', description: c.name, amount: c.amount, meta: { chargeType: c.type, ...(c.note ? { note: c.note } : {}) } });
    if (totals.lateFee > 0) items.push({ type: 'LATE_FEE', description: 'Late fee', amount: totals.lateFee });
    if (totals.discount > 0) items.push({ type: 'DISCOUNT', description: 'Discount', amount: -totals.discount });
    if (totals.previousBalance > 0) {
      items.push({ type: 'PREVIOUS_BALANCE', description: 'Previous balance', amount: totals.previousBalance, meta: { bills: draft.carry.map((b) => b.billNumber), openingBalance: draft.openingBalance } });
    }

    const created = await tx.bill.create({
      data: {
        billNumber,
        propertyId: a.room.propertyId,
        assignmentId: a.id,
        tenantId: a.tenantId,
        roomId: a.roomId,
        billingPeriod: draft.period,
        dueDate: draft.dueDate,
        status: totals.totalDue === 0 ? 'PAID' : 'GENERATED',
        rentAmount: totals.rent,
        electricityAmount: totals.electricity,
        otherChargesAmount: totals.otherCharges,
        lateFee: totals.lateFee,
        discount: totals.discount,
        previousBalance: totals.previousBalance,
        totalDue: totals.totalDue,
        notes: draft.notes,
        // The issue moment comes from the app's clock; its India calendar day is the bill's "Issued on" date.
        createdAt: new Date(),
        items: { create: items.map((i, idx) => ({ ...i, sortOrder: idx })) },
      },
    });
    if (el.mode === 'METER' && el.currentReading != null) {
      await tx.electricityReading.create({
        data: {
          assignmentId: a.id, billingPeriod: draft.period, previousReading: el.previousReading ?? 0, currentReading: el.currentReading, units: el.units,
          ratePerUnit: el.ratePerUnit ?? 0, amount: el.amount, isOverride: el.isOverride, billId: created.id,
        },
      });
    }
    if (draft.carry.length) await tx.bill.updateMany({ where: { id: { in: draft.carry.map((b) => b.id) } }, data: { carriedForwardToId: created.id } });
    return created;
  }

  private async ownedBill(userId: string, id: string) {
    const bill = await this.prisma.bill.findFirst({ where: { id, property: { ownerId: userId } } });
    if (!bill) throw new NotFoundException('Bill not found');
    return bill;
  }

  async get(userId: string, id: string) {
    const [bill, absorbed] = await Promise.all([
    this.prisma.bill.findFirst({
      relationLoadStrategy: 'join',
      where: { id, property: { ownerId: userId } },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        tenant: { select: { id: true, fullName: true, phone: true } },
        room: { select: { id: true, roomNumber: true } },
        property: { select: { id: true, name: true, address: true, city: true, state: true, pincode: true, contactPhone: true } },
        payments: { orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }] },
        assignment: { select: { status: true, agreementStartDate: true, agreementEndDate: true } },
      },
    }),
    this.prisma.bill.findMany({ where: { carriedForwardToId: id, property: { ownerId: userId } }, select: { id: true, billNumber: true, billingPeriod: true } }),
    ]);
    if (!bill) throw new NotFoundException('Bill not found');
    const [carriedInto, deposits] = await Promise.all([
      bill.carriedForwardToId ? this.prisma.bill.findUnique({ where: { id: bill.carriedForwardToId }, select: { id: true, billNumber: true } }) : null,
      depositSummaries(this.prisma, [bill.assignmentId]),
    ]);
    const { assignment, ...rest } = bill;
    const deposit = deposits.get(bill.assignmentId);
    const presented = this.present({ ...rest, carriedInto, absorbed });
    // Payments are listed newest first by received date, so the first one is the latest money received.
    const latest = bill.payments[0];
    const settled = presented.balance <= 0 && bill.status !== 'CANCELLED' && !!latest;
    return {
      ...presented,
      paidInFullOn: settled ? isoDate(latest.paymentDate) : null,
      lastPayment: latest && !settled ? { amount: money(latest.amount), paymentDate: isoDate(latest.paymentDate) } : null,
      // Informational only: the deposit is never added to the bill.
      securityDeposit: deposit && deposit.totalReceived > 0 ? { totalReceived: deposit.totalReceived, lastReceivedOn: deposit.lastReceivedOn } : null,
      agreement: assignment.status === 'ACTIVE' ? agreementInfo(assignment) : null,
    };
  }

  /** Adds the derived fields every client needs: balance and effective (overdue-aware) status. */
  present<T extends { status: BillStatus; dueDate: Date; billingPeriod: Date; createdAt?: Date; totalDue: Prisma.Decimal; paidAmount: Prisma.Decimal }>(bill: T) {
    const balance = fromPaise(toPaise(money(bill.totalDue)) - toPaise(money(bill.paidAmount)));
    const period = monthBounds(bill.billingPeriod);
    return {
      ...bill,
      storedStatus: bill.status,
      status: effectiveStatus(bill),
      balance,
      // "Bill period" as a date range: first to last day of the billing month.
      billPeriodStart: isoDate(period.start),
      billPeriodEnd: isoDate(period.end),
      // "Issued on": the India calendar day the bill was generated (createdAt is a UTC instant).
      ...(bill.createdAt ? { issuedOn: isoDate(localDateOf(bill.createdAt)) } : {}),
    };
  }

  async list(userId: string, q: ListBillsQuery) {
    const propertyIds = q.propertyId ? [q.propertyId] : await this.properties.ownedIds(userId);
    const search = q.search?.trim();
    const today = todayLocal();
    const where: Prisma.BillWhereInput = {
      propertyId: { in: propertyIds },
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.month ? { billingPeriod: new Date(`${q.month}-01T00:00:00.000Z`) } : {}),
      ...(q.status === 'OVERDUE'
        ? { status: { in: ['GENERATED', 'PARTIALLY_PAID'] as BillStatus[] }, dueDate: { lt: today } }
        : q.status === 'GENERATED' || q.status === 'PARTIALLY_PAID'
          ? { status: q.status, dueDate: { gte: today } }
          : q.status
            ? { status: q.status }
            : {}),
      ...(search
        ? { OR: [{ billNumber: { contains: search, mode: 'insensitive' } }, { tenant: { fullName: { contains: search, mode: 'insensitive' } } }, { room: { roomNumber: { contains: search, mode: 'insensitive' } } }] }
        : {}),
    };
    const [, total, bills] = await Promise.all([
      q.propertyId ? this.properties.assertOwned(userId, q.propertyId) : null,
      this.prisma.bill.count({ where }),
      this.prisma.bill.findMany({
        relationLoadStrategy: 'join',
        where,
        orderBy: [{ billingPeriod: 'desc' }, { createdAt: 'desc' }],
        ...skipTake(q),
        select: {
          id: true, billNumber: true, billingPeriod: true, dueDate: true, status: true, totalDue: true, paidAmount: true, carriedForwardToId: true,
          tenant: { select: { id: true, fullName: true } }, room: { select: { id: true, roomNumber: true } },
        },
      }),
    ]);
    return paginate(bills.map((b) => this.present(b)), total, q);
  }

  /** `statement` (default) is the owner's one-table rent form; `invoice` is the formal A4 invoice. */
  /** `premium` (default) is the designed A4 bill; `statement` is the one-table form from the owner's spreadsheet; `invoice` the plain formal invoice. */
  async pdf(userId: string, id: string, format: 'premium' | 'statement' | 'invoice' = 'premium') {
    const bill = await this.get(userId, id);
    const property = await this.prisma.property.findUniqueOrThrow({ where: { id: bill.property.id }, select: { billFooterNote: true, upiId: true } });
    try {
      const render = format === 'invoice' ? renderBillPdf : format === 'statement' ? renderBillStatementPdf : renderBillPremiumPdf;
      const buffer = await render({
        ...bill,
        status: bill.storedStatus,
        overdue: bill.status === 'OVERDUE',
        createdAt: bill.createdAt,
        items: bill.items.map((i) => ({ type: i.type, description: i.description, amount: money(i.amount), meta: i.meta })),
        payments: bill.payments.map((p) => ({ paymentDate: p.paymentDate, method: p.method, reference: p.reference, amount: money(p.amount) })),
        rentAmount: money(bill.rentAmount), electricityAmount: money(bill.electricityAmount), otherChargesAmount: money(bill.otherChargesAmount),
        lateFee: money(bill.lateFee), discount: money(bill.discount), previousBalance: money(bill.previousBalance), totalDue: money(bill.totalDue), paidAmount: money(bill.paidAmount),
        property: { ...bill.property, billFooterNote: property.billFooterNote, upiId: property.upiId },
      });
      await this.audit.log(userId, 'bill.pdf', 'bill', id);
      return { buffer, fileName: `Invoice-${bill.billNumber}.pdf`, billNumber: bill.billNumber };
    } catch {
      throw new InternalServerErrorException('The PDF could not be generated. Please try again.');
    }
  }

  /** The bill as a JPEG picture (the premium PDF's page), for sharing on WhatsApp and similar apps. */
  async image(userId: string, id: string) {
    const { buffer: pdf, billNumber } = await this.pdf(userId, id, 'premium');
    try {
      const buffer = await pdfToJpeg(pdf);
      return { buffer, fileName: `Bill-${billNumber}.jpg` };
    } catch {
      throw new InternalServerErrorException('The bill image could not be generated. Please try again.');
    }
  }

  async cancel(userId: string, id: string, reason?: string) {
    const bill = await this.ownedBill(userId, id);
    if (bill.status === 'CANCELLED') throw new ConflictException('This bill is already cancelled');
    if (money(bill.paidAmount) > 0) throw new ConflictException('This bill has payments recorded and cannot be cancelled');
    if (bill.carriedForwardToId) throw new ConflictException('This bill\'s balance was carried into a later bill. Cancel that bill first.');
    await this.prisma.$transaction(async (tx) => {
      await tx.bill.update({ where: { id }, data: { status: 'CANCELLED', notes: reason ? `${bill.notes ? `${bill.notes}\n` : ''}Cancelled: ${reason}` : bill.notes } });
      await tx.electricityReading.deleteMany({ where: { billId: id } });
      await tx.bill.updateMany({ where: { carriedForwardToId: id }, data: { carriedForwardToId: null } });
    });
    await this.audit.log(userId, 'bill.cancel', 'bill', id, { billNumber: bill.billNumber });
    return this.get(userId, id);
  }

  /** Permanently removes a cancelled bill. Only cancelled bills with no payments can go; nothing else points at them. */
  async remove(userId: string, id: string) {
    const bill = await this.ownedBill(userId, id);
    if (bill.status !== 'CANCELLED') throw new ConflictException('Cancel the bill first, then it can be deleted');
    const payments = await this.prisma.payment.count({ where: { billId: id } });
    if (payments > 0) throw new ConflictException('This bill has payments recorded and cannot be deleted');
    await this.prisma.$transaction(async (tx) => {
      await tx.electricityReading.deleteMany({ where: { billId: id } });
      await tx.bill.updateMany({ where: { carriedForwardToId: id }, data: { carriedForwardToId: null } });
      await tx.bill.delete({ where: { id } }); // its line items are removed with it
    });
    await this.audit.log(userId, 'bill.delete', 'bill', id, { billNumber: bill.billNumber });
    return null;
  }

  // ---- recurring charges (templates used to pre-fill bills) ----

  private async ownedAssignment(userId: string, id: string) {
    const a = await this.prisma.roomAssignment.findFirst({ where: { id, room: { property: { ownerId: userId } } } });
    if (!a) throw new NotFoundException('Assignment not found');
    return a;
  }

  async listCharges(userId: string, assignmentId: string) {
    await this.ownedAssignment(userId, assignmentId);
    return this.prisma.charge.findMany({ where: { assignmentId, isActive: true }, orderBy: { createdAt: 'asc' } });
  }

  async addCharge(userId: string, assignmentId: string, dto: RecurringChargeDto) {
    await this.ownedAssignment(userId, assignmentId);
    if (dto.type === 'LATE_FEE') throw new BadRequestException('Late fees cannot be recurring');
    return this.prisma.charge.create({ data: { assignmentId, type: dto.type, name: dto.name.trim(), amount: dto.amount } });
  }

  async removeCharge(userId: string, assignmentId: string, chargeId: string) {
    await this.ownedAssignment(userId, assignmentId);
    const res = await this.prisma.charge.updateMany({ where: { id: chargeId, assignmentId }, data: { isActive: false } });
    if (!res.count) throw new NotFoundException('Charge not found');
    return null;
  }
}