import { Plus, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { friendlyError } from '@/api/client';
import { Button, Card, Chip, ConfirmDialog, DateField, DetailRow, Icon, Input, SectionHeader, Sheet, Text } from '@/components/ui';
import { METHODS, METHOD_LABEL } from '@/features/payments/constants';
import type { PaymentMethod, SecurityDepositSummary } from '@/types/api';
import { formatDate, formatINR, today } from '@/utils/format';
import { useAddDeposit, useDeleteDeposit } from './api';

/** Agreed deposit, what was actually received (with dates) and what is still pending. Informational: never billed. */
export function SecurityDepositSection({ deposit }: { deposit: SecurityDepositSummary }) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const del = useDeleteDeposit(deposit.assignmentId);
  const none = deposit.receipts.length === 0;
  return (
    <>
      <SectionHeader title="Security deposit" actionLabel={none ? undefined : 'Add received'} onAction={none ? undefined : () => setAdding(true)} />
      <Card>
        <DetailRow label="Agreed security deposit" value={formatINR(deposit.agreed)} />
        <DetailRow label="Total received" value={none ? 'Not recorded' : formatINR(deposit.totalReceived)} tone={none ? undefined : 'success'} strong={!none} />
        <DetailRow label="Pending" value={formatINR(deposit.pending)} tone={deposit.pending > 0 ? 'danger' : undefined} last={none} />
        {deposit.receipts.map((r, i) => (
          <View key={r.id} className={`min-h-11 flex-row items-center gap-3 py-2.5 ${i < deposit.receipts.length - 1 ? 'border-b border-line' : ''}`}>
            <View className="flex-1">
              <Text variant="bodyMedium">{formatINR(r.amount)} <Text variant="secondary" tone="soft">· {METHOD_LABEL[r.method]}</Text></Text>
              <Text variant="secondary" tone="soft" numberOfLines={1}>Received {formatDate(r.receivedOn)}{r.note ? ` · ${r.note}` : ''}</Text>
            </View>
            <Pressable onPress={() => { setError(null); setRemoving(r.id); }} accessibilityRole="button" accessibilityLabel={`Delete deposit of ${formatINR(r.amount)} received ${formatDate(r.receivedOn)}`} hitSlop={8} className="h-10 w-10 items-center justify-center">
              <Icon icon={Trash2} size="sm" tone="muted" />
            </Pressable>
          </View>
        ))}
      </Card>
      {none ? <View className="mt-3"><Button label="Add deposit received" icon={Plus} variant="secondary" onPress={() => setAdding(true)} /></View> : null}
      {error ? <Text tone="danger" variant="secondary" className="mt-2">{error}</Text> : null}
      <AddDepositSheet assignmentId={deposit.assignmentId} visible={adding} onClose={() => setAdding(false)} />
      <ConfirmDialog visible={!!removing} title="Delete this deposit entry?" message="Use this only to correct a mistake. The totals are worked out again from the remaining entries." confirmLabel="Delete" destructive loading={del.isPending}
        onConfirm={async () => { try { await del.mutateAsync(removing!); setRemoving(null); } catch (e) { setRemoving(null); setError(friendlyError(e)); } }}
        onCancel={() => setRemoving(null)} />
    </>
  );
}

function AddDepositSheet({ assignmentId, visible, onClose }: { assignmentId: string; visible: boolean; onClose: () => void }) {
  const add = useAddDeposit(assignmentId);
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(today());
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return setError('Enter an amount greater than zero');
    if (receivedOn > today()) return setError('Received date cannot be in the future');
    setError(null);
    try {
      await add.mutateAsync({ amount: Number(amount), receivedOn, method, note: note.trim() || undefined });
      setAmount(''); setNote(''); setReceivedOn(today());
      onClose();
    } catch (e) { setError(friendlyError(e)); }
  };
  return (
    <Sheet visible={visible} title="Add deposit received" onClose={onClose}>
      <View className="gap-4 pb-4">
        <Input label="Amount received" prefix="₹" keyboardType="decimal-pad" placeholder="0" value={amount} onChangeText={setAmount} />
        <DateField label="Received on" value={receivedOn} onChange={setReceivedOn} maximumDate={new Date()} />
        <View className="gap-1.5">
          <Text variant="label" tone="soft">Method</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" className="flex-grow-0">
            {METHODS.map((m) => <Chip key={m.value} label={m.label} selected={method === m.value} onPress={() => setMethod(m.value)} />)}
          </ScrollView>
        </View>
        <Input label="Note (optional)" placeholder="e.g. Second instalment" maxLength={200} value={note} onChangeText={setNote} />
        <Text variant="caption" tone="muted">The deposit is not added to any bill. It is shown on bills for information only.</Text>
        {error ? <Text tone="danger" variant="secondary">{error}</Text> : null}
        <Button label="Save deposit" onPress={save} loading={add.isPending} />
      </View>
    </Sheet>
  );
}
