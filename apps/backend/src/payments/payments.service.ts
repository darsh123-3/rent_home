import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { statusAfterPayment } from '../billing/bill-calculator';
import { BillsService, monthLabel } from '../billing/bills.service';
import { AuditService } from '../common/audit.service';
import { parseDate, todayLocal } from '../common/dates';
import { OUTSTANDING_BILL_WHERE } from '../common/outstanding';
import { paginate, skipTake } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { ListPaymentsQuery, RecordPaymentDto, RecordTenantPaymentDto } from './payments.dto';

const inr = (n: number) => `Rs ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly properties: PropertiesService,
    private readonly bills: BillsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records a payment against one bill. The balance check and the increment happen in a single
   * conditional UPDATE, so two simultaneous payments can never push paid_amount past total_due.
   * The bill's charged amounts are never touched: only paid_amount and status move.
   */
  async record(userId: string, billId: string, dto: RecordPaymentDto) {
    const bill = await this.prisma.bill.findFirst({ where: { id: billId, property: { ownerId: userId } } });
    if (!bill) throw new NotFoundException('Bill not found');

    const paymentDate = parseDate(dto.paymentDate, 'Payment date');
    // Compared with the India date, with no slack: a payment received today is accepted from 00:00 IST.
    if (paymentDate > todayLocal()) throw new BadRequestException('Payment date cannot be in the future');
    const amount = Math.round(dto.amount * 100) / 100;
    if (!(amount > 0)) throw new BadRequestException('Payment amount must be more than zero');

    const payment = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ paid_amount: Prisma.Decimal; total_due: Prisma.Decimal }[]>`
        UPDATE bills
           SET paid_amount = paid_amount + ${amount.toFixed(2)}::numeric, updated_at = now()
         WHERE id = ${billId}::uuid
           AND status NOT IN ('CANCELLED', 'DRAFT')
           AND carried_forward_to_id IS NULL
           AND paid_amount + ${amount.toFixed(2)}::numeric <= total_due
        RETURNING paid_amount, total_due`;
      if (rows.length === 0) throw await this.explainRejection(tx, billId, amount);

      const { paid_amount: paid, total_due: total } = rows[0];
      await tx.bill.update({ where: { id: billId }, data: { status: statusAfterPayment(total.toNumber(), paid.toNumber()) } });
      return tx.payment.create({
        data: { billId, tenantId: bill.tenantId, amount, paymentDate, method: dto.method, reference: dto.reference?.trim() || null, notes: dto.notes?.trim() || null },
      });
    });

    await this.audit.log(userId, 'payment.record', 'payment', payment.id, { billId, method: dto.method });
    return { payment, bill: await this.bills.get(userId, billId) };
  }

  private async explainRejection(tx: Prisma.TransactionClient, billId: string, amount: number) {
    const b = await tx.bill.findUniqueOrThrow({ where: { id: billId } });
    if (b.status === 'CANCELLED') return new ConflictException('This bill is cancelled and cannot receive payments');
    if (b.status === 'DRAFT') return new ConflictException('This bill is still a draft');
    if (b.carriedForwardToId) {
      const next = await tx.bill.findUnique({ where: { id: b.carriedForwardToId }, select: { billNumber: true } });
      return new ConflictException(`This bill's balance was carried forward to ${next?.billNumber}. Record the payment there.`);
    }
    const balance = b.totalDue.toNumber() - b.paidAmount.toNumber();
    if (balance <= 0) return new ConflictException('This bill is already fully paid');
    return new BadRequestException(`Payment of ${inr(amount)} is more than the balance of ${inr(Math.round(balance * 100) / 100)}`);
  }

  /** The bill that should receive a tenant-level payment: the newest unpaid, non carried-forward bill. */
  async openBill(userId: string, tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null, property: { ownerId: userId } }, select: { id: true } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const candidates = await this.prisma.bill.findMany({
      where: { tenantId, ...OUTSTANDING_BILL_WHERE },
      orderBy: { billingPeriod: 'desc' },
      select: { id: true, billNumber: true, billingPeriod: true, totalDue: true, paidAmount: true, dueDate: true, status: true },
    });
    const open = candidates.find((b) => b.totalDue.toNumber() > b.paidAmount.toNumber());
    return open ? { ...this.bills.present(open), label: monthLabel(open.billingPeriod) } : null;
  }

  async recordForTenant(userId: string, dto: RecordTenantPaymentDto) {
    const open = await this.openBill(userId, dto.tenantId);
    if (!open) throw new ConflictException('This tenant has no unpaid bill');
    const { amount, paymentDate, method, reference, notes } = dto;
    return this.record(userId, open.id, { amount, paymentDate, method, reference, notes });
  }

  async list(userId: string, q: ListPaymentsQuery) {
    const propertyIds = q.propertyId ? [q.propertyId] : await this.properties.ownedIds(userId);
    const search = q.search?.trim();
    const where: Prisma.PaymentWhereInput = {
      bill: { propertyId: { in: propertyIds } },
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.from || q.to ? { paymentDate: { ...(q.from ? { gte: parseDate(q.from, 'From date') } : {}), ...(q.to ? { lte: parseDate(q.to, 'To date') } : {}) } } : {}),
      ...(search ? { OR: [{ tenant: { fullName: { contains: search, mode: 'insensitive' } } }, { reference: { contains: search, mode: 'insensitive' } }, { bill: { billNumber: { contains: search, mode: 'insensitive' } } }] } : {}),
    };
    const [, total, agg, payments] = await Promise.all([
      q.propertyId ? this.properties.assertOwned(userId, q.propertyId) : null,
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({ where, _sum: { amount: true } }),
      this.prisma.payment.findMany({
        relationLoadStrategy: 'join',
        where,
        orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
        ...skipTake(q),
        include: { tenant: { select: { id: true, fullName: true } }, bill: { select: { id: true, billNumber: true, billingPeriod: true, room: { select: { roomNumber: true } } } } },
      }),
    ]);
    return { ...paginate(payments, total, q), summary: { totalAmount: agg._sum.amount ?? 0, count: total } };
  }
}
