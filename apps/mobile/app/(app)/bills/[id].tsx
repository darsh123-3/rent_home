import { useLocalSearchParams, useRouter } from 'expo-router';
import { Banknote, CircleCheck, Link2, Pencil } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { friendlyError } from '@/api/client';
import { Button, Card, ConfirmDialog, DetailRow, ErrorState, Header, Icon, Screen, SectionHeader, SkeletonList, Text } from '@/components/ui';
import { useBill, useCancelBill } from '@/features/bills/api';
import { BillActions } from '@/features/bills/BillActions';
import { BillStatusBadge } from '@/features/bills/BillCard';
import { METHOD_LABEL } from '@/features/payments/constants';
import { AgreementBadge } from '@/features/tenants/AgreementBadge';
import { formatDate, formatINR, formatMonth, formatMonthShort } from '@/utils/format';
import type { BillDetail, BillItemRow } from '@/types/api';

function itemLabel(i: BillItemRow) {
  if (i.type === 'ELECTRICITY' && i.meta?.currentReading != null) return `Electricity (${i.meta.units} units × ${formatINR(i.meta.ratePerUnit)})`;
  return i.type === 'CHARGE' && typeof i.meta?.note === 'string' && i.meta.note ? `${i.description} (${i.meta.note})` : i.description;
}

/** The message sent with a shared bill, e.g. "Rent bill for August 2026, Room 1 (INV-...). Amount due: ₹7,100 by 10 Sep 2026." */
function billShareText(bill: BillDetail) {
  const head = `Rent bill for ${formatMonth(bill.billingPeriod)}, Room ${bill.room.roomNumber} (${bill.billNumber}).`;
  if (bill.balance <= 0) return `${head} Paid in full. Thank you.`;
  if (bill.carriedInto) return `${head} The balance is included in bill ${bill.carriedInto.billNumber}.`;
  return `${head} Amount due: ${formatINR(bill.balance)} by ${formatDate(bill.dueDate)}.`;
}

export default function BillDetailScreen() {
  const router = useRouter();
  const { id, created, paid, edited } = useLocalSearchParams<{ id: string; created?: string; paid?: string; edited?: string }>();
  const { data: bill, isLoading, isError, error, refetch, isRefetching } = useBill(id);
  const cancel = useCancelBill(id);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isLoading) return <Screen><Header title="Bill" /><SkeletonList count={2} lines={4} /></Screen>;
  if (isError || !bill) return <Screen><Header title="Bill" /><ErrorState error={error} onRetry={refetch} /></Screen>;

  const cancelled = bill.status === 'CANCELLED';
  const canCancel = !cancelled && bill.paidAmount === 0 && !bill.carriedInto;
  const canPay = !cancelled && !bill.carriedInto && bill.balance > 0;

  return (
    <Screen refreshing={isRefetching} onRefresh={refetch} edges={['top']}>
      <Header title={formatMonth(bill.billingPeriod)} subtitle={bill.billNumber} />

      {created === '1' ? (
        <View className="mb-3 flex-row items-center gap-3 rounded-lg bg-success-soft p-4">
          <Icon icon={CircleCheck} size="lg" tone="success" />
          <View className="flex-1">
            <Text variant="heading" tone="success">Bill Generated</Text>
            <Text variant="secondary" tone="success">The totals were calculated and verified by the server.</Text>
          </View>
        </View>
      ) : null}

      {edited === '1' ? (
        <View className="mb-3 flex-row items-center gap-3 rounded-lg bg-success-soft p-4">
          <Icon icon={CircleCheck} size="lg" tone="success" />
          <View className="flex-1">
            <Text variant="heading" tone="success">Bill updated</Text>
            <Text variant="secondary" tone="success">{bill.notes?.split('\n')[0] ?? 'The corrected bill replaces the old one.'} The old bill is kept as cancelled.</Text>
          </View>
        </View>
      ) : null}

      {paid === '1' ? (
        <View className="mb-3 flex-row items-center gap-3 rounded-lg bg-success-soft p-4">
          <Icon icon={CircleCheck} size="lg" tone="success" />
          <View className="flex-1">
            <Text variant="heading" tone="success">Payment recorded</Text>
            <Text variant="secondary" tone="success">{bill.balance > 0 ? `${formatINR(bill.balance)} still pending on this bill.` : 'This bill is now fully paid.'}</Text>
          </View>
        </View>
      ) : null}

      <Card className="gap-3">
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <Text variant="heading">{bill.tenant.fullName}</Text>
            <Text variant="secondary" tone="soft">Room {bill.room.roomNumber} · {bill.property.name}</Text>
          </View>
          <BillStatusBadge status={bill.status} />
        </View>
        {!cancelled ? <AgreementBadge agreement={bill.agreement} compact /> : null}
        <View className="border-t border-line">
          <DetailRow label="Bill period" value={`${formatDate(bill.billPeriodStart)} – ${formatDate(bill.billPeriodEnd)}`} />
          <DetailRow label="Issued on" value={formatDate(bill.issuedOn)} />
          <DetailRow label="Due date" value={formatDate(bill.dueDate)} tone={bill.status === 'OVERDUE' ? 'danger' : undefined} last />
        </View>
      </Card>

      <SectionHeader title="Charges" />
      <Card>
        {bill.items.map((i, idx) => (
          <View key={i.id} className={`min-h-11 flex-row items-center justify-between gap-4 py-2.5 ${idx < bill.items.length - 1 ? 'border-b border-line' : ''}`}>
            <View className="flex-1">
              <Text tone={i.type === 'PREVIOUS_BALANCE' ? 'danger' : 'soft'} variant="secondary">{itemLabel(i)}</Text>
              {i.type === 'PREVIOUS_BALANCE' && bill.absorbed.length ? <Text variant="caption" tone="muted">Not paid on {bill.absorbed.map((b) => `${formatMonthShort(b.billingPeriod)} (${b.billNumber})`).join(', ')}</Text> : null}
            </View>
            <Text variant="bodyMedium" tone={i.amount < 0 ? 'success' : 'ink'}>{i.amount < 0 ? `-${formatINR(-i.amount)}` : formatINR(i.amount)}</Text>
          </View>
        ))}
        <View className="mt-1 gap-1 border-t-2 border-line-strong pt-3">
          <View className="flex-row items-center justify-between"><Text variant="heading">Total</Text><Text variant="title">{formatINR(bill.totalDue)}</Text></View>
          <View className="flex-row items-center justify-between"><Text tone="soft">Paid</Text><Text variant="bodyMedium" tone="success">{formatINR(bill.paidAmount)}</Text></View>
          <View className="flex-row items-center justify-between"><Text tone="soft">Balance</Text><Text variant="heading" tone={bill.balance > 0 && !bill.carriedInto ? 'danger' : 'ink'}>{formatINR(bill.balance)}</Text></View>
          {!cancelled && bill.paidInFullOn ? (
            <View className="flex-row items-center justify-end gap-1.5"><Icon icon={CircleCheck} size="sm" tone="success" /><Text variant="secondaryMedium" tone="success">Paid in full on {formatDate(bill.paidInFullOn)}</Text></View>
          ) : null}
          {!cancelled && bill.lastPayment ? <Text variant="secondary" tone="soft" className="text-right">Last payment {formatINR(bill.lastPayment.amount)} on {formatDate(bill.lastPayment.paymentDate)}</Text> : null}
        </View>
        {bill.securityDeposit ? (
          <Text variant="secondary" tone="soft" className="mt-3 border-t border-line pt-2">
            Security deposit received: {formatINR(bill.securityDeposit.totalReceived)}{bill.securityDeposit.lastReceivedOn ? ` (last received ${formatDate(bill.securityDeposit.lastReceivedOn)})` : ''}. Not part of this bill.
          </Text>
        ) : null}
      </Card>

      {!cancelled ? (
        <>
          <SectionHeader title={created === '1' ? 'Share this bill' : 'Invoice'} />
          <BillActions billId={bill.id} billNumber={bill.billNumber} version={`${bill.paidAmount}-${bill.storedStatus}`} tenantName={bill.tenant.fullName} shareText={billShareText(bill)} />
        </>
      ) : null}

      {canPay ? (
        <View className="mt-4"><Button label="Record Payment" icon={Banknote} variant={created === '1' ? 'secondary' : 'primary'} onPress={() => router.push({ pathname: '/payments/new', params: { billId: bill.id } })} /></View>
      ) : null}

      {bill.payments.length > 0 ? (
        <>
          <SectionHeader title="Payments" />
          <Card padded={false}>
            {bill.payments.map((p, i) => (
              <View key={p.id} className={`flex-row items-center justify-between px-4 py-3 ${i < bill.payments.length - 1 ? 'border-b border-line' : ''}`}>
                <View className="flex-1 pr-3">
                  <Text variant="bodyMedium">{METHOD_LABEL[p.method]}</Text>
                  <Text variant="secondary" tone="soft">Received {formatDate(p.paymentDate)}{p.reference ? ` · ${p.reference}` : ''}</Text>
                </View>
                <Text variant="heading" tone="success">{formatINR(p.amount)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {bill.carriedInto ? (
        <LinkCard onPress={() => router.push({ pathname: '/bills/[id]', params: { id: bill.carriedInto!.id } })} label={`Balance carried forward to ${bill.carriedInto.billNumber}`} />
      ) : null}
      {bill.absorbed.length ? (
        <View className="mt-3 flex-row items-center gap-2"><Icon icon={Link2} size="sm" tone="muted" /><Text variant="secondary" tone="muted" className="flex-1">Includes unpaid balance from {bill.absorbed.map((b) => b.billNumber).join(', ')}</Text></View>
      ) : null}
      {bill.notes ? <Text variant="secondary" tone="soft" className="mt-3">{bill.notes}</Text> : null}

      {canCancel ? (
        <View className="mt-6 gap-3">
          <Button label="Edit Bill" icon={Pencil} variant="secondary" onPress={() => router.push({ pathname: '/bills/new', params: { edit: bill.id } })} />
          <Button label="Cancel Bill" variant="danger" onPress={() => setConfirming(true)} />
          {actionError ? <Text tone="danger" variant="secondary" className="mt-2">{actionError}</Text> : null}
        </View>
      ) : null}

      <ConfirmDialog
        visible={confirming}
        title="Cancel this bill?"
        message="The bill is kept for your records but no longer counts toward what the tenant owes. You can generate it again afterwards."
        confirmLabel="Cancel bill"
        destructive
        loading={cancel.isPending}
        onConfirm={async () => { try { await cancel.mutateAsync(undefined); setConfirming(false); } catch (e) { setConfirming(false); setActionError(friendlyError(e)); } }}
        onCancel={() => setConfirming(false)}
      />
    </Screen>
  );
}

function LinkCard({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Card onPress={onPress} className="mt-3 flex-row items-center gap-2">
      <Icon icon={Link2} tone="primary" />
      <Text variant="secondaryMedium" tone="primary" className="flex-1">{label}</Text>
    </Card>
  );
}
