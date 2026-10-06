import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AssignmentsService } from '../assignments/assignments.service';
import { AuditService } from '../common/audit.service';
import { agreementInfo } from '../common/agreement';
import { parseDate, todayLocal } from '../common/dates';
import { depositSummaries } from '../common/deposits';
import { formatINR } from '../common/format';
import { outstandingByProperties, outstandingByTenant } from '../common/outstanding';
import { paginate, skipTake } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { CreateTenantDto, ListTenantsQuery, UpdateTenantDto } from './tenants.dto';

const currentAssignmentInclude = {
  where: { status: 'ACTIVE' as const },
  take: 1,
  include: { room: { select: { id: true, roomNumber: true } } },
};

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly properties: PropertiesService,
    private readonly assignments: AssignmentsService,
    private readonly audit: AuditService,
  ) {}

  async assertOwned(userId: string, id: string) {
    const tenant = await this.prisma.tenant.findFirst({ where: { id, deletedAt: null, property: { ownerId: userId } } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async list(userId: string, q: ListTenantsQuery) {
    // Ownership is checked in parallel with the data queries (the response is discarded with a 404 if it fails).
    const propertyIds = q.propertyId ? [q.propertyId] : await this.properties.ownedIds(userId);
    const search = q.search?.trim();
    const where: Prisma.TenantWhereInput = {
      propertyId: { in: propertyIds },
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      // An open bill (unpaid or part paid, not rolled into a later bill) means the tenant owes money.
      ...(q.dues === 'true' ? { bills: { some: { status: { in: ['GENERATED' as const, 'PARTIALLY_PAID' as const] }, carriedForwardToId: null } } } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search.replace(/[\s-]/g, '') } },
              { email: { contains: search, mode: 'insensitive' } },
              { assignments: { some: { room: { roomNumber: { contains: search, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const [, total, tenants, balances] = await Promise.all([
      q.propertyId ? this.properties.assertOwned(userId, q.propertyId) : null,
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        relationLoadStrategy: 'join',
        where,
        orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
        ...skipTake(q),
        include: { assignments: currentAssignmentInclude },
      }),
      outstandingByProperties(this.prisma, propertyIds),
    ]);
    const today = todayLocal();
    const items = tenants.map(({ assignments, ...t }) => {
      const a = assignments[0];
      return {
        id: t.id, fullName: t.fullName, phone: t.phone, email: t.email, status: t.status, joiningDate: t.joiningDate,
        room: a ? { id: a.room.id, roomNumber: a.room.roomNumber } : null,
        assignmentId: a?.id ?? null,
        monthlyRent: a?.agreedRent ?? null,
        balance: balances.get(t.id) ?? 0,
        agreement: a ? agreementInfo(a, today) : null,
      };
    });
    return paginate(items, total, q);
  }

  /** Every month's electricity for a tenant, newest first, with readings where they were recorded. */
  async electricity(userId: string, id: string) {
    const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);
    const [, bills] = await Promise.all([
      this.assertOwned(userId, id),
      this.prisma.bill.findMany({
        relationLoadStrategy: 'join',
        where: { tenantId: id, property: { ownerId: userId }, status: { notIn: ['CANCELLED', 'DRAFT'] }, OR: [{ electricityAmount: { gt: 0 } }, { items: { some: { type: 'ELECTRICITY' } } }] },
        orderBy: { billingPeriod: 'desc' },
        select: { id: true, billNumber: true, billingPeriod: true, electricityAmount: true, room: { select: { roomNumber: true } }, items: { where: { type: 'ELECTRICITY' }, select: { meta: true } } },
      }),
    ]);
    const rows = bills.map((b) => {
      const meta = (b.items[0]?.meta ?? {}) as Record<string, unknown>;
      const metered = num(meta.currentReading) != null;
      return {
        billId: b.id, billNumber: b.billNumber, month: b.billingPeriod, roomNumber: b.room.roomNumber, amount: b.electricityAmount.toNumber(),
        // Readings and rate are only known for bills made with a meter reading; amounts imported from a spreadsheet have just the total.
        previousReading: metered ? num(meta.previousReading) : null, currentReading: metered ? num(meta.currentReading) : null,
        units: metered ? num(meta.units) : null, ratePerUnit: metered ? num(meta.ratePerUnit) : null, adjusted: meta.isOverride === true,
      };
    });
    const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const metered = rows.filter((r) => r.units != null);
    const peak = rows.reduce<(typeof rows)[number] | null>((m, r) => (!m || r.amount > m.amount ? r : m), null);
    return {
      rows,
      summary: {
        months: rows.length,
        totalAmount: total,
        averageMonthly: rows.length ? Math.round((total / rows.length) * 100) / 100 : 0,
        totalUnits: metered.length ? Math.round(metered.reduce((s, r) => s + (r.units ?? 0), 0) * 100) / 100 : null,
        latestRate: metered[0]?.ratePerUnit ?? null,
        highest: peak ? { month: peak.month, amount: peak.amount } : null,
      },
    };
  }

  async get(userId: string, id: string) {
    const [tenant, balances] = await Promise.all([
    this.prisma.tenant.findFirst({
      relationLoadStrategy: 'join',
      where: { id, deletedAt: null, property: { ownerId: userId } },
      include: {
        property: { select: { id: true, name: true } },
        assignments: {
          orderBy: { startDate: 'desc' },
          include: { room: { select: { id: true, roomNumber: true } }, rents: { orderBy: { effectiveFrom: 'desc' } } },
        },
        documents: { where: { deletedAt: null }, select: { id: true, type: true } },
      },
    }),
    outstandingByTenant(this.prisma, [id]),
    ]);
    if (!tenant) throw new NotFoundException('Tenant not found');
    const { assignments, documents, ...rest } = tenant;
    const active = assignments.find((a) => a.status === 'ACTIVE') ?? null;
    const balance = balances.get(id) ?? 0;
    const depositStay = active ?? assignments[0];
    const deposit = depositStay ? (await depositSummaries(this.prisma, [depositStay.id])).get(depositStay.id) ?? null : null;
    return {
      ...rest,
      currentAssignment: active && {
        id: active.id, room: active.room, startDate: active.startDate, agreedRent: active.agreedRent, securityDeposit: active.securityDeposit,
        electricityMode: active.electricityMode, ratePerUnit: active.ratePerUnit, fixedElectricity: active.fixedElectricity,
        initialMeterReading: active.initialMeterReading, rents: active.rents,
        ...agreementInfo(active),
      },
      securityDeposit: deposit,
      // The latest assignment, used for the summary when the tenant has moved out
      lastAssignment: active ? null : assignments[0] && { id: assignments[0].id, room: assignments[0].room, startDate: assignments[0].startDate, endDate: assignments[0].endDate, agreedRent: assignments[0].agreedRent, securityDeposit: assignments[0].securityDeposit },
      roomHistory: assignments.map((a) => ({
        assignmentId: a.id, room: a.room, startDate: a.startDate, endDate: a.endDate, agreedRent: a.agreedRent,
        securityDeposit: a.securityDeposit, status: a.status, finalMeterReading: a.finalMeterReading, moveOutNotes: a.moveOutNotes,
      })),
      documentTypes: documents.map((d) => d.type),
      outstanding: balance,
    };
  }

  async create(userId: string, dto: CreateTenantDto) {
    const { assignment, propertyId: requestedProperty, joiningDate, ...fields } = dto;
    let propertyId = requestedProperty;
    if (assignment) {
      const room = await this.prisma.room.findFirst({ where: { id: assignment.roomId, property: { ownerId: userId } }, select: { propertyId: true } });
      if (!room) throw new NotFoundException('Room not found');
      if (propertyId && propertyId !== room.propertyId) throw new BadRequestException('Room does not belong to that property');
      propertyId = room.propertyId;
    }
    if (!propertyId) throw new BadRequestException('Select a property for this tenant');
    await this.properties.assertOwned(userId, propertyId);
    const joined = parseDate(joiningDate, 'Joining date');

    try {
      const tenant = await this.prisma.$transaction(async (tx) => {
        const created = await tx.tenant.create({ data: { ...fields, propertyId: propertyId!, joiningDate: joined, status: 'ACTIVE' } });
        if (assignment) await this.assignments.assignInTx(tx, created, assignment);
        return created;
      });
      await this.audit.log(userId, 'tenant.create', 'tenant', tenant.id);
      if (assignment?.depositReceived) await this.audit.log(userId, 'deposit.create', 'tenant', tenant.id, { amount: assignment.depositReceived, atMoveIn: true });
      return this.get(userId, tenant.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Room is already occupied');
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdateTenantDto) {
    await this.assertOwned(userId, id);
    const { joiningDate, agreementStartDate, agreementEndDate, ...rest } = dto;
    const agreementChanged = agreementStartDate !== undefined || agreementEndDate !== undefined;
    await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id }, data: { ...rest, ...(joiningDate ? { joiningDate: parseDate(joiningDate, 'Joining date') } : {}) } });
      // '' clears a date; undefined leaves it as it is.
      if (agreementChanged) {
        await this.assignments.updateAgreementInTx(tx, id, {
          ...(agreementStartDate !== undefined ? { agreementStartDate: agreementStartDate || null } : {}),
          ...(agreementEndDate !== undefined ? { agreementEndDate: agreementEndDate || null } : {}),
        });
      }
    });
    await this.audit.log(userId, 'tenant.update', 'tenant', id);
    return this.get(userId, id);
  }

  /** Soft delete: hides the tenant but keeps assignments, bills and payments intact. */
  async remove(userId: string, id: string) {
    await this.assertOwned(userId, id);
    const active = await this.prisma.roomAssignment.findFirst({ where: { tenantId: id, status: 'ACTIVE' } });
    if (active) throw new ConflictException('Move the tenant out before deleting their record');
    // A deleted tenant disappears from the lists, so their dues must not stay behind in the totals.
    const owed = (await outstandingByTenant(this.prisma, [id])).get(id) ?? 0;
    if (owed > 0) throw new ConflictException(`This tenant still owes ${formatINR(owed)}. Record the payment first, then delete the tenant.`);
    await this.prisma.tenant.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log(userId, 'tenant.delete', 'tenant', id);
    return null;
  }
}