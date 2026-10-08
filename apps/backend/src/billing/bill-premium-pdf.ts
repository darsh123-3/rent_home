import * as path from 'path';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { todayLocal } from '../common/dates';
import { formatDate, formatDateLocal, formatINR } from '../common/format';
import { billPeriodLabel, depositLine, paymentDateLine, type PdfBill } from './bill-pdf';
import { monthLabel } from './bills.service';

const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');
const PW = 595.28;
const PH = 841.89;
const M = 36;
const CW = PW - M * 2;

const C = {
  deep: '#0B5D57', primary: '#0F766E', bright: '#14907F', mint: '#CCFBF1', tint: '#F0FAF8',
  ink: '#0F172A', soft: '#475569', muted: '#8492A6', line: '#E4E8EE', zebra: '#F8FAFB', white: '#FFFFFF',
  success: '#15803D', successSoft: '#E8F6EC', danger: '#B91C1C', dangerSoft: '#FDEEEC', dangerLine: '#F3C4BE', warning: '#B45309', warningSoft: '#FEF3DC', warningLine: '#F1D79B',
};

const METHOD: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CARD: 'Card', OTHER: 'Other' };

type Tone = 'danger' | 'warning' | 'success' | 'muted';
const TONE = {
  danger: { fg: C.danger, bg: C.dangerSoft, line: C.dangerLine },
  warning: { fg: C.warning, bg: C.warningSoft, line: C.warningLine },
  success: { fg: C.success, bg: C.successSoft, line: '#BFE3CB' },
  muted: { fg: C.soft, bg: '#F1F3F6', line: C.line },
};

interface Line {
  label: string;
  detail: string;
  amount: number;
  tone?: 'danger' | 'success';
  /** Carried in from before (previous balance or its adjustment): listed after "This month's charges". */
  carried?: boolean;
}

/** The itemised lines of a bill with a short plain-language explanation next to each. Exported for tests. */
export function breakdownLines(bill: PdfBill): Line[] {
  const lines: Line[] = [];
  for (const i of bill.items) {
    const m = i.meta ?? {};
    if (i.type === 'RENT') lines.push({ label: 'Monthly rent', detail: `For ${monthLabel(bill.billingPeriod)}${typeof m.standardRent === 'number' ? '  ·  rent set for this bill' : ''}`, amount: i.amount });
    else if (i.type === 'ELECTRICITY') {
      const detail =
        m.currentReading != null
          ? `${monthLabel(bill.billingPeriod)} usage  ·  Meter ${m.previousReading} to ${m.currentReading}  ·  ${m.units} units × ${formatINR(m.ratePerUnit)}`
          : m.mode === 'FIXED'
            ? 'Fixed monthly amount'
            : m.isOverride
              ? 'Amount as recorded'
              : '';
      lines.push({ label: 'Electricity', detail, amount: i.amount });
    } else if (i.type === 'CHARGE') {
      const note = typeof m.note === 'string' ? m.note : '';
      lines.push({ label: i.description, detail: note || (/society/i.test(i.description) ? 'Shared by all tenants' : ''), amount: i.amount });
    }
    else if (i.type === 'LATE_FEE') lines.push({ label: 'Late fee', detail: 'For payment after the due date', amount: i.amount });
    else if (i.type === 'DISCOUNT') lines.push({ label: i.description || 'Discount', detail: '', amount: i.amount, tone: 'success' });
    else if (i.type === 'PREVIOUS_BALANCE' && m.adjustment) {
      lines.push({ label: 'Previous balance adjustment', detail: typeof m.note === 'string' ? m.note : '', amount: i.amount, tone: i.amount < 0 ? 'success' : 'danger', carried: true });
    } else if (i.type === 'PREVIOUS_BALANCE') {
      const bills: string[] = Array.isArray(m.bills) ? m.bills : [];
      lines.push({
        label: 'Previous balance',
        detail: m.openingBalance > 0 ? 'Brought forward from before' : bills.length ? `Unpaid from ${bills.slice(0, 3).join(', ')}${bills.length > 3 ? ` +${bills.length - 3}` : ''}` : 'Unpaid from earlier months',
        amount: i.amount,
        tone: 'danger',
        carried: true,
      });
    }
  }
  return lines;
}

const signed = (n: number) => (n < 0 ? `-${formatINR(-n)}` : formatINR(n));

/** The state shown on the hero card: what the reader should do. */
export function heroState(bill: PdfBill, today = todayLocal()) {
  const overdueDays = Math.max(0, Math.round((today.getTime() - bill.dueDate.getTime()) / 86_400_000));
  if (bill.status === 'CANCELLED') return { label: 'CANCELLED', amount: 'This bill was cancelled', sub: 'No payment is due.', tone: 'muted' as Tone };
  if (bill.balance <= 0) return { label: 'PAID IN FULL', amount: formatINR(0), sub: 'Thank you. Nothing is due.', tone: 'success' as Tone };
  if (bill.overdue || overdueDays > 0) return { label: 'BALANCE DUE', amount: formatINR(bill.balance), sub: `Overdue since ${formatDate(bill.dueDate)}${overdueDays ? ` (${overdueDays} ${overdueDays === 1 ? 'day' : 'days'})` : ''}`, tone: 'danger' as Tone };
  return { label: 'BALANCE DUE', amount: formatINR(bill.balance), sub: `Please pay by ${formatDate(bill.dueDate)}`, tone: bill.paidAmount > 0 ? ('warning' as Tone) : ('warning' as Tone) };
}

/** UPI deep link: any UPI app opens it with the payee and amount filled in. */
export const upiLink = (vpa: string, payee: string, amount: number, note: string) =>
  `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payee.slice(0, 40))}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note.slice(0, 60))}`;

/** A one-page A4 bill: clear amount due, an itemised breakdown that explains every line, payments received and an optional UPI QR. */
export async function renderBillPremiumPdf(bill: PdfBill): Promise<Buffer> {
  const state = heroState(bill);
  const qr = bill.property.upiId && bill.balance > 0 && bill.status !== 'CANCELLED'
    ? await QRCode.toBuffer(upiLink(bill.property.upiId, bill.property.name, bill.balance, `Rent ${bill.billNumber}`), { margin: 1, width: 420, errorCorrectionLevel: 'M' })
    : null;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 0,
      info: { Title: `Rent bill ${bill.billNumber}`, Author: bill.property.name, Subject: `Rent for ${monthLabel(bill.billingPeriod)} - ${bill.tenant.fullName}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('R', path.join(FONT_DIR, 'Inter_400Regular.ttf'));
    doc.registerFont('S', path.join(FONT_DIR, 'Inter_600SemiBold.ttf'));
    doc.registerFont('B', path.join(FONT_DIR, 'Inter_700Bold.ttf'));
    doc.page.margins.bottom = 0; // text near the foot of the page must never trigger an automatic second page

    const text = (s: string, x: number, y: number, o: { font?: 'R' | 'S' | 'B'; size?: number; color?: string; width?: number; align?: 'left' | 'right' | 'center'; spacing?: number } = {}) => {
      doc.font(o.font ?? 'R').fontSize(o.size ?? 10).fillColor(o.color ?? C.ink).text(s, x, y, { width: o.width ?? CW, align: o.align ?? 'left', lineBreak: false, ellipsis: true, characterSpacing: o.spacing ?? 0 });
    };
    const caps = (s: string, x: number, y: number, o: { color?: string; width?: number; align?: 'left' | 'right' | 'center' } = {}) => text(s, x, y, { font: 'B', size: 7.5, color: o.color ?? C.muted, spacing: 1.1, width: o.width, align: o.align });
    const width = (s: string, font: 'R' | 'S' | 'B', size: number) => doc.font(font).fontSize(size).widthOfString(s);
    const box = (x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) => {
      doc.roundedRect(x, y, w, h, r);
      if (stroke) doc.fillAndStroke(fill, stroke);
      else doc.fill(fill);
    };
    const pill = (label: string, x: number, y: number, tone: Tone, solid = false) => {
      const t = TONE[tone];
      const w = width(label, 'B', 8) + 18;
      box(x, y, w, 18, 9, solid ? t.fg : t.bg, solid ? undefined : t.line);
      text(label, x, y + 5.2, { font: 'B', size: 8, color: solid ? C.white : t.fg, width: w, align: 'center', spacing: 0.6 });
      return w;
    };

    // ---------- Header ----------
    const grad = doc.linearGradient(0, 0, PW, 120);
    grad.stop(0, C.deep).stop(1, C.bright);
    doc.rect(0, 0, PW, 118).fill(grad);
    doc.save();
    doc.opacity(0.09).circle(PW - 40, 8, 96).fill(C.white);
    doc.opacity(0.07).circle(PW - 150, 120, 60).fill(C.white);
    doc.opacity(0.06).circle(70, 118, 70).fill(C.white);
    doc.restore();
    caps('RENT BILL', M, 30, { color: '#99F0E1' });
    text(bill.property.name, M, 44, { font: 'B', size: 21, color: C.white, width: CW * 0.58 });
    // Placeholders from an import ("Address not set yet", pincode 000000, city "-") are not printed.
    const real = (v: string) => (v && !/^(-|address not set yet)$/i.test(v.trim()) ? v : '');
    const addr = [real(bill.property.address), real(bill.property.city)].filter(Boolean).join(', ');
    const area = [real(bill.property.state), bill.property.pincode && bill.property.pincode !== '000000' ? bill.property.pincode : ''].filter(Boolean).join(' - ');
    const phone = bill.property.contactPhone?.trim() ? `Phone: ${bill.property.contactPhone.trim()}` : '';
    [addr, area, phone].filter(Boolean).forEach((line, i) => text(line, M, 74 + i * 13, { size: 8.8, color: C.mint, width: CW * 0.58 }));
    caps('BILLING MONTH', M, 30, { color: '#99F0E1', width: CW, align: 'right' });
    text(monthLabel(bill.billingPeriod), M, 43, { font: 'B', size: 21, color: C.white, width: CW, align: 'right' });
    const st = bill.status === 'CANCELLED' ? { label: 'CANCELLED', tone: 'muted' as Tone } : bill.balance <= 0 ? { label: 'PAID', tone: 'success' as Tone } : state.tone === 'danger' ? { label: 'OVERDUE', tone: 'danger' as Tone } : bill.paidAmount > 0 ? { label: 'PARTIALLY PAID', tone: 'warning' as Tone } : { label: 'UNPAID', tone: 'warning' as Tone };
    const pw = width(st.label, 'B', 8) + 18;
    pill(st.label, PW - M - pw, 80, st.tone);
    text(bill.billNumber, M, 76, { font: 'S', size: 9, color: C.mint, width: CW - pw - 12, align: 'right' });

    // ---------- Cards ----------
    let y = 134;
    const cw = (CW - 14) / 2;
    const cardH = 92;
    box(M, y, cw, cardH, 10, C.white, C.line);
    caps('BILLED TO', M + 16, y + 14);
    text(bill.tenant.fullName, M + 16, y + 28, { font: 'B', size: 14.5, width: cw - 32 });
    const rw = pill(`ROOM ${bill.room.roomNumber}`.toUpperCase(), M + 16, y + 56, 'success');
    if (bill.tenant.phone) text(bill.tenant.phone, M + 16 + rw + 10, y + 60, { size: 9.5, color: C.soft, width: cw - rw - 42 });
    box(M + cw + 14, y, cw, cardH, 10, C.white, C.line);
    caps('BILL DETAILS', M + cw + 30, y + 14);
    const detail = (label: string, value: string, row: number) => {
      text(label, M + cw + 30, y + 32 + row * 14.5, { size: 8.8, color: C.muted, width: 70 });
      // Long values (the bill period range) step down in size rather than being cut off.
      const room = cw - 116;
      const size = Math.max(8, Math.min(9.2, (9.2 * room) / Math.max(1, width(value, 'S', 9.2))));
      text(value, M + cw + 30 + 70, y + 31.5 + (9.2 - size) / 2 + row * 14.5, { font: 'S', size, width: room, align: 'right' });
    };
    // Bill period · Issued on · Due date, read in that order.
    detail('Bill number', bill.billNumber, 0);
    detail('Bill period', billPeriodLabel(bill.billingPeriod), 1);
    detail('Issued on', formatDateLocal(bill.createdAt), 2);
    detail('Due date', formatDate(bill.dueDate), 3);

    // ---------- Amount due ----------
    y += cardH + 12;
    const tone = TONE[state.tone];
    box(M, y, CW, 84, 12, tone.bg, tone.line);
    caps(state.label, M + 20, y + 16, { color: tone.fg });
    text(state.amount, M + 20, y + 29, { font: 'B', size: state.amount.length > 12 ? 20 : 29, color: tone.fg, width: CW * 0.5 });
    text(state.sub, M + 20, y + 63, { font: 'S', size: 9.2, color: tone.fg, width: CW * 0.5 });
    const rx = M + CW * 0.56;
    const rwid = CW * 0.44 - 20;
    if (bill.balance <= 0 && bill.status !== 'CANCELLED') {
      doc.save();
      doc.rotate(-9, { origin: [rx + rwid / 2, y + 42] });
      doc.opacity(0.9).roundedRect(rx + rwid / 2 - 52, y + 24, 104, 38, 8).lineWidth(2.4).stroke(C.success);
      text('PAID', rx + rwid / 2 - 52, y + 30, { font: 'B', size: 22, color: C.success, width: 104, align: 'center', spacing: 3 });
      doc.restore();
      const paidOn = paymentDateLine(bill);
      if (paidOn) text(paidOn, rx, y + 68, { font: 'S', size: 8.4, color: C.success, width: rwid, align: 'center' });
    } else if (bill.status !== 'CANCELLED') {
      const pct = bill.totalDue > 0 ? Math.min(1, bill.paidAmount / bill.totalDue) : 0;
      text('Paid so far', rx, y + 20, { size: 8.8, color: tone.fg, width: rwid });
      text(`${formatINR(bill.paidAmount)} of ${formatINR(bill.totalDue)}`, rx, y + 20, { font: 'B', size: 9.2, color: tone.fg, width: rwid, align: 'right' });
      box(rx, y + 40, rwid, 9, 4.5, C.white);
      if (pct > 0) box(rx, y + 40, Math.max(9, rwid * pct), 9, 4.5, tone.fg);
      text(pct > 0 ? `${Math.round(pct * 100)}% paid` : 'No payment received yet', rx, y + 56, { size: 8.4, color: tone.fg, width: rwid });
      const last = paymentDateLine(bill);
      if (last) text(last, rx, y + 68, { font: 'S', size: 8.4, color: tone.fg, width: rwid });
    }

    // ---------- Breakdown ----------
    y += 84 + 18;
    const all = breakdownLines(bill);
    const carried = all.filter((l) => l.carried);
    let charges = all.filter((l) => !l.carried);
    const extraRows = 1 + carried.length; // the "This month's charges" subtotal and what is carried in
    const summaryH = 138;
    const footerTop = PH - 54;
    // Everything must fit on the page: first the lines get their minimum height, payments use what is left, and any overflow is folded away.
    const available = footerTop - y - 16 - 24 - (14 + summaryH + 14);
    const MIN_ROW = 21;
    const maxLines = Math.max(3, Math.floor(available / MIN_ROW) - extraRows);
    if (charges.length > maxLines) {
      const keep = charges.slice(0, maxLines - 1);
      const rest = charges.slice(maxLines - 1);
      charges = [...keep, { label: `${rest.length} more items`, detail: 'Combined to fit the page', amount: Math.round(rest.reduce((n, l) => n + l.amount, 0) * 100) / 100 }];
    }
    const monthTotal = Math.round(charges.reduce((n, l) => n + l.amount, 0) * 100) / 100;
    // Charges, then the month's subtotal, then what is carried in: the reader can follow how the total is made.
    const lines: (Line & { subtotal?: boolean })[] = [
      ...charges,
      { label: "This month's charges", detail: 'Rent, electricity and other charges for this month', amount: monthTotal, subtotal: true },
      ...carried,
    ];
    const leftover = available - lines.length * MIN_ROW;
    const fit = bill.payments.length ? Math.max(0, Math.min(6, bill.payments.length, Math.floor((leftover - 34 - 16) / 21))) : 0;
    const payments = bill.payments.slice(0, fit);
    const hasQr = !!qr;
    const paymentsH = bill.payments.length ? 34 + payments.length * 21 + (bill.payments.length > payments.length ? 16 : 0) : 0;
    const room = available - paymentsH;
    const rowH = Math.max(MIN_ROW, Math.min(37, room / Math.max(1, lines.length)));
    const showDetail = rowH >= 27;

    caps('BILL BREAKDOWN', M, y);
    doc.moveTo(M + 98, y + 4).lineTo(M + CW, y + 4).lineWidth(0.6).stroke(C.line);
    y += 16;
    box(M, y, CW, 24, 7, '#EEF5F4');
    caps('DESCRIPTION', M + 14, y + 8.5);
    caps('AMOUNT', M + CW - 114, y + 8.5, { width: 100, align: 'right' });
    y += 24;
    lines.forEach((l, i) => {
      if (l.subtotal) {
        doc.rect(M, y, CW, rowH).fill('#E3F1EE');
        doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.8).stroke('#B9DAD3');
      } else if (i % 2 === 1) doc.rect(M, y, CW, rowH).fill(C.zebra);
      const colour = l.tone === 'danger' ? C.danger : l.tone === 'success' ? C.success : l.subtotal ? C.deep : C.ink;
      text(l.label, M + 14, y + (showDetail && l.detail ? 5.5 : (rowH - 11) / 2), { font: l.subtotal ? 'B' : 'S', size: 10.4, color: colour, width: CW - 150 });
      if (showDetail && l.detail) text(l.detail, M + 14, y + 18.5, { size: 8.4, color: C.muted, width: CW - 150 });
      else if (l.detail) {
        // One line beside the label: step down a little, then shorten, so it never wraps into the next row.
        const room = CW - 300;
        const size = Math.max(7.4, Math.min(8.4, (8.4 * room) / Math.max(1, width(l.detail, 'R', 8.4))));
        let detailText = l.detail;
        while (detailText.length > 4 && width(detailText, 'R', size) > room) detailText = `${detailText.slice(0, -2).trimEnd()}…`;
        text(detailText, M + 170, y + (rowH - size) / 2 + 0.5, { size, color: C.muted, width: room + 2 });
      }
      text(signed(l.amount), M + CW - 124, y + (rowH - 11) / 2, { font: l.subtotal ? 'B' : 'S', size: 10.6, color: colour, width: 110, align: 'right' });
      y += rowH;
    });
    doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.8).stroke(C.line);

    // ---------- UPI / note (left) and totals (right) ----------
    y += 14;
    const leftW = CW * 0.46;
    const tx = M + CW - 262;
    if (hasQr) {
      box(M, y, leftW, summaryH, 12, C.tint, '#CDE8E3');
      caps('SCAN TO PAY', M + 16, y + 14, { color: C.primary });
      doc.image(qr!, M + 16, y + 30, { width: 94, height: 94 });
      text(formatINR(bill.balance), M + 124, y + 34, { font: 'B', size: 15, color: C.primary, width: leftW - 136 });
      text('Amount is filled in', M + 124, y + 54, { size: 8.4, color: C.soft, width: leftW - 136 });
      text('Open any UPI app', M + 124, y + 66, { size: 8.4, color: C.soft, width: leftW - 136 });
      text('GPay, PhonePe, Paytm', M + 124, y + 77, { size: 8.4, color: C.soft, width: leftW - 136 });
      text('UPI ID', M + 124, y + 92, { size: 7.8, color: C.muted, width: leftW - 136 });
      text(bill.property.upiId!, M + 124, y + 103, { font: 'S', size: 8.8, color: C.ink, width: leftW - 136 });
    } else {
      box(M, y, leftW, summaryH, 12, C.tint, '#CDE8E3');
      caps('PAYMENT NOTE', M + 16, y + 14, { color: C.primary });
      const paidUp = bill.balance <= 0 || bill.status === 'CANCELLED';
      const noteText = bill.property.billFooterNote?.trim() || (paidUp ? 'Payment received in full. Please keep this bill for your records.' : 'Please pay by the due date. You can pay by cash, UPI or bank transfer, and ask for a receipt.');
      doc.font('R').fontSize(9.6).fillColor(C.soft).text(noteText, M + 16, y + 34, { width: leftW - 32, height: 70, ellipsis: true, lineGap: 2 });
      text(paidUp ? 'Thank you' : `Due ${formatDate(bill.dueDate)}`, M + 16, y + summaryH - 26, { font: 'S', size: 9.4, color: C.primary, width: leftW - 32 });
    }
    let ty = y + 28;
    const sum = (label: string, value: string, o: { color?: string; font?: 'R' | 'S' | 'B'; size?: number } = {}) => {
      text(label, tx, ty, { size: 9.6, color: o.color ?? C.soft, width: 130 });
      text(value, tx + 120, ty - (o.size && o.size > 10 ? 1.5 : 0), { font: o.font ?? 'S', size: o.size ?? 10, color: o.color ?? C.ink, width: 142, align: 'right' });
      ty += 20;
    };
    sum('Total amount', formatINR(bill.totalDue), { font: 'B', size: 12.5 });
    sum('Paid', bill.paidAmount > 0 ? `-${formatINR(bill.paidAmount)}` : formatINR(0), { color: C.success });
    const bt = TONE[bill.balance <= 0 ? 'success' : state.tone];
    box(tx - 8, ty - 2, 270, 30, 8, bt.bg, bt.line);
    text(bill.balance <= 0 ? 'Settled' : 'Balance due', tx + 4, ty + 8.5, { font: 'B', size: 10.6, color: bt.fg, width: 120 });
    text(formatINR(bill.balance), tx + 108, ty + 6.5, { font: 'B', size: 14, color: bt.fg, width: 142, align: 'right' });
    // Informational only: the deposit is held, not billed, so it sits outside the totals.
    const deposit = depositLine(bill);
    if (deposit) text(deposit, tx - 8, ty + 42, { size: 8.2, color: C.soft, width: 270, align: 'right' });
    y += summaryH + 14;

    // ---------- Payments received ----------
    if (bill.payments.length) {
      caps('PAYMENTS RECEIVED', M, y);
      doc.moveTo(M + 112, y + 4).lineTo(M + CW, y + 4).lineWidth(0.6).stroke(C.line);
      y += 16;
      payments.forEach((p, i) => {
        if (i % 2 === 0) box(M, y, CW, 21, 5, C.zebra);
        text(formatDate(p.paymentDate), M + 14, y + 6, { size: 9.2, color: C.soft, width: 90 });
        text(METHOD[p.method] ?? p.method, M + 108, y + 6, { font: 'S', size: 9.2, width: 100 });
        if (p.reference && p.reference !== 'IMPORTED') text(`Ref ${p.reference}`, M + 210, y + 6, { size: 8.8, color: C.muted, width: 190 });
        else if (p.reference === 'IMPORTED') text('Earlier record', M + 210, y + 6, { size: 8.8, color: C.muted, width: 190 });
        text(formatINR(p.amount), M + CW - 124, y + 5.5, { font: 'B', size: 9.8, color: C.success, width: 110, align: 'right' });
        y += 21;
      });
      if (bill.payments.length > payments.length) text(`+ ${bill.payments.length - payments.length} ${payments.length ? 'earlier ' : ''}payments (see the Payments list)`, M + 14, y + 3, { size: 8.4, color: C.muted, width: 300 });
    }

    // ---------- Footer ----------
    doc.moveTo(M, footerTop).lineTo(M + CW, footerTop).lineWidth(0.6).stroke(C.line);
    const note = hasQr ? bill.property.billFooterNote?.trim() : '';
    text(note || 'Thank you for staying with us.', M, footerTop + 11, { font: 'S', size: 9.2, color: C.primary, width: CW, align: 'center' });
    text(`${bill.property.name}  ·  ${bill.billNumber}  ·  This is a computer-generated bill and does not require a signature.`, M, footerTop + 26, { size: 7.8, color: C.muted, width: CW, align: 'center' });
    doc.end();
  });
}