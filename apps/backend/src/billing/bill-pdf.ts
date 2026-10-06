import PDFDocument from 'pdfkit';
import * as path from 'path';
import { monthBounds } from '../common/dates';
import { formatDate, formatDateLocal, formatINR } from '../common/format';
import { monthLabel } from './bills.service';

const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');
const C = { primary: '#0F766E', ink: '#0F172A', soft: '#475569', muted: '#94A3B8', line: '#E4E8EE', band: '#F1F3F6', success: '#15803D', danger: '#B91C1C', warning: '#B45309' };

export interface PdfBill {
  billNumber: string;
  billingPeriod: Date;
  dueDate: Date;
  createdAt: Date;
  /** Payment state shown on the chip: GENERATED (unpaid), PARTIALLY_PAID, PAID or CANCELLED. */
  status: string;
  overdue?: boolean;
  rentAmount: number;
  electricityAmount: number;
  otherChargesAmount: number;
  lateFee: number;
  discount: number;
  previousBalance: number;
  totalDue: number;
  paidAmount: number;
  balance: number;
  items: { type: string; description: string; amount: number; meta?: any }[];
  payments: { paymentDate: Date; method: string; reference: string | null; amount: number }[];
  tenant: { fullName: string; phone: string };
  room: { roomNumber: string };
  property: { name: string; address: string; city: string; state: string; pincode: string; billFooterNote?: string | null; upiId?: string | null; contactPhone?: string | null };
  /** Received date of the payment that settled the bill (YYYY-MM-DD). */
  paidInFullOn?: string | null;
  /** Latest payment while the bill is part paid. */
  lastPayment?: { amount: number; paymentDate: string } | null;
  /** Informational only, never part of the total. */
  securityDeposit?: { totalReceived: number; lastReceivedOn: string | null } | null;
}

/** "01 Aug 2026 – 31 Aug 2026": the first to the last day of the billing month. */
export const billPeriodLabel = (billingPeriod: Date) => {
  const { start, end } = monthBounds(billingPeriod);
  return `${formatDate(start)} – ${formatDate(end)}`;
};

/** "Paid in full on 12 Oct 2026" or "Last payment ₹3,000 on 12 Oct 2026"; empty when nothing was paid. */
export function paymentDateLine(bill: Pick<PdfBill, 'paidInFullOn' | 'lastPayment' | 'status'>) {
  if (bill.status === 'CANCELLED') return '';
  if (bill.paidInFullOn) return `Paid in full on ${formatDate(bill.paidInFullOn)}`;
  if (bill.lastPayment) return `Last payment ${formatINR(bill.lastPayment.amount)} on ${formatDate(bill.lastPayment.paymentDate)}`;
  return '';
}

/** "Security deposit received: ₹15,000 (last received 20 Jan 2026)"; empty when nothing was received. */
export function depositLine(bill: Pick<PdfBill, 'securityDeposit'>) {
  const d = bill.securityDeposit;
  if (!d || d.totalReceived <= 0) return '';
  return `Security deposit received: ${formatINR(d.totalReceived)}${d.lastReceivedOn ? ` (last received ${formatDate(d.lastReceivedOn)})` : ''}`;
}

const STATUS: Record<string, { label: string; color: string }> = {
  PAID: { label: 'PAID', color: C.success },
  PARTIALLY_PAID: { label: 'PARTIALLY PAID', color: C.warning },
  GENERATED: { label: 'UNPAID', color: C.warning },
  OVERDUE: { label: 'OVERDUE', color: C.danger },
  CANCELLED: { label: 'CANCELLED', color: C.muted },
  DRAFT: { label: 'DRAFT', color: C.muted },
};
const METHOD: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CARD: 'Card', OTHER: 'Other' };

const itemLabel = (i: PdfBill['items'][number]) =>
  i.type === 'ELECTRICITY' && i.meta?.currentReading != null
    ? `Electricity (${i.meta.previousReading} to ${i.meta.currentReading}: ${i.meta.units} units x ${formatINR(i.meta.ratePerUnit)})`
    : i.type === 'CHARGE' && typeof i.meta?.note === 'string' && i.meta.note
      ? `${i.description} (${i.meta.note})`
      : i.description;

/** Renders a clean A4 rent invoice/receipt and resolves with the PDF bytes. */
export function renderBillPdf(bill: PdfBill): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 44,
      info: { Title: `Invoice ${bill.billNumber}`, Author: bill.property.name, Subject: `Rent for ${monthLabel(bill.billingPeriod)}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('R', path.join(FONT_DIR, 'Inter_400Regular.ttf'));
    doc.registerFont('S', path.join(FONT_DIR, 'Inter_600SemiBold.ttf'));
    doc.registerFont('B', path.join(FONT_DIR, 'Inter_700Bold.ttf'));

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const status = STATUS[bill.status] ?? STATUS.GENERATED;

    // ---- Header ----
    doc.font('B').fontSize(19).fillColor(C.primary).text(bill.property.name, left, 44, { width: width * 0.6 });
    doc.font('R').fontSize(9).fillColor(C.soft).text(`${bill.property.address}\n${bill.property.city}, ${bill.property.state} - ${bill.property.pincode}${bill.property.contactPhone ? `\nPhone: ${bill.property.contactPhone}` : ''}`, left, doc.y + 2, { width: width * 0.6 });

    doc.font('B').fontSize(22).fillColor(C.ink).text('INVOICE', left, 44, { width, align: 'right' });
    doc.font('R').fontSize(10).fillColor(C.soft).text(bill.billNumber, left, 72, { width, align: 'right' });
    const chipW = doc.font('B').fontSize(8).widthOfString(status.label) + 20;
    doc.roundedRect(right - chipW, 90, chipW, 20, 10).fill(status.color);
    doc.fillColor('#FFFFFF').font('B').fontSize(8).text(status.label, right - chipW, 96, { width: chipW, align: 'center' });

    let y = Math.max(doc.y, 118) + 18;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(C.line).stroke();
    y += 18;

    // ---- Parties and dates ----
    doc.font('S').fontSize(8).fillColor(C.muted).text('BILLED TO', left, y);
    doc.font('B').fontSize(12).fillColor(C.ink).text(bill.tenant.fullName, left, y + 14, { width: width * 0.5 });
    doc.font('R').fontSize(10).fillColor(C.soft).text(`Room ${bill.room.roomNumber}`, left, doc.y + 2).text(`Phone: ${bill.tenant.phone}`, left, doc.y + 1);
    const blockBottom = doc.y;

    const labelX = left + width * 0.48;
    const rows: [string, string, string?][] = [
      ['Bill period', billPeriodLabel(bill.billingPeriod)],
      ['Invoice date', formatDateLocal(bill.createdAt)],
      ['Due date', bill.overdue ? `${formatDate(bill.dueDate)} (overdue)` : formatDate(bill.dueDate), bill.overdue ? C.danger : undefined],
    ];
    rows.forEach(([k, v, color], i) => {
      const ry = y + i * 20;
      doc.font('R').fontSize(9).fillColor(C.soft).text(k, labelX, ry, { width: width * 0.16 });
      doc.font('S').fontSize(10).fillColor(color ?? C.ink).text(v, labelX + width * 0.16, ry - 1, { width: width * 0.36, align: 'right' });
    });
    y = Math.max(blockBottom, y + 62) + 22;

    // ---- Charges table ----
    const drawTableHeader = (ty: number) => {
      doc.rect(left, ty, width, 26).fill(C.band);
      doc.font('S').fontSize(8).fillColor(C.soft).text('DESCRIPTION', left + 12, ty + 9).text('AMOUNT', left, ty + 9, { width: width - 12, align: 'right' });
      return ty + 26;
    };
    y = drawTableHeader(y);
    for (const item of bill.items) {
      const label = itemLabel(item);
      const h = Math.max(28, doc.font('R').fontSize(10).heightOfString(label, { width: width - 130 }) + 14);
      if (y + h > doc.page.height - 200) { doc.addPage(); y = drawTableHeader(doc.page.margins.top); }
      doc.font('R').fontSize(10).fillColor(C.ink).text(label, left + 12, y + 8, { width: width - 130 });
      const amount = item.amount < 0 ? `-${formatINR(-item.amount, { decimals: true })}` : formatINR(item.amount, { decimals: true });
      doc.font('S').fontSize(10).fillColor(item.amount < 0 ? C.success : item.type === 'PREVIOUS_BALANCE' ? C.danger : C.ink).text(amount, left, y + 8, { width: width - 12, align: 'right' });
      doc.moveTo(left, y + h).lineTo(right, y + h).lineWidth(0.5).strokeColor(C.line).stroke();
      y += h;
    }

    // ---- Totals ----
    if (y > doc.page.height - 230) { doc.addPage(); y = doc.page.margins.top; }
    y += 14;
    const tx = left + width * 0.5;
    const tw = right - tx;
    const subtotal = bill.totalDue - bill.previousBalance;
    const line = (label: string, value: string, o: { bold?: boolean; color?: string; size?: number } = {}) => {
      doc.font(o.bold ? 'B' : 'R').fontSize(o.size ?? 10).fillColor(o.bold ? C.ink : C.soft).text(label, tx, y, { width: tw * 0.55 });
      doc.font(o.bold ? 'B' : 'S').fontSize(o.size ?? 10).fillColor(o.color ?? C.ink).text(value, tx, y, { width: tw, align: 'right' });
      y += (o.size ?? 10) + 9;
    };
    line('Subtotal', formatINR(subtotal, { decimals: true }));
    if (bill.previousBalance > 0) line('Previous balance', formatINR(bill.previousBalance, { decimals: true }), { color: C.danger });
    doc.moveTo(tx, y - 2).lineTo(right, y - 2).lineWidth(1).strokeColor(C.line).stroke();
    y += 6;
    line('Total', formatINR(bill.totalDue, { decimals: true }), { bold: true, size: 13 });
    line('Paid', formatINR(bill.paidAmount, { decimals: true }), { color: C.success });
    doc.roundedRect(tx - 10, y - 6, tw + 10, 34, 8).fill(bill.balance > 0 ? '#FCEAEA' : '#E7F5EC');
    doc.font('B').fontSize(11).fillColor(C.ink).text('Balance due', tx, y + 5, { width: tw * 0.55 });
    doc.font('B').fontSize(15).fillColor(bill.balance > 0 ? C.danger : C.success).text(formatINR(bill.balance, { decimals: true }), tx, y + 3, { width: tw, align: 'right' });
    y += 40;
    // When the money came in, and the deposit held (informational: never part of the total).
    for (const [note, color, font] of [[paymentDateLine(bill), bill.paidInFullOn ? C.success : C.soft, 'S'], [depositLine(bill), C.soft, 'R']] as const) {
      if (!note) continue;
      doc.font(font).fontSize(9).fillColor(color).text(note, left, y, { width, align: 'right', lineBreak: false });
      y += 14;
    }
    y += 10;

    // ---- Payments received ----
    if (bill.payments.length) {
      if (y > doc.page.height - 190) { doc.addPage(); y = doc.page.margins.top; }
      doc.font('S').fontSize(8).fillColor(C.muted).text('PAYMENTS RECEIVED', left, y);
      y += 16;
      for (const p of bill.payments) {
        if (y > doc.page.height - 100) { doc.addPage(); y = doc.page.margins.top; }
        doc.font('R').fontSize(9.5).fillColor(C.soft).text(formatDate(p.paymentDate), left, y, { width: 90 });
        doc.text(`${METHOD[p.method] ?? p.method}${p.reference ? `  ·  ${p.reference}` : ''}`, left + 100, y, { width: width * 0.5 });
        doc.font('S').fillColor(C.success).text(formatINR(p.amount, { decimals: true }), left, y, { width, align: 'right' });
        y += 18;
      }
    }

    // ---- Footer ----
    // The footer sits inside the bottom margin; without this PDFKit would start a new page for it.
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 72;
    doc.moveTo(left, fy - 10).lineTo(right, fy - 10).lineWidth(0.5).strokeColor(C.line).stroke();
    if (bill.property.billFooterNote) doc.font('R').fontSize(9).fillColor(C.soft).text(bill.property.billFooterNote, left, fy, { width, align: 'center' });
    doc.font('R').fontSize(8).fillColor(C.muted).text('This is a computer generated invoice and does not require a signature.', left, fy + 22, { width, align: 'center', lineBreak: false });
    doc.end();
  });
}