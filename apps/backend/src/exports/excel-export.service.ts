import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { effectiveStatus } from '../billing/bills.service';
import { AuditService } from '../common/audit.service';
import { isoDate, todayLocal } from '../common/dates';
import { PrismaService } from '../common/prisma.service';
import { PropertiesService } from '../properties/properties.service';

const num = (v: { toNumber(): number } | number | null | undefined) => (v == null ? null : typeof v === 'number' ? v : v.toNumber());
const metaNum = (v: unknown) => (typeof v === 'number' ? v : null);
const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', GENERATED: 'Unpaid', PARTIALLY_PAID: 'Partially paid', PAID: 'Paid', OVERDUE: 'Overdue', CANCELLED: 'Cancelled' };
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CARD: 'Card', OTHER: 'Other' };

type Col = { header: string; key: string; width: number; fmt?: 'money' | 'date' | 'int' | 'rate' | 'month' };
const FORMAT = { money: '#,##0.00;[Red]-#,##0.00', date: 'dd-mmm-yyyy', int: '#,##0', rate: '#,##0.00', month: 'mmm yyyy' };

/** One real, filterable table per sheet: header row frozen, filters on, money and dates formatted as such (not text). */
function addTable(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Record<string, unknown>[], totals?: string[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.fmt ? { numFmt: FORMAT[c.fmt] } : {} }));
  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  rows.forEach((r) => ws.addRow(r));
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: cols.length } };
  if (totals?.length && rows.length) {
    const t = ws.addRow({ [cols[0].key]: 'Total' });
    t.font = { bold: true };
    for (const key of totals) {
      const idx = cols.findIndex((c) => c.key === key) + 1;
      const letter = ws.getColumn(idx).letter;
      // The cached result lets previewers that do not recalculate (phone viewers, email previews) show the figure too.
      const result = Math.round(rows.reduce((n, r) => n + (typeof r[key] === 'number' ? (r[key] as number) : 0), 0) * 100) / 100;
      t.getCell(idx).value = { formula: `SUBTOTAL(109,${letter}2:${letter}${rows.length + 1})`, result };
    }
    t.eachCell((cell) => { cell.border = { top: { style: 'thin' } }; });
  }
  return ws;
}

@Injectable()
export class ExcelExportService {
  constructor(private readonly prisma: PrismaService, private readonly properties: PropertiesService, private readonly audit: AuditService) {}

  /** Exports the current month only. */
  async build(userId: string, propertyId?: string): Promise<{ buffer: Buffer; fileName: string }> {
    const ids = propertyId ? [(await this.properties.assertOwned(userId, propertyId)).id] : await this.properties.ownedIds(userId);
    const inProp = { propertyId: { in: ids } };
    const today = todayLocal();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));

    const [properties, rooms, tenants, assignments, bills, payments] = await Promise.all([
      this.prisma.property.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.room.findMany({
        relationLoadStrategy: 'join', where: inProp, orderBy: [{ propertyId: 'asc' }, { roomNumber: 'asc' }],
        include: { property: { select: { name: true } }, assignments: { where: { status: 'ACTIVE' }, take: 1, select: { agreedRent: true, tenant: { select: { fullName: true } } } } },
      }),
      this.prisma.tenant.findMany({
        relationLoadStrategy: 'join', where: { ...inProp, deletedAt: null }, orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
        include: { property: { select: { name: true } }, assignments: { orderBy: { startDate: 'desc' }, select: { status: true, startDate: true, endDate: true, agreedRent: true, securityDeposit: true, room: { select: { roomNumber: true } } } } },
      }),
      this.prisma.roomAssignment.findMany({
        relationLoadStrategy: 'join', where: { room: inProp }, orderBy: [{ startDate: 'asc' }],
        include: { tenant: { select: { fullName: true } }, room: { select: { roomNumber: true, property: { select: { name: true } } } } },
      }),
      this.prisma.bill.findMany({
        relationLoadStrategy: 'join', where: inProp, orderBy: [{ billingPeriod: 'asc' }, { billNumber: 'asc' }],
        include: { tenant: { select: { fullName: true, status: true, phone: true } }, room: { select: { roomNumber: true } }, property: { select: { name: true } }, items: { orderBy: { sortOrder: 'asc' }, select: { type: true, description: true, amount: true, meta: true } } },
      }),
      this.prisma.payment.findMany({
        relationLoadStrategy: 'join', where: { bill: inProp }, orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
        include: { tenant: { select: { fullName: true } }, bill: { select: { billNumber: true, billingPeriod: true, room: { select: { roomNumber: true } }, property: { select: { name: true } } } } },
      }),
    ]);

    const monthBills = bills.filter((b) => b.billingPeriod >= monthStart && b.billingPeriod < nextMonth);
    const monthPayments = payments.filter((p) => p.paymentDate >= monthStart && p.paymentDate < nextMonth);
    const open = monthBills.filter((b) => b.status !== 'CANCELLED' && b.status !== 'DRAFT' && b.carriedForwardToId == null && b.totalDue.toNumber() > b.paidAmount.toNumber());
    const balance = new Map<string, number>();
    for (const b of open) balance.set(b.tenantId, Math.round(((balance.get(b.tenantId) ?? 0) + b.totalDue.toNumber() - b.paidAmount.toNumber()) * 100) / 100);

    const live = monthBills.filter((b) => b.status !== 'CANCELLED' && b.status !== 'DRAFT');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Rent Manager';
    wb.created = new Date();

    // ---- Summary
    const sum = (list: { toNumber(): number }[]) => Math.round(list.reduce((s, v) => s + v.toNumber(), 0) * 100) / 100;
    const owedFormer = [...balance.entries()].filter(([id]) => tenants.find((t) => t.id === id)?.status !== 'ACTIVE').reduce((s, [, v]) => s + v, 0);
    const owedAll = [...balance.values()].reduce((s, v) => s + v, 0);
    const tenantDeposit = new Map<string, number>();
    for (const a of assignments) tenantDeposit.set(a.tenantId, num(a.securityDeposit) ?? 0);
    const summary = wb.addWorksheet('Summary');
    summary.columns = [{ width: 38 }, { width: 22 }];
    const put = (label: string, value: string | number | Date | null, fmt?: string, bold = false) => {
      const r = summary.addRow([label, value]);
      if (fmt) r.getCell(2).numFmt = fmt;
      r.getCell(2).alignment = { horizontal: 'right' };
      if (bold) r.font = { bold: true };
    };
    const title = summary.addRow(['Rent Manager: data export']);
    title.font = { bold: true, size: 15, color: { argb: 'FF0F766E' } };
    summary.addRow([]);
    put('Exported on', new Date(), 'dd-mmm-yyyy hh:mm');
    put('Properties', properties.map((p) => p.name).join(', '));
    summary.addRow([]);
    put('Rooms', rooms.length, FORMAT.int);
    put('Tenants (current)', tenants.filter((t) => t.status === 'ACTIVE').length, FORMAT.int);
    put('Tenants (moved out)', tenants.filter((t) => t.status !== 'ACTIVE').length, FORMAT.int);
    put('Bills', live.length, FORMAT.int);
    put('Payments', monthPayments.length, FORMAT.int);
    summary.addRow([]);
    put('Total billed this month', sum(live.map((b) => ({ toNumber: () => b.totalDue.toNumber() - b.previousBalance.toNumber() }))), FORMAT.money);
    put('Balances brought in from before this app', sum(assignments.map((a) => a.openingBalance)), FORMAT.money);
    put('Total collected this month', sum(monthPayments.map((p) => p.amount)), FORMAT.money);
    put('Outstanding now', Math.round(owedAll * 100) / 100, FORMAT.money, true);
    put('  of which tenants who moved out', Math.round(owedFormer * 100) / 100, FORMAT.money);
    summary.addRow([]);
    summary.addRow(['Sheets: Rooms, Tenants, Stays, Bills, Tenant Ledger, Bill items, Payments, Electricity, Outstanding, Monthly.']).font = { italic: true, color: { argb: 'FF64748B' } };

    // ---- Tenant Ledger
    addTable(wb, 'Tenant Ledger', [
      { header: 'Resident', key: 'resident', width: 26 }, { header: 'Mobile', key: 'mobile', width: 16 }, { header: 'Apartment', key: 'apartment', width: 12 }, { header: 'Property', key: 'property', width: 22 },
      { header: 'Month', key: 'month', width: 12, fmt: 'month' }, { header: 'Rent', key: 'rent', width: 12, fmt: 'money' }, { header: 'Personal E', key: 'personalE', width: 12, fmt: 'money' },
      { header: 'Society Ele', key: 'societyEle', width: 12, fmt: 'money' }, { header: 'Society M', key: 'societyM', width: 12, fmt: 'money' }, { header: 'Previous B', key: 'previousB', width: 12, fmt: 'money' },
      { header: 'Deposit B', key: 'depositB', width: 12, fmt: 'money' }, { header: 'Total Bill', key: 'totalBill', width: 14, fmt: 'money' }, { header: 'Paid', key: 'paid', width: 12, fmt: 'money' },
      { header: 'Amount Due', key: 'amountDue', width: 14, fmt: 'money' }, { header: 'Status', key: 'status', width: 14 },
    ], monthBills.map((b) => {
      const societyEle = b.items.filter((i) => i.type === 'CHARGE' && /society.*(elec|electric)/i.test(i.description)).reduce((s, i) => s + (num(i.amount) ?? 0), 0);
      const societyM = b.items.filter((i) => i.type === 'CHARGE' && /(society.*maint|maintenance|society.*m)/i.test(i.description) && !/elec|electric/i.test(i.description)).reduce((s, i) => s + (num(i.amount) ?? 0), 0);
      const amountDue = Math.round((num(b.totalDue)! - num(b.paidAmount)!) * 100) / 100;
      const status = STATUS_LABEL[effectiveStatus({ status: b.status, dueDate: b.dueDate }, today)] ?? b.status;
      return {
        resident: b.tenant.fullName,
        mobile: b.tenant.phone ?? '',
        apartment: b.room.roomNumber,
        property: b.property.name,
        month: b.billingPeriod,
        rent: num(b.rentAmount),
        personalE: num(b.electricityAmount),
        societyEle,
        societyM,
        previousB: num(b.previousBalance),
        depositB: tenantDeposit.get(b.tenantId) ?? 0,
        totalBill: num(b.totalDue),
        paid: num(b.paidAmount),
        amountDue,
        status,
      };
    }));

    // ---- Rooms
    addTable(wb, 'Rooms', [
      { header: 'Property', key: 'property', width: 22 }, { header: 'Room', key: 'room', width: 10 }, { header: 'Floor', key: 'floor', width: 10 }, { header: 'Status', key: 'status', width: 14 },
      { header: 'Tenant now', key: 'tenant', width: 24 }, { header: 'Monthly rent', key: 'rent', width: 14, fmt: 'money' }, { header: 'Electricity', key: 'mode', width: 12 },
      { header: 'Rate per unit', key: 'rate', width: 14, fmt: 'rate' }, { header: 'Fixed electricity', key: 'fixed', width: 16, fmt: 'money' }, { header: 'Notes', key: 'notes', width: 30 },
    ], rooms.map((r) => ({
      property: r.property.name, room: r.roomNumber, floor: r.floor, status: r.status[0] + r.status.slice(1).toLowerCase(), tenant: r.assignments[0]?.tenant.fullName ?? '',
      rent: num(r.assignments[0]?.agreedRent ?? r.defaultRent), mode: r.electricityMode[0] + r.electricityMode.slice(1).toLowerCase(), rate: num(r.ratePerUnit), fixed: num(r.fixedElectricity), notes: r.notes,
    })));

    // ---- Tenants
    addTable(wb, 'Tenants', [
      { header: 'Name', key: 'name', width: 26 }, { header: 'Property', key: 'property', width: 20 }, { header: 'Status', key: 'status', width: 12 }, { header: 'Room', key: 'room', width: 10 },
      { header: 'Phone', key: 'phone', width: 16 }, { header: 'Email', key: 'email', width: 24 }, { header: 'Joined', key: 'joined', width: 13, fmt: 'date' }, { header: 'Left', key: 'left', width: 13, fmt: 'date' },
      { header: 'Monthly rent', key: 'rent', width: 13, fmt: 'money' }, { header: 'Deposit', key: 'deposit', width: 12, fmt: 'money' }, { header: 'Outstanding', key: 'owes', width: 14, fmt: 'money' },
      { header: 'Emergency contact', key: 'emerg', width: 24 }, { header: 'Address', key: 'address', width: 34 }, { header: 'Notes', key: 'notes', width: 34 },
    ], tenants.map((t) => {
      const a = t.assignments.find((x) => x.status === 'ACTIVE') ?? t.assignments[0];
      return {
        name: t.fullName, property: t.property.name, status: t.status === 'ACTIVE' ? 'Current' : 'Moved out', room: a?.room.roomNumber ?? '', phone: t.phone, email: t.email, joined: t.joiningDate,
        left: t.status === 'ACTIVE' ? null : a?.endDate ?? null, rent: num(a?.agreedRent), deposit: num(a?.securityDeposit), owes: balance.get(t.id) ?? 0,
        emerg: [t.emergencyContact, t.emergencyPhone].filter(Boolean).join(' '), address: t.currentAddress ?? t.permanentAddress, notes: t.notes,
      };
    }), ['owes']);

    // ---- Stays
    addTable(wb, 'Stays', [
      { header: 'Tenant', key: 'tenant', width: 26 }, { header: 'Property', key: 'property', width: 20 }, { header: 'Room', key: 'room', width: 10 }, { header: 'From', key: 'from', width: 13, fmt: 'date' },
      { header: 'To', key: 'to', width: 13, fmt: 'date' }, { header: 'Status', key: 'status', width: 10 }, { header: 'Rent', key: 'rent', width: 12, fmt: 'money' }, { header: 'Deposit', key: 'deposit', width: 12, fmt: 'money' },
      { header: 'Electricity', key: 'mode', width: 12 }, { header: 'Rate per unit', key: 'rate', width: 13, fmt: 'rate' }, { header: 'Opening balance', key: 'opening', width: 15, fmt: 'money' }, { header: 'Notes', key: 'notes', width: 36 },
    ], assignments.map((a) => ({
      tenant: a.tenant.fullName, property: a.room.property.name, room: a.room.roomNumber, from: a.startDate, to: a.endDate, status: a.status === 'ACTIVE' ? 'Current' : 'Closed', rent: num(a.agreedRent),
      deposit: num(a.securityDeposit), mode: a.electricityMode[0] + a.electricityMode.slice(1).toLowerCase(), rate: num(a.ratePerUnit), opening: num(a.openingBalance), notes: [a.notes, a.moveOutNotes].filter(Boolean).join(' | '),
    })));

    // ---- Bills
    addTable(wb, 'Bills', [
      { header: 'Month', key: 'month', width: 11, fmt: 'month' }, { header: 'Bill no', key: 'no', width: 18 }, { header: 'Property', key: 'property', width: 20 }, { header: 'Tenant', key: 'tenant', width: 26 },
      { header: 'Room', key: 'room', width: 9 }, { header: 'Rent', key: 'rent', width: 12, fmt: 'money' }, { header: 'Electricity', key: 'elec', width: 12, fmt: 'money' }, { header: 'Other charges', key: 'other', width: 13, fmt: 'money' },
      { header: 'Late fee', key: 'late', width: 10, fmt: 'money' }, { header: 'Discount', key: 'disc', width: 11, fmt: 'money' }, { header: 'Previous balance', key: 'prev', width: 15, fmt: 'money' },
      { header: 'Total', key: 'total', width: 13, fmt: 'money' }, { header: 'Paid', key: 'paid', width: 12, fmt: 'money' }, { header: 'Balance', key: 'bal', width: 13, fmt: 'money' },
      { header: 'Status', key: 'status', width: 14 }, { header: 'Due date', key: 'due', width: 13, fmt: 'date' }, { header: 'Balance carried to next bill', key: 'carried', width: 18 },
    ], monthBills.map((b) => {
      const total = b.totalDue.toNumber();
      const paid = b.paidAmount.toNumber();
      return {
        month: b.billingPeriod, no: b.billNumber, property: b.property.name, tenant: b.tenant.fullName, room: b.room.roomNumber, rent: num(b.rentAmount), elec: num(b.electricityAmount), other: num(b.otherChargesAmount),
        late: num(b.lateFee), disc: num(b.discount), prev: num(b.previousBalance), total, paid, bal: b.carriedForwardToId ? 0 : Math.round((total - paid) * 100) / 100,
        status: STATUS_LABEL[effectiveStatus({ status: b.status, dueDate: b.dueDate }, today)] ?? b.status, due: b.dueDate, carried: b.carriedForwardToId ? 'Yes' : '',
      };
    }), ['rent', 'elec', 'other', 'late', 'disc']);

    // ---- Bill items
    addTable(wb, 'Bill items', [
      { header: 'Month', key: 'month', width: 11, fmt: 'month' }, { header: 'Bill no', key: 'no', width: 18 }, { header: 'Tenant', key: 'tenant', width: 26 }, { header: 'Room', key: 'room', width: 9 },
      { header: 'Type', key: 'type', width: 16 }, { header: 'Description', key: 'desc', width: 34 }, { header: 'Amount', key: 'amount', width: 13, fmt: 'money' },
    ], monthBills.flatMap((b) => b.items.map((i) => ({ month: b.billingPeriod, no: b.billNumber, tenant: b.tenant.fullName, room: b.room.roomNumber, type: i.type.replace('_', ' ').toLowerCase(), desc: i.description, amount: num(i.amount) }))));

    // ---- Payments
    addTable(wb, 'Payments', [
      { header: 'Date', key: 'date', width: 13, fmt: 'date' }, { header: 'Tenant', key: 'tenant', width: 26 }, { header: 'Room', key: 'room', width: 9 }, { header: 'For month', key: 'month', width: 11, fmt: 'month' },
      { header: 'Bill no', key: 'no', width: 18 }, { header: 'Amount', key: 'amount', width: 13, fmt: 'money' }, { header: 'Method', key: 'method', width: 14 }, { header: 'Reference', key: 'ref', width: 20 },
      { header: 'Notes', key: 'notes', width: 40 }, { header: 'Property', key: 'property', width: 20 },
    ], monthPayments.map((p) => ({
      date: p.paymentDate, tenant: p.tenant.fullName, room: p.bill.room.roomNumber, month: p.bill.billingPeriod, no: p.bill.billNumber, amount: num(p.amount), method: METHOD_LABEL[p.method] ?? p.method,
      ref: p.reference, notes: p.notes, property: p.bill.property.name,
    })), ['amount']);

    // ---- Electricity (readings where a meter was read)
    addTable(wb, 'Electricity', [
      { header: 'Month', key: 'month', width: 11, fmt: 'month' }, { header: 'Tenant', key: 'tenant', width: 26 }, { header: 'Room', key: 'room', width: 9 }, { header: 'Previous reading', key: 'prev', width: 16, fmt: 'rate' },
      { header: 'Current reading', key: 'cur', width: 15, fmt: 'rate' }, { header: 'Units', key: 'units', width: 10, fmt: 'rate' }, { header: 'Rate per unit', key: 'rate', width: 13, fmt: 'rate' },
      { header: 'Amount', key: 'amount', width: 13, fmt: 'money' }, { header: 'Bill no', key: 'no', width: 18 },
    ], monthBills.filter((b) => b.status !== 'CANCELLED' && (b.electricityAmount.toNumber() > 0 || b.items.some((i) => i.type === 'ELECTRICITY'))).map((b) => {
      const meta = (b.items.find((i) => i.type === 'ELECTRICITY')?.meta ?? {}) as Record<string, unknown>;
      const metered = metaNum(meta.currentReading) != null;
      return { month: b.billingPeriod, tenant: b.tenant.fullName, room: b.room.roomNumber, prev: metered ? metaNum(meta.previousReading) : null, cur: metered ? metaNum(meta.currentReading) : null, units: metered ? metaNum(meta.units) : null, rate: metered ? metaNum(meta.ratePerUnit) : null, amount: num(b.electricityAmount), no: b.billNumber };
    }), ['amount']);

    // ---- Outstanding
    const byTenant = new Map<string, { name: string; room: string; current: boolean; amount: number; bills: number; oldest: Date }>();
    for (const b of open) {
      const cur = byTenant.get(b.tenantId);
      const amount = Math.round(((cur?.amount ?? 0) + b.totalDue.toNumber() - b.paidAmount.toNumber()) * 100) / 100;
      byTenant.set(b.tenantId, { name: b.tenant.fullName, room: b.room.roomNumber, current: b.tenant.status === 'ACTIVE', amount, bills: (cur?.bills ?? 0) + 1, oldest: cur && cur.oldest < b.dueDate ? cur.oldest : b.dueDate });
    }
    addTable(wb, 'Outstanding', [
      { header: 'Tenant', key: 'name', width: 26 }, { header: 'Room', key: 'room', width: 10 }, { header: 'Status', key: 'status', width: 14 }, { header: 'Amount due', key: 'amount', width: 14, fmt: 'money' },
      { header: 'Open bills', key: 'bills', width: 11, fmt: 'int' }, { header: 'Oldest due date', key: 'oldest', width: 16, fmt: 'date' }, { header: 'Days overdue', key: 'days', width: 13, fmt: 'int' },
    ], [...byTenant.values()].sort((a, b) => b.amount - a.amount).map((v) => ({
      name: v.name, room: v.room, status: v.current ? 'Current tenant' : 'Moved out', amount: v.amount, bills: v.bills, oldest: v.oldest, days: Math.max(0, Math.floor((today.getTime() - v.oldest.getTime()) / 86_400_000)),
    })), ['amount']);

    // ---- Monthly
    const months = new Map<string, { billed: number; rent: number; elec: number; other: number; bills: number; collected: number; payments: number }>();
    const slot = (d: Date) => {
      const k = d.toISOString().slice(0, 7);
      if (!months.has(k)) months.set(k, { billed: 0, rent: 0, elec: 0, other: 0, bills: 0, collected: 0, payments: 0 });
      return months.get(k)!;
    };
    for (const b of live) {
      const m = slot(b.billingPeriod);
      m.bills++;
      m.rent += b.rentAmount.toNumber();
      m.elec += b.electricityAmount.toNumber();
      m.other += b.otherChargesAmount.toNumber() + b.lateFee.toNumber() - b.discount.toNumber();
      m.billed += b.totalDue.toNumber() - b.previousBalance.toNumber();
    }
    for (const p of monthPayments) {
      const m = slot(p.paymentDate);
      m.collected += p.amount.toNumber();
      m.payments++;
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    addTable(wb, 'Monthly', [
      { header: 'Month', key: 'month', width: 12, fmt: 'month' }, { header: 'Bills', key: 'bills', width: 8, fmt: 'int' }, { header: 'Rent', key: 'rent', width: 13, fmt: 'money' }, { header: 'Electricity', key: 'elec', width: 13, fmt: 'money' },
      { header: 'Other (net of discounts)', key: 'other', width: 20, fmt: 'money' }, { header: 'Billed this month', key: 'billed', width: 17, fmt: 'money' }, { header: 'Payments', key: 'payments', width: 10, fmt: 'int' },
      { header: 'Collected in month', key: 'collected', width: 18, fmt: 'money' },
    ], [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, m]) => ({
      month: new Date(`${k}-01T00:00:00.000Z`), bills: m.bills, rent: r2(m.rent), elec: r2(m.elec), other: r2(m.other), billed: r2(m.billed), payments: m.payments, collected: r2(m.collected),
    })), ['rent', 'elec', 'other', 'billed', 'collected']);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await this.audit.log(userId, 'export.excel', 'property', propertyId, { bills: monthBills.length, payments: monthPayments.length });
    const stamp = isoDate(today);
    return { buffer, fileName: `RentManager-export-${stamp}.xlsx` };
  }
}
