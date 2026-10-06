import PDFDocument from 'pdfkit';
import * as path from 'path';
import { formatDate, formatDateLocal } from '../common/format';
import { billPeriodLabel, depositLine, paymentDateLine, type PdfBill } from './bill-pdf';

const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');
const COLORS = { head: '#D9D9D9', label: '#FFFF99', total: '#C6EFCE', white: '#FFFFFF', line: '#000000', note: '#64748B' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Aug-26", the month format used in the owner's spreadsheet. */
export const shortMonth = (d: Date) => `${MON[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;

/** Plain number like the spreadsheet shows it: 8280, 1080.5 (no currency symbol, no digit grouping). */
export const plain = (n: number) => String(Math.round(n * 100) / 100);

interface Row {
  label: string;
  value: string;
  kind?: 'head' | 'normal' | 'total' | 'plain';
}

/** Maps stored bill items onto the fixed rows of the owner's monthly rent form. */
export function statementRows(bill: PdfBill): Row[] {
  const sum = (pred: (i: PdfBill['items'][number]) => boolean) => bill.items.filter(pred).reduce((s, i) => s + i.amount, 0);
  const isSociety = (re: RegExp) => (i: PdfBill['items'][number]) => i.type === 'CHARGE' && re.test(i.description);
  const societyElectricity = isSociety(/society\s*electric/i);
  const societyMaintenance = isSociety(/society\s*maint/i);

  const rows: Row[] = [
    { label: 'Tenant Name', value: bill.tenant.fullName, kind: 'head' },
    { label: 'Room No', value: bill.room.roomNumber },
    { label: 'Month', value: shortMonth(bill.billingPeriod) },
    { label: 'Monthly Rental', value: plain(sum((i) => i.type === 'RENT')) },
    { label: 'Personal Electricity', value: plain(sum((i) => i.type === 'ELECTRICITY')) },
    { label: 'Society Electricity', value: plain(sum(societyElectricity)) },
    { label: 'Society Maintenance', value: plain(sum(societyMaintenance)) },
  ];
  // Anything else on the bill still appears, so the rows always add up to the total.
  for (const i of bill.items) {
    if (i.type === 'CHARGE' && !societyElectricity(i) && !societyMaintenance(i)) rows.push({ label: i.description, value: plain(i.amount) });
    if (i.type === 'LATE_FEE') rows.push({ label: 'Late Fee', value: plain(i.amount) });
    if (i.type === 'DISCOUNT') rows.push({ label: 'Discount', value: plain(i.amount) });
  }
  rows.push({ label: 'Outstanding :', value: plain(sum((i) => i.type === 'PREVIOUS_BALANCE')) });
  rows.push({ label: 'Monthly Payment :', value: plain(bill.totalDue), kind: 'total' });
  if (bill.paidAmount > 0) {
    rows.push({ label: 'Paid :', value: plain(bill.paidAmount), kind: 'plain' });
    rows.push({ label: 'Balance :', value: plain(bill.balance), kind: 'plain' });
  }
  return rows;
}

/** One compact page that looks like the owner's monthly rent form, ready to share on WhatsApp. */
export function renderBillStatementPdf(bill: PdfBill): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const rows = statementRows(bill);
    const rowH = 36;
    const totalRowH = 46;
    const margin = 20;
    const width = 340;
    const tableH = rows.reduce((h, r) => h + (r.kind === 'total' ? totalRowH : rowH), 0);
    const pageW = width + margin * 2;
    // Bill period · Issued · Due, then when it was paid and the deposit held (informational), then the property line.
    const notes = [
      `Bill period ${billPeriodLabel(bill.billingPeriod)}`,
      `Issued ${formatDateLocal(bill.createdAt)}  ·  Due ${formatDate(bill.dueDate)}${bill.overdue ? ' (overdue)' : ''}`,
      paymentDateLine(bill),
      depositLine(bill),
      `${bill.property.name}  ·  ${bill.billNumber}${bill.property.contactPhone ? `  ·  ${bill.property.contactPhone}` : ''}`,
      bill.property.billFooterNote ?? '',
    ].filter(Boolean);
    const pageH = tableH + margin * 2 + 4 + notes.length * 13;

    const doc = new PDFDocument({
      size: [pageW, pageH],
      margin: 0,
      info: { Title: `Rent ${bill.tenant.fullName} ${shortMonth(bill.billingPeriod)}`, Author: bill.property.name, Subject: `Monthly rent ${bill.billNumber}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('R', path.join(FONT_DIR, 'Inter_400Regular.ttf'));
    doc.registerFont('B', path.join(FONT_DIR, 'Inter_700Bold.ttf'));

    const col1 = width * 0.5;
    let y = margin;
    for (const row of rows) {
      const h = row.kind === 'total' ? totalRowH : rowH;
      const head = row.kind === 'head';
      const total = row.kind === 'total';
      const plainRow = row.kind === 'plain';
      // label cell
      doc.rect(margin, y, col1, h).fillAndStroke(head ? COLORS.head : total ? COLORS.total : plainRow ? COLORS.white : COLORS.label, COLORS.line);
      // value cell
      doc.rect(margin + col1, y, width - col1, h).fillAndStroke(head ? COLORS.head : total ? COLORS.total : COLORS.white, COLORS.line);
      doc.fillColor('#000000').font('B').fontSize(11.5).text(row.label, margin + 8, y + (h - 12) / 2, { width: col1 - 12, lineBreak: false });
      doc.font(head ? 'B' : total ? 'B' : 'R').fontSize(total ? 18 : 11.5).text(row.value, margin + col1 + 4, y + (h - (total ? 18 : 12)) / 2 - (total ? 1 : 0), {
        width: width - col1 - 8,
        align: 'center',
        lineBreak: false,
        ellipsis: true,
      });
      y += h;
    }

    doc.font('R').fontSize(8.5).fillColor(COLORS.note);
    notes.forEach((n, i) => doc.text(n, margin, y + 12 + i * 13, { width, align: 'center', lineBreak: false, ellipsis: true }));
    doc.end();
  });
}
