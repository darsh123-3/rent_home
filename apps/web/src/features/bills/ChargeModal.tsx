import { useState } from 'react';
import { Button, Chip, ChipRow, Input, Modal, MoneyInput, Notice } from '@/components/ui';
import { CHARGE_LABELS, MONTHLY_CHARGE_TYPES, type ChargeType } from '@rental/shared';

/** Water, Housekeeping, MNGL fuel and WiFi first (they have their own bill line), then the other categories. */
export const CHARGE_TYPES: { type: Exclude<ChargeType, 'LATE_FEE'>; label: string }[] = [...MONTHLY_CHARGE_TYPES, 'MAINTENANCE', 'PARKING', 'REPAIR', 'OTHER']
  .map((type) => ({ type: type as Exclude<ChargeType, 'LATE_FEE'>, label: CHARGE_LABELS[type as ChargeType] }));

export interface ChargeRow { type: ChargeType; name: string; amount: string }

export function ChargeModal({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (row: ChargeRow) => void }) {
  const [type, setType] = useState<Exclude<ChargeType, 'LATE_FEE'>>('OTHER');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return setError('Enter an amount greater than zero');
    onAdd({ type, name: name.trim() || CHARGE_TYPES.find((c) => c.type === type)!.label, amount });
    setName(''); setAmount(''); setError(null);
    onClose();
  };
  return (
    <Modal open={open} title="Add Charge" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); add(); }} className="space-y-4 pb-2" noValidate>
        <ChipRow>{CHARGE_TYPES.map((c) => <Chip key={c.type} label={c.label} selected={type === c.type} onClick={() => setType(c.type)} />)}</ChipRow>
        <Input label="Name (optional)" placeholder={type === 'OTHER' ? 'e.g. Gas cylinder' : 'Custom name'} value={name} onChange={(e) => setName(e.target.value)} />
        <MoneyInput label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button type="submit">Add Charge</Button>
      </form>
    </Modal>
  );
}
