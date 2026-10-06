import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { CreatePropertyDto, UpdatePropertyDto } from './properties.dto';

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Throws 404 unless the property belongs to the user. Use before touching anything under a property. */
  async assertOwned(userId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, ownerId: userId, isActive: true } });
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  async ownedIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.property.findMany({ where: { ownerId: userId, isActive: true }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  async list(userId: string) {
    const properties = await this.prisma.property.findMany({
      relationLoadStrategy: 'join',
      where: { ownerId: userId, isActive: true },
      orderBy: { createdAt: 'asc' },
      include: { rooms: { select: { status: true } } },
    });
    return properties.map(({ rooms, ...p }) => ({
      ...p,
      roomCount: rooms.length,
      occupiedCount: rooms.filter((r) => r.status === 'OCCUPIED').length,
    }));
  }

  async get(userId: string, id: string) {
    return this.assertOwned(userId, id);
  }

  async create(userId: string, dto: CreatePropertyDto) {
    const property = await this.prisma.property.create({ data: { ...dto, ownerId: userId } });
    await this.audit.log(userId, 'property.create', 'property', property.id);
    return property;
  }

  async update(userId: string, id: string, dto: UpdatePropertyDto) {
    await this.assertOwned(userId, id);
    const property = await this.prisma.property.update({
      where: { id },
      data: { ...dto, ...(dto.upiId !== undefined ? { upiId: dto.upiId.trim() || null } : {}), ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone || null } : {}) },
    });
    await this.audit.log(userId, 'property.update', 'property', id);
    return property;
  }
}
