import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { isoDate, monthStart, parseDate, todayLocal } from '../common/dates';
import { depositSummaries } from '../common/deposits';
import { outstandingByTenant } from '../common/outstanding';
import { PrismaService } from '../common/prisma.service';
import { AssignmentTermsDto, ChangeElectricityDto, ChangeRentDto, CreateAssignmentDto, DepositReceiptDto, MoveOutDto } from './assignments.dto';

type Tx = Prisma.TransactionClient;

/** Agreement dates are optional; when both are given the end cannot be before the start. */
export function parseAgreementDates(start?: string, end?: string) {
  const s = start ? parseDate(start, 'Agreement start date') : null;
  const e = end ? parseDate(end, 'Agreement end date') : null;
  if (s && e && e < s) throw new BadRequestException('Agreement end date cannot be before the agreement start date');
  return { start: s, end: e };
}

/** A deposit's received date: defaults to today and can never be in the future (India time). */
function parseReceivedOn(value?: string) {
  const d = value ? parseDate(value, 'Received date') : todayLocal();
  if (d > todayLocal()) throw new BadRequestException('Received date cannot be in the future');
  return d;
}

@Injectable()
export class AssignmentsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /**
   * Puts a tenant into a vacant room inside an existing transaction.
   * The room is claimed atomically (VACANT -> OCCUPIED) so two concurrent requests cannot both succeed;
   * a partial unique index in the database is the final backstop.
   */
  async assignInTx(tx: Tx, tenant: Pick<Tenant, 'id' | 'propertyId'>, terms: AssignmentTermsDto) {
    const room = await tx.room.findFirst({ where: { id: terms.roomId, propertyId: tenant.propertyId }, include: { property: true } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.status === 'OCCUPIED') throw new ConflictException('Room is already occupied');
    if (room.status === 'MAINTENANCE') throw new ConflictException('Room is under maintenance and cannot be assigned');

    const already = await tx.roomAssignment.findFirst({ where: { tenantId: tenant.id, status: 'ACTIVE' } });
    if (already) throw new ConflictException('This tenant already has an active room');

    const claimed = await tx.room.updateMany({ where: { id: room.id, status: 'VACANT' }, data: { status: 'OCCUPIED' } });
    if (claimed.count === 0) throw new ConflictException('Room is already occupied');

    const startDate = parseDate(terms.startDate, 'Start date');
    const agreement = parseAgreementDates(terms.agreementStartDate, terms.agreementEndDate);
    const deposit = terms.depositReceived ? { amount: terms.depositReceived, receivedOn: parseReceivedOn(terms.depositReceivedOn), method: terms.depositMethod ?? 'CASH' } : null;
    const mode = terms.electricityMode ?? room.electricityMode;
    const ratePerUnit = mode === 'METER' ? terms.ratePerUnit ?? room.ratePerUnit ?? room.property.defaultRatePerUnit : null;
    const fixedElectricity = mode === 'FIXED' ? terms.fixedElectricity ?? room.fixedElectricity : null;
    if (mode === 'FIXED' && fixedElectricity == null) throw new BadRequestException('Enter the fixed electricity amount');

    const assignment = await tx.roomAssignment.create({
      data: {
        tenantId: tenant.id,
        roomId: room.id,
        startDate,
        agreedRent: terms.agreedRent,
        securityDeposit: terms.securityDeposit ?? 0,
        electricityMode: mode,
        ratePerUnit,
        fixedElectricity,
        initialMeterReading: mode === 'METER' ? terms.initialMeterReading ?? 0 : null,
        openingBalance: terms.openingBalance ?? 0,
        notes: terms.notes,
        status: 'ACTIVE',
        agreementStartDate: agreement.start,
        agreementEndDate: agreement.end,
      },
    });
    await tx.rentHistory.create({ data: { assignmentId: assignment.id, amount: terms.agreedRent, effectiveFrom: monthStart(startDate) } });
    if (deposit) await tx.securityDepositReceipt.create({ data: { assignmentId: assignment.id, ...deposit, note: 'Received at move-in' } });
    await tx.tenant.update({ where: { id: tenant.id }, data: { status: 'ACTIVE' } });
    return assignment;
  }

  async create(userId: string, dto: CreateAssignmentDto) {
    const tenant = await this.prisma.tenant.findFirst({ where: { id: dto.tenantId, deletedAt: null, property: { ownerId: userId } } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    try {
      const assignment = await this.prisma.$transaction((tx) => this.assignInTx(tx, tenant, dto));
      await this.audit.log(userId, 'assignment.create', 'room_assignment', assignment.id);
      if (dto.depositReceived) await this.audit.log(userId, 'deposit.create', 'room_assignment', assignment.id, { amount: dto.depositReceived, atMoveIn: true });
      return assignment;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Room is already occupied');
      throw e;
    }
  }

  private async ownedAssignment(userId: string, id: string) {
    const a = await this.prisma.roomAssignment.findFirst({ where: { id, room: { property: { ownerId: userId } } }, include: { room: true } });
    if (!a) throw new NotFoundException('Assignment not found');
    return a;
  }

  async moveOut(userId: string, id: string, dto: MoveOutDto) {
    const a = await this.ownedAssignment(userId, id);
    if (a.status !== 'ACTIVE') throw new ConflictException('This tenant has already moved out');
    const endDate = parseDate(dto.moveOutDate, 'Move-out date');
    if (endDate < a.startDate) throw new BadRequestException('Move-out date cannot be before the move-in date');

    if (dto.finalMeterReading != null && a.electricityMode === 'METER') {
      const last = await this.prisma.electricityReading.findFirst({ where: { assignmentId: id }, orderBy: { billingPeriod: 'desc' } });
      const floor = last?.currentReading.toNumber() ?? a.initialMeterReading?.toNumber() ?? 0;
      if (dto.finalMeterReading < floor) throw new BadRequestException(`Final meter reading cannot be lower than the previous reading (${floor})`);
    }

    await this.prisma.$transaction(async (tx) => {
      const closed = await tx.roomAssignment.updateMany({
        where: { id, status: 'ACTIVE' },
        data: { status: 'CLOSED', endDate, finalMeterReading: dto.finalMeterReading, moveOutNotes: dto.notes },
      });
      if (closed.count === 0) throw new ConflictException('This tenant has already moved out');
      await tx.tenant.update({ where: { id: a.tenantId }, data: { status: 'MOVED_OUT' } });
      await tx.room.update({ where: { id: a.roomId }, data: { status: 'VACANT' } });
    });
    await this.audit.log(userId, 'assignment.move_out', 'room_assignment', id, { moveOutDate: isoDate(endDate) });

    const balance = (await outstandingByTenant(this.prisma, [a.tenantId])).get(a.tenantId) ?? 0;
    return { assignmentId: id, tenantId: a.tenantId, roomId: a.roomId, status: 'CLOSED', endDate, finalBalance: balance };
  }

  /** Records a rent change effective from a month. Past bills are never touched. */
  async changeRent(userId: string, id: string, dto: ChangeRentDto) {
    const a = await this.ownedAssignment(userId, id);
    if (a.status !== 'ACTIVE') throw new ConflictException('Rent can only be changed for an active assignment');
    const effectiveFrom = monthStart(parseDate(dto.effectiveFrom, 'Effective date'));
    if (effectiveFrom < monthStart(a.startDate)) throw new BadRequestException('Rent cannot change before the move-in month');

    await this.prisma.$transaction(async (tx) => {
      await tx.rentHistory.upsert({
        where: { assignmentId_effectiveFrom: { assignmentId: id, effectiveFrom } },
        create: { assignmentId: id, amount: dto.amount, effectiveFrom },
        update: { amount: dto.amount },
      });
      const latest = await tx.rentHistory.findFirstOrThrow({ where: { assignmentId: id }, orderBy: { effectiveFrom: 'desc' } });
      await tx.roomAssignment.update({ where: { id }, data: { agreedRent: latest.amount } });
    });
    await this.audit.log(userId, 'assignment.rent_change', 'room_assignment', id, { amount: dto.amount, effectiveFrom: isoDate(effectiveFrom) });
    return this.rentHistory(userId, id);
  }

  /** Sets the per-unit rate (or fixed amount) used for this stay's future bills; optionally also the room's default. */
  async changeElectricity(userId: string, id: string, dto: ChangeElectricityDto) {
    const a = await this.ownedAssignment(userId, id);
    if (a.status !== 'ACTIVE') throw new ConflictException('Electricity terms can only be changed for an active assignment');
    const mode = dto.electricityMode ?? a.electricityMode;
    if (mode === 'METER' && dto.ratePerUnit == null && a.ratePerUnit == null) throw new BadRequestException('Enter the rate per unit');
    if (mode === 'FIXED' && dto.fixedElectricity == null && a.fixedElectricity == null) throw new BadRequestException('Enter the fixed electricity amount');
    const data: Prisma.RoomAssignmentUpdateInput = {
      electricityMode: mode,
      ratePerUnit: mode === 'METER' ? dto.ratePerUnit ?? a.ratePerUnit : null,
      fixedElectricity: mode === 'FIXED' ? dto.fixedElectricity ?? a.fixedElectricity : null,
      // A meter stay needs a starting reading to bill from.
      ...(mode === 'METER' && a.initialMeterReading == null ? { initialMeterReading: 0 } : {}),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.roomAssignment.update({ where: { id }, data });
      if (dto.applyToRoom) {
        await tx.room.update({
          where: { id: a.roomId },
          data: { electricityMode: mode, ratePerUnit: mode === 'METER' ? dto.ratePerUnit ?? a.ratePerUnit : null, fixedElectricity: mode === 'FIXED' ? dto.fixedElectricity ?? a.fixedElectricity : null },
        });
      }
    });
    await this.audit.log(userId, 'assignment.electricity_change', 'room_assignment', id, { mode, ratePerUnit: dto.ratePerUnit, fixed: dto.fixedElectricity });
    return this.prisma.roomAssignment.findUniqueOrThrow({ where: { id } });
  }

  async rentHistory(userId: string, id: string) {
    await this.ownedAssignment(userId, id);
    return this.prisma.rentHistory.findMany({ where: { assignmentId: id }, orderBy: { effectiveFrom: 'desc' } });
  }

  /** Sets or clears (null) the agreement dates of a tenant's active stay. */
  async updateAgreementInTx(tx: Tx, tenantId: string, dates: { agreementStartDate?: string | null; agreementEndDate?: string | null }) {
    const a = await tx.roomAssignment.findFirst({ where: { tenantId, status: 'ACTIVE' } });
    if (!a) throw new ConflictException('Agreement dates can only be set while the tenant has a room');
    const start = dates.agreementStartDate === undefined ? (a.agreementStartDate ? isoDate(a.agreementStartDate) : undefined) : dates.agreementStartDate ?? undefined;
    const end = dates.agreementEndDate === undefined ? (a.agreementEndDate ? isoDate(a.agreementEndDate) : undefined) : dates.agreementEndDate ?? undefined;
    const parsed = parseAgreementDates(start, end);
    await tx.roomAssignment.update({ where: { id: a.id }, data: { agreementStartDate: parsed.start, agreementEndDate: parsed.end } });
    return a.id;
  }

  // ---- security deposit received (instalments with dates) ----

  async deposits(userId: string, id: string) {
    await this.ownedAssignment(userId, id);
    return (await depositSummaries(this.prisma, [id])).get(id)!;
  }

  async addDeposit(userId: string, id: string, dto: DepositReceiptDto) {
    await this.ownedAssignment(userId, id);
    const receipt = await this.prisma.securityDepositReceipt.create({
      data: { assignmentId: id, amount: dto.amount, receivedOn: parseReceivedOn(dto.receivedOn), method: dto.method, note: dto.note?.trim() || null },
    });
    await this.audit.log(userId, 'deposit.create', 'security_deposit_receipt', receipt.id, { assignmentId: id, amount: dto.amount, receivedOn: dto.receivedOn });
    return this.deposits(userId, id);
  }

  async removeDeposit(userId: string, id: string, receiptId: string) {
    await this.ownedAssignment(userId, id);
    const res = await this.prisma.securityDepositReceipt.deleteMany({ where: { id: receiptId, assignmentId: id } });
    if (!res.count) throw new NotFoundException('Deposit entry not found');
    await this.audit.log(userId, 'deposit.delete', 'security_deposit_receipt', receiptId, { assignmentId: id });
    return this.deposits(userId, id);
  }

  async listForTenant(userId: string, tenantId: string) {
    return this.prisma.roomAssignment.findMany({
      where: { tenantId, room: { property: { ownerId: userId } } },
      orderBy: { startDate: 'desc' },
      include: { room: { select: { id: true, roomNumber: true, property: { select: { id: true, name: true } } } } },
    });
  }
}
