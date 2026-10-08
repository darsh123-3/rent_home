import { useState } from 'react';
import { friendlyError } from '@/api/client';
import { Button, Input, Modal, Notice } from '@/components/ui';
import { formatDate, formatINR } from '@/utils/format';
import type { PaymentRow } from '@rental/shared';
import { useReversePayment } from './api';

/**
 * Undoes a payment recorded by mistake. Nothing is deleted: a reversal entry is added, the bill's balance comes back and
 * every total (dues, reports, Excel) stops counting the payment.
 */
export function ReversePaymentModal({ payment, onClose }: { payment: PaymentRow; onClose: () => void }) {
  const reverse = useReversePayment();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!reason.trim()) return setError('Enter a reason, e.g. "Recorded twice"');
    setError(null);
    try {
      await reverse.mutateAsync({ id: payment.id, reason: reason.trim() });
      onClose();
    } catch (e) { setError(friendlyError(e)); }
  };
  return (
    <Modal open title="Reverse this payment?" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4 pb-2" noValidate>
        <p className="text-ink-soft">{formatINR(payment.amount)} received on {formatDate(payment.paymentDate)} will no longer count. The bill's balance goes back up by this amount. The payment stays in the history, marked as reversed.</p>
        <Input label="Reason" placeholder="e.g. Recorded twice" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button type="submit" variant="danger" loading={reverse.isPending}>Reverse payment</Button>
      </form>
    </Modal>
  );
}
