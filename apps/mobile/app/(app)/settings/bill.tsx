import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';
import { z } from 'zod';
import { friendlyError } from '@/api/client';
import { Button, EmptyState, Header, MoneyField, Screen, Text, TextField } from '@/components/ui';
import { useSaveProperty } from '@/features/properties/api';
import { useProperty } from '@/features/properties/PropertyProvider';
import { moneyString, orUndefined, toNumber } from '@/utils/validation';
import { Receipt } from 'lucide-react-native';

const schema = z.object({
  billPrefix: z.string().trim().regex(/^[A-Za-z0-9]{1,8}$/, 'Use 1 to 8 letters or numbers'),
  dueDayOfMonth: z.string().trim().regex(/^\d+$/, 'Enter a day from 1 to 28').refine((v) => Number(v) >= 1 && Number(v) <= 28, 'Enter a day from 1 to 28'),
  defaultRatePerUnit: moneyString('Rate'),
  billFooterNote: z.string().trim().max(300),
  contactPhone: z.string().trim().refine((v) => v === '' || /^\+?[0-9]{10,15}$/.test(v.replace(/[\s-]/g, '')), 'Enter a valid phone number'),
  upiId: z.string().trim().refine((v) => v === '' || /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,32}$/.test(v), 'Enter a valid UPI ID such as name@bank'),
});

export default function BillSettingsScreen() {
  const router = useRouter();
  const { current } = useProperty();
  const save = useSaveProperty(current?.id);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { control, handleSubmit, reset } = useForm({ resolver: zodResolver(schema), defaultValues: { billPrefix: '', dueDayOfMonth: '', defaultRatePerUnit: '', billFooterNote: '', upiId: '', contactPhone: '' } });

  useEffect(() => {
    if (current) reset({ billPrefix: current.billPrefix, dueDayOfMonth: String(current.dueDayOfMonth), defaultRatePerUnit: String(current.defaultRatePerUnit), billFooterNote: current.billFooterNote ?? '', upiId: current.upiId ?? '', contactPhone: current.contactPhone ?? '' });
  }, [current, reset]);

  if (!current) return <Screen><Header title="Bill Settings" /><EmptyState icon={Receipt} title="No property yet" message="Add a property to configure its bills." /></Screen>;

  const submit = handleSubmit(async (v) => {
    setError(null); setSaved(false);
    try {
      await save.mutateAsync({ billPrefix: v.billPrefix.toUpperCase(), dueDayOfMonth: Number(v.dueDayOfMonth), defaultRatePerUnit: toNumber(v.defaultRatePerUnit), billFooterNote: orUndefined(v.billFooterNote) ?? '', upiId: v.upiId, contactPhone: v.contactPhone.replace(/[\s-]/g, '') });
      setSaved(true);
      setTimeout(() => router.back(), 600);
    } catch (e) {
      setError(friendlyError(e));
    }
  });

  return (
    <Screen edges={['top', 'bottom']} footer={<View className="px-4 pb-4 pt-2"><Button label={saved ? 'Saved' : 'Save Settings'} onPress={submit} loading={save.isPending} /></View>}>
      <Header title="Bill Settings" subtitle={current.name} />
      <View className="gap-4 pt-2">
        <TextField control={control} name="billPrefix" label="Bill Number Prefix" placeholder="INV" autoCapitalize="characters" hint="Bills are numbered like SUN-202610-0001" />
        <TextField control={control} name="dueDayOfMonth" label="Due Day of Month" placeholder="10" keyboardType="number-pad" hint="New bills fall due on this day (1 to 28)" maxLength={2} />
        <MoneyField control={control} name="defaultRatePerUnit" label="Default Electricity Rate per Unit" hint="Used for new rooms and tenants that do not set their own rate" />
        <TextField control={control} name="upiId" label="UPI ID (optional)" placeholder="name@bank" autoCapitalize="none" autoCorrect={false} hint="Shows a scan-to-pay QR code, with the amount filled in, on every unpaid bill PDF" />
        <TextField control={control} name="contactPhone" label="Contact Phone (optional)" placeholder="98765 43210" keyboardType="phone-pad" hint="Printed under the address at the top of every bill. Leave empty to hide it." />
        <TextField control={control} name="billFooterNote" label="Invoice Footer Note" multiline placeholder="e.g. Please pay by UPI to rent@upi" hint="Printed at the bottom of every PDF invoice" />
        {error ? <Text tone="danger" variant="secondary">{error}</Text> : null}
      </View>
    </Screen>
  );
}
