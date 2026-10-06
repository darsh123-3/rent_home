import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Chip, Input, Sheet, Text } from '@/components/ui';
import { CHARGE_LABELS, MONTHLY_CHARGE_TYPES, type ChargeType } from '@/types/api';

/** Water, Housekeeping, MNGL fuel and WiFi first (they have their own bill line), then the other categories. */
export const CHARGE_TYPES: { type: Exclude<ChargeType, 'LATE_FEE'>; label: string }[] = [...MONTHLY_CHARGE_TYPES, 'MAINTENANCE', 'PARKING', 'REPAIR', 'OTHER']
  .map((type) => ({ type: type as Exclude<ChargeType, 'LATE_FEE'>, label: CHARGE_LABELS[type as ChargeType] }));

export interface ChargeRow { type: ChargeType; name: string; amount: string }

export function ChargeSheet({ visible, onClose, onAdd }: { visible: boolean; onClose: () => void; onAdd: (row: ChargeRow) => void }) {
  const [type, setType] = useState<Exclude<ChargeType, 'LATE_FEE'>>('OTHER');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return setError('Enter an amount greater than zero');
    const label = name.trim() || CHARGE_TYPES.find((c) => c.type === type)!.label;
    onAdd({ type, name: label, amount });
    setName(''); setAmount(''); setError(null);
    onClose();
  };

  return (
    <Sheet visible={visible} title="Add Charge" onClose={onClose}>
      <View className="gap-4 pb-4">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" className="flex-grow-0">
          {CHARGE_TYPES.map((c) => <Chip key={c.type} label={c.label} selected={type === c.type} onPress={() => setType(c.type)} />)}
        </ScrollView>
        <Input label="Name (optional)" placeholder={type === 'OTHER' ? 'e.g. Gas cylinder' : 'Custom name'} value={name} onChangeText={setName} />
        <Input label="Amount" prefix="₹" keyboardType="decimal-pad" placeholder="0" value={amount} onChangeText={setAmount} />
        {error ? <Text tone="danger" variant="secondary">{error}</Text> : null}
        <Button label="Add Charge" onPress={add} />
      </View>
    </Sheet>
  );
}
