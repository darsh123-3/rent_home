import { useState } from 'react';
import { View } from 'react-native';
import { friendlyError } from '@/api/client';
import { Button, Input, Sheet, Text } from '@/components/ui';
import type { PaymentRow } from '@/types/api';
import { formatDate, formatINR } from '@/utils/format';
import { useReversePayment } from './api';

/**
 * Undoes a payment recorded by mistake. Nothing is deleted: a reversal entry is added, the bill's balance comes back and
 * every total (dues, reports, Excel) stops counting the payment.
 */
export function ReversePaymentSheet({ payment, onClose }: { payment: PaymentRow | null; onClose: () => void }) {
  const reverse = useReversePayment();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!payment) return;
    if (!reason.trim()) return setError('Enter a reason, e.g. "Recorded twice"');
    setError(null);
    try {
      await reverse.mutateAsync({ id: payment.id, reason: reason.trim() });
      setReason('');
      onClose();
    } catch (e) { setError(friendlyError(e)); }
  };
  return (
    <Sheet visible={!!payment} title="Reverse this payment?" onClose={onClose}>
      <View className="gap-4 pb-4">
        {payment ? <Text tone="soft">{formatINR(payment.amount)} received on {formatDate(payment.paymentDate)} will no longer count. The bill&apos;s balance goes back up by this amount. The payment stays in the history, marked as reversed.</Text> : null}
        <Input label="Reason" placeholder="e.g. Recorded twice" maxLength={200} value={reason} onChangeText={setReason} />
        {error ? <Text tone="danger" variant="secondary">{error}</Text> : null}
        <Button label="Reverse payment" variant="danger" onPress={submit} loading={reverse.isPending} />
      </View>
    </Sheet>
  );
}
