import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { friendlyError } from '@/api/client';
import { Button, Card, Chip, ChipRow, ConfirmDialog, DateInput, DetailRow, Field, Icon, Input, Modal, MoneyInput, Notice, SectionHeader } from '@/components/ui';
import { METHODS, METHOD_LABEL } from '@/features/payments/constants';
import { formatDate, formatINR, today } from '@/utils/format';
import type { PaymentMethod, SecurityDepositSummary } from '@rental/shared';
import { useAddDeposit, useDeleteDeposit } from './api';

/** Agreed deposit, what was actually received (with dates) and what is still pending. Informational: never billed. */
export function SecurityDepositCard({ deposit, canAdd }: { deposit: SecurityDepositSummary; canAdd: boolean }) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const del = useDeleteDeposit(deposit.assignmentId);
  const none = deposit.receipts.length === 0;
  return (
    <>
      <SectionHeader title="Security deposit" action={canAdd && !none ? <button type="button" onClick={() => setAdding(true)} className="text-small font-medium text-primary">Add deposit received</button> : undefined} />
      <Card>
        <DetailRow label="Agreed security deposit" value={formatINR(deposit.agreed)} />
        <DetailRow label="Total received" value={none ? 'Not recorded' : formatINR(deposit.totalReceived)} tone={none ? undefined : 'success'} strong={!none} />
        <DetailRow label="Pending" value={formatINR(deposit.pending)} tone={deposit.pending > 0 ? 'danger' : undefined} last={none} />
        {deposit.receipts.map((r, i) => (
          <div key={r.id} className={`flex min-h-11 items-center gap-3 py-2.5 ${i < deposit.receipts.length - 1 ? 'border-b border-line' : ''}`}>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{formatINR(r.amount)} <span className="text-small font-normal text-ink-soft">· {METHOD_LABEL[r.method]}</span></div>
              <div className="truncate text-small text-ink-soft">Received {formatDate(r.receivedOn)}{r.note ? ` · ${r.note}` : ''}</div>
            </div>
            <button type="button" onClick={() => { setError(null); setRemoving(r.id); }} aria-label={`Delete deposit of ${formatINR(r.amount)} received ${formatDate(r.receivedOn)}`} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-muted"><Icon icon={Trash2} size={18} tone="muted" /></button>
          </div>
        ))}
      </Card>
      {none && canAdd ? <div className="mt-3"><Button variant="secondary" icon={Plus} onClick={() => setAdding(true)}>Add deposit received</Button></div> : null}
      {error ? <div className="mt-3"><Notice tone="danger">{error}</Notice></div> : null}
      {adding ? <AddDepositModal assignmentId={deposit.assignmentId} onClose={() => setAdding(false)} /> : null}
      <ConfirmDialog open={!!removing} title="Delete this deposit entry?" message="Use this only to correct a mistake. The totals are worked out again from the remaining entries." confirmLabel="Delete" destructive loading={del.isPending}
        onConfirm={async () => { try { await del.mutateAsync(removing!); setRemoving(null); } catch (e) { setRemoving(null); setError(friendlyError(e)); } }}
        onCancel={() => setRemoving(null)} />
    </>
  );
}

function AddDepositModal({ assignmentId, onClose }: { assignmentId: string; onClose: () => void }) {
  const add = useAddDeposit(assignmentId);
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(today());
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return setError('Enter an amount greater than zero');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) return setError('Select the date it was received');
    if (receivedOn > today()) return setError('Received date cannot be in the future');
    setError(null);
    try {
      await add.mutateAsync({ amount: Number(amount), receivedOn, method, note: note.trim() || undefined });
      onClose();
    } catch (e) { setError(friendlyError(e)); }
  };
  return (
    <Modal open title="Add deposit received" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4 pb-2" noValidate>
        <MoneyInput label="Amount received" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        <DateInput label="Received on" max={today()} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
        <Field label="Method"><ChipRow>{METHODS.map((m) => <Chip key={m.value} label={m.label} selected={method === m.value} onClick={() => setMethod(m.value)} />)}</ChipRow></Field>
        <Input label="Note (optional)" placeholder="e.g. Second instalment" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="text-caption text-ink-muted">The deposit is not added to any bill. It is shown on bills for information only.</p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button type="submit" loading={add.isPending}>Save deposit</Button>
      </form>
    </Modal>
  );
}
