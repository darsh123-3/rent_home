import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoomStatus } from '@prisma/client';
import { agreementInfo } from '../common/agreement';
import { AuditService } from '../common/audit.service';
import { outstandingByProperties, outstandingByTenant } from '../common/outstanding';
import { paginate, skipTake } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { CreateRoomDto, ListRoomsQuery, UpdateRoomDto } from './rooms.dto';

const activeAssignment = {
  where: { status: 'ACTIVE' as const },
  take: 1,
  include: { tenant: { select: { id: true, fullName: true, phone: true } } },
};

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly properties: PropertiesService,
    private readonly audit: AuditService,
  ) {}

  private async roomForUser(userId: string, id: string) {
    const room = await this.prisma.room.findFirst({ where: { id, property: { ownerId: userId } } });
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  async list(userId: string, q: ListRoomsQuery) {
    // Ownership is checked in parallel with the data queries: the response is discarded (404) if it fails, and one network round trip is saved.
    const propertyIds = q.propertyId ? [q.propertyId] : await this.properties.ownedIds(userId);
    const search = q.search?.trim();
    const where: Prisma.RoomWhereInput = {
      propertyId: { in: propertyIds },
      ...(q.status ? { status: q.status } : {}),
      ...(search
        ? {
            OR: [
              { roomNumber: { contains: search, mode: 'insensitive' } },
              { assignments: { some: { status: 'ACTIVE', tenant: { fullName: { contains: search, mode: 'insensitive' } } } } },
              ...((['OCCUPIED', 'VACANT', 'MAINTENANCE'] as const).filter((s) => s.startsWith(search.toUpperCase())).map((status) => ({ status })) as Prisma.RoomWhereInput[]),
            ],
          }
        : {}),
    };
    const [, total, rooms, balances] = await Promise.all([
      q.propertyId ? this.properties.assertOwned(userId, q.propertyId) : null,
      this.prisma.room.count({ where }),
      this.prisma.room.findMany({
        relationLoadStrategy: 'join',
        where,
        orderBy: [{ roomNumber: 'asc' }],
        ...skipTake(q),
        include: { assignments: activeAssignment },
      }),
      outstandingByProperties(this.prisma, propertyIds),
    ]);
    return paginate(rooms.map((r) => this.toListItem(r, balances)), total, q);
  }

  private toListItem(room: Prisma.RoomGetPayload<{ include: { assignments: typeof activeAssignment } }>, balances: Map<string, number>) {
    const { assignments, ...rest } = room;
    const a = assignments[0];
    return {
      ...rest,
      currentTenant: a ? { id: a.tenant.id, fullName: a.tenant.fullName, phone: a.tenant.phone, assignmentId: a.id } : null,
      monthlyRent: a ? a.agreedRent : room.defaultRent,
      balance: a ? balances.get(a.tenantId) ?? 0 : 0,
    };
  }

  async get(userId: string, id: string) {
    const room = await this.prisma.room.findFirst({
      relationLoadStrategy: 'join',
      where: { id, property: { ownerId: userId } },
      include: {
        property: { select: { id: true, name: true } },
        assignments: { orderBy: { startDate: 'desc' }, include: { tenant: { select: { id: true, fullName: true, phone: true } } } },
      },
    });
    if (!room) throw new NotFoundException('Room not found');
    const active = room.assignments.find((a) => a.status === 'ACTIVE');
    const balances = await outstandingByTenant(this.prisma, active ? [active.tenantId] : []);
    const { assignments, ...rest } = room;
    return {
      ...rest,
      currentTenant: active ? { ...active.tenant, assignmentId: active.id, startDate: active.startDate, securityDeposit: active.securityDeposit, ...agreementInfo(active) } : null,
      monthlyRent: active ? active.agreedRent : room.defaultRent,
      balance: active ? balances.get(active.tenantId) ?? 0 : 0,
      previousTenants: assignments
        .filter((a) => a.status === 'CLOSED')
        .map((a) => ({ assignmentId: a.id, tenantId: a.tenant.id, fullName: a.tenant.fullName, startDate: a.startDate, endDate: a.endDate, agreedRent: a.agreedRent })),
    };
  }

  /** Full assignment history for a room (current + previous). */
  async history(userId: string, id: string) {
    await this.roomForUser(userId, id);
    return this.prisma.roomAssignment.findMany({
      where: { roomId: id },
      orderBy: { startDate: 'desc' },
      include: { tenant: { select: { id: true, fullName: true, phone: true } } },
    });
  }

  async create(userId: string, dto: CreateRoomDto) {
    await this.properties.assertOwned(userId, dto.propertyId);
    const exists = await this.prisma.room.findUnique({ where: { propertyId_roomNumber: { propertyId: dto.propertyId, roomNumber: dto.roomNumber.trim() } } });
    if (exists) throw new ConflictException(`Room ${dto.roomNumber.trim()} already exists in this property`);
    const room = await this.prisma.room.create({ data: { ...dto, roomNumber: dto.roomNumber.trim(), status: 'VACANT' } });
    await this.audit.log(userId, 'room.create', 'room', room.id);
    return room;
  }

  async update(userId: string, id: string, dto: UpdateRoomDto) {
    const room = await this.roomForUser(userId, id);
    if (dto.status === 'OCCUPIED') throw new BadRequestException('A room becomes occupied by assigning a tenant');
    if (dto.status && room.status === 'OCCUPIED') throw new BadRequestException('Move the tenant out before changing the room status');
    if (dto.roomNumber && dto.roomNumber.trim() !== room.roomNumber) {
      const dup = await this.prisma.room.findUnique({ where: { propertyId_roomNumber: { propertyId: room.propertyId, roomNumber: dto.roomNumber.trim() } } });
      if (dup) throw new ConflictException(`Room ${dto.roomNumber.trim()} already exists in this property`);
    }
    const data: Prisma.RoomUpdateInput = { ...dto, ...(dto.roomNumber ? { roomNumber: dto.roomNumber.trim() } : {}), ...(dto.status ? { status: dto.status as RoomStatus } : {}) };
    const updated = await this.prisma.room.update({ where: { id }, data });
    await this.audit.log(userId, 'room.update', 'room', id);
    return updated;
  }
}
