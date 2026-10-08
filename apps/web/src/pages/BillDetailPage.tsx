import { Banknote, CircleCheck, Link2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { friendlyError } from '@/api/client';
import { Button, Card, ConfirmDialog, DetailRow, ErrorState, Icon, LinkButton, Notice, SectionHeader, SkeletonList } from '@/components/ui';
import { Page } from '@/components/layout/Page';
import { useBill, useCancelBill, useDeleteBill } from '@/features/bills/api';
import { BillActions } from '@/features/bills/BillActions';
import { BillStatusBadge } from '@/features/bills/BillCard';
import { AgreementBadge } from '@/features/tenants/AgreementBadge';
import { METHOD_LABEL } from '@/features/payments/constants';
import { formatDate, formatINR, formatMonth } from '@/utils/format';
import type { BillDetail, BillItemRow } from '@rental/shared';

const itemLabel = (i: BillItemRow) =>
  i.type === 'ELECTRICITY' && i.meta?.currentReading != null ? `Electricity (${i.meta.units} units × ${formatINR(i.meta.ratePerUnit)})`
    : i.type === 'CHARGE' && typeof i.meta?.note === 'string' && i.meta.note ? `${i.description} (${i.meta.note})` : i.description;

/** The message sent with a shared bill, e.g. "Rent bill for August 2026, Room 1 (INV-...). Amount due: ₹7,100 by 10 Sep 2026." */
const billShareText = (bill: BillDetail) => {
  const head = `Rent bill for ${formatMonth(bill.billingPeriod)}, Room ${bill.room.roomNumber} (${bill.billNumber}).`;
  if (bill.balance <= 0) return `${head} Paid in full. Thank you.`;
  if (bill.carriedInto) return `${head} The balance is included in bill ${bill.carriedInto.billNumber}.`;
  return `${head} Amount due: ${formatINR(bill.balance)} by ${formatDate(bill.dueDate)}.`;
};

function Banner({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-3 rounded-lg bg-success-soft p-4" role="status">
      <Icon icon={CircleCheck} size={28} tone="success" />
      <div><div className="text-heading text-success">{title}</div><div className="text-small text-success">{children}</div></div>
    </div>
  );
}

export function BillDetailPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const created = params.get('created') === '1';
  const paid = params.get('paid') === '1';
  const navigate = useNavigate();
  const { data: bill, isLoading, isError, error, refetch } = useBill(id);
  const cancel = useCancelBill(id);
  const del = useDeleteBill(id);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isLoading) return <Page title="Bill" back="/bills"><SkeletonList count={2} /></Page>;
  if (isError || !bill) return <Page title="Bill" back="/bills"><ErrorState error={error} onRetry={() => void refetch()} /></Page>;

  const cancelled = bill.status === 'CANCELLED';
  const canCancel = !cancelled && bill.paidAmount === 0 && !bill.carriedInto;
  const canPay = !cancelled && !bill.carriedInto && bill.balance > 0;

  return (
    <Page title={formatMonth(bill.billingPeriod)} subtitle={bill.billNumber} back="/bills">
      {created ? <Banner title="Bill Generated">The totals were calculated and verified by the server.</Banner> : null}
      {paid ? <Banner title="Payment recorded">{bill.balance > 0 ? `${formatINR(bill.balance)} still pending on this bill.` : 'This bill is now fully paid.'}</Banner> : null}

      <Card className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div><Link to={`/tenants/${bill.tenant.id}`} className="text-heading hover:underline">{bill.tenant.fullName}</Link><div className="text-small text-ink-soft">Room {bill.room.roomNumber} · {bill.property.name}</div></div>
          <BillStatusBadge status={bill.status} />
        </div>
        {!cancelled ? <AgreementBadge agreement={bill.agreement} compact /> : null}
        <div className="border-t border-line pt-1">
          <DetailRow label="Bill period" value={`${formatDate(bill.billPeriodStart)} – ${formatDate(bill.billPeriodEnd)}`} />
          <DetailRow label="Issued on" value={formatDate(bill.issuedOn)} />
          <DetailRow label="Due date" value={formatDate(bill.dueDate)} tone={bill.status === 'OVERDUE' ? 'danger' : undefined} last />
        </div>
      </Card>

      <SectionHeader title="Charges" />
      <Card>
        {bill.items.map((i, idx) => (
          <div key={i.id} className={`flex min-h-11 items-center justify-between gap-4 py-2.5 ${idx < bill.items.length - 1 ? 'border-b border-line' : ''}`}>
            <span className={`flex-1 text-small ${i.type === 'PREVIOUS_BALANCE' ? 'text-danger' : 'text-ink-soft'}`}>{itemLabel(i)}</span>
            <span className={`font-medium ${i.amount < 0 ? 'text-success' : ''}`}>{i.amount < 0 ? `-${formatINR(-i.amount)}` : formatINR(i.amount)}</span>
          </div>
        ))}
        <div className="mt-1 space-y-1 border-t-2 border-line-strong pt-3">
          <div className="flex items-center justify-between"><span className="text-heading">Total</span><span className="text-title">{formatINR(bill.totalDue)}</span></div>
          <div className="flex items-center justify-between"><span className="text-ink-soft">Paid</span><span className="font-medium text-success">{formatINR(bill.paidAmount)}</span></div>
          <div className="flex items-center justify-between"><span className="text-ink-soft">Balance</span><span className={`text-heading ${bill.balance > 0 && !bill.carriedInto ? 'text-danger' : ''}`}>{formatINR(bill.balance)}</span></div>
          {!cancelled && bill.paidInFullOn ? <div className="flex items-center justify-end gap-1.5 text-small font-semibold text-success"><Icon icon={CircleCheck} size={16} tone="success" />Paid in full on {formatDate(bill.paidInFullOn)}</div> : null}
          {!cancelled && bill.lastPayment ? <div className="text-right text-small text-ink-soft">Last payment {formatINR(bill.lastPayment.amount)} on {formatDate(bill.lastPayment.paymentDate)}</div> : null}
        </div>
        {bill.securityDeposit ? <p className="mt-3 border-t border-line pt-2 text-small text-ink-soft">Security deposit received: {formatINR(bill.securityDeposit.totalReceived)}{bill.securityDeposit.lastReceivedOn ? ` (last received ${formatDate(bill.securityDeposit.lastReceivedOn)})` : ''}. Not part of this bill.</p> : null}
      </Card>

      {!cancelled ? (
        <>
          <SectionHeader title={created ? 'Share this bill' : 'Invoice'} />
          <BillActions billId={bill.id} billNumber={bill.billNumber} version={`${bill.paidAmount}-${bill.storedStatus}`} tenantName={bill.tenant.fullName} shareText={billShareText(bill)} />
        </>
      ) : null}

      {canPay ? <div className="mt-4"><LinkButton to={`/payments/new?billId=${bill.id}`} icon={Banknote} variant={created ? 'secondary' : 'primary'}>Record Payment</LinkButton></div> : null}

      {bill.payments.length > 0 ? (
        <>
          <SectionHeader title="Payments" />
          <Card padded={false} className="overflow-hidden">
            {bill.payments.map((p, i) => (
              <div key={p.id} className={`flex items-center justify-between px-4 py-3 ${i < bill.payments.length - 1 ? 'border-b border-line' : ''}`}>
                <div className="pr-3"><div className="font-medium">{METHOD_LABEL[p.method]}</div><div className="text-small text-ink-soft">Received {formatDate(p.paymentDate)}{p.reference ? ` · ${p.reference}` : ''}</div></div>
                <span className="text-heading text-success">{formatINR(p.amount)}</span>
              </div>
            ))}
          </Card>
        </>
      ) : null}

      {bill.carriedInto ? <Card className="mt-3" padded={false}><Link to={`/bills/${bill.carriedInto.id}`} className="flex items-center gap-2 p-4 font-medium text-primary"><Icon icon={Link2} tone="primary" />Balance carried forward to {bill.carriedInto.billNumber}</Link></Card> : null}
      {bill.absorbed.length ? <div className="mt-3 flex items-center gap-2 text-small text-ink-muted"><Icon icon={Link2} size={16} tone="muted" />Includes unpaid balance from {bill.absorbed.map((b) => b.billNumber).join(', ')}</div> : null}
      {bill.notes ? <p className="mt-3 text-small text-ink-soft">{bill.notes}</p> : null}

      {canCancel ? (
        <div className="mt-6 space-y-2">
          <Button variant="danger" onClick={() => setConfirming(true)}>Cancel Bill</Button>
          {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
        </div>
      ) : null}

      {cancelled && bill.paidAmount === 0 ? (
        <div className="mt-6 space-y-2">
          <Button variant="danger" onClick={() => { setActionError(null); setDeleting(true); }}>Delete Bill</Button>
          {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
        </div>
      ) : null}

      <ConfirmDialog open={deleting} title="Delete this cancelled bill?" message="The bill is removed for good and will no longer appear in your bills or exports. This cannot be undone." confirmLabel="Delete bill" destructive loading={del.isPending}
        onConfirm={async () => { try { await del.mutateAsync(); setDeleting(false); navigate('/bills', { replace: true }); } catch (e) { setDeleting(false); setActionError(friendlyError(e)); } }}
        onCancel={() => setDeleting(false)} />

      <ConfirmDialog open={confirming} title="Cancel this bill?" message="The bill is kept for your records but no longer counts toward what the tenant owes. You can generate it again afterwards." confirmLabel="Cancel bill" destructive loading={cancel.isPending}
        onConfirm={async () => { try { await cancel.mutateAsync(undefined); setConfirming(false); navigate(`/bills/${id}`, { replace: true }); } catch (e) { setConfirming(false); setActionError(friendlyError(e)); } }}
        onCancel={() => setConfirming(false)} />
    </Page>
  );
}