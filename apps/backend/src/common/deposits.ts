import { Prisma } from '@prisma/client';
import { fromPaise, toPaise } from '../billing/bill-calculator';
import { isoDate } from './dates';

type Db = Pick<Prisma.TransactionClient, 'securityDepositReceipt' | 'roomAssignment'>;

/**
 * Security deposit per stay: the agreed amount and what was actually received (sum of the receipts).
 * Computed on read, never stored. Old stays without receipts show 0 received ("not recorded").
 */
export async function depositSummaries(db: Db, assignmentIds: string[]) {
  const [assignments, receipts] = await Promise.all([
    db.roomAssignment.findMany({ where: { id: { in: assignmentIds } }, select: { id: true, securityDeposit: true } }),
    db.securityDepositReceipt.findMany({ where: { assignmentId: { in: assignmentIds } }, orderBy: [{ receivedOn: 'desc' }, { createdAt: 'desc' }] }),
  ]);
  const out = new Map<string, ReturnType<typeof summarise>>();
  for (const a of assignments) out.set(a.id, summarise(a.id, a.securityDeposit.toNumber(), receipts.filter((r) => r.assignmentId === a.id)));
  return out;
}

function summarise(assignmentId: string, agreed: number, receipts: { id: string; amount: Prisma.Decimal; receivedOn: Date; method: string; note: string | null; createdAt: Date }[]) {
  const received = receipts.reduce((s, r) => s + toPaise(r.amount.toNumber()), 0);
  return {
    assignmentId,
    agreed,
    totalReceived: fromPaise(received),
    pending: fromPaise(Math.max(toPaise(agreed) - received, 0)),
    lastReceivedOn: receipts[0] ? isoDate(receipts[0].receivedOn) : null,
    receipts: receipts.map((r) => ({ id: r.id, amount: r.amount.toNumber(), receivedOn: isoDate(r.receivedOn), method: r.method, note: r.note, createdAt: r.createdAt })),
  };
}
