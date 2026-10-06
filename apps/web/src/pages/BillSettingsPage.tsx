import { zodResolver } from '@hookform/resolvers/zod';
import { Receipt } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { friendlyError } from '@/api/client';
import { Button, EmptyState, Input, MoneyInput, Notice, Textarea } from '@/components/ui';
import { Page } from '@/components/layout/Page';
import { useSaveProperty } from '@/features/properties/api';
import { useProperty } from '@/features/properties/PropertyProvider';
import { moneyString, orUndefined, toNumber } from '@/utils/validation';

const schema = z.object({
  billPrefix: z.string().trim().regex(/^[A-Za-z0-9]{1,8}$/, 'Use 1 to 8 letters or numbers'),
  dueDayOfMonth: z.string().trim().regex(/^\d+$/, 'Enter a day from 1 to 28').refine((v) => Number(v) >= 1 && Number(v) <= 28, 'Enter a day from 1 to 28'),
  defaultRatePerUnit: moneyString('Rate'),
  billFooterNote: z.string().trim().max(300),
  contactPhone: z.string().trim().refine((v) => v === '' || /^\+?[0-9]{10,15}$/.test(v.replace(/[\s-]/g, '')), 'Enter a valid phone number'),
  upiId: z.string().trim().refine((v) => v === '' || /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,32}$/.test(v), 'Enter a valid UPI ID such as name@bank'),
});
type Form = z.infer<typeof schema>;

export function BillSettingsPage() {
  const navigate = useNavigate();
  const { current } = useProperty();
  const save = useSaveProperty(current?.id);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { billPrefix: '', dueDayOfMonth: '', defaultRatePerUnit: '', billFooterNote: '', upiId: '', contactPhone: '' } });
  useEffect(() => {
    if (current) reset({ billPrefix: current.billPrefix, dueDayOfMonth: String(current.dueDayOfMonth), defaultRatePerUnit: String(current.defaultRatePerUnit), billFooterNote: current.billFooterNote ?? '', upiId: current.upiId ?? '', contactPhone: current.contactPhone ?? '' });
  }, [current, reset]);

  if (!current) return <Page title="Bill Settings" back><EmptyState icon={Receipt} title="No property yet" message="Add a property to configure its bills." /></Page>;

  const submit = handleSubmit(async (v) => {
    setError(null); setSaved(false);
    try {
      await save.mutateAsync({ billPrefix: v.billPrefix.toUpperCase(), dueDayOfMonth: Number(v.dueDayOfMonth), defaultRatePerUnit: toNumber(v.defaultRatePerUnit), billFooterNote: orUndefined(v.billFooterNote) ?? '', upiId: v.upiId, contactPhone: v.contactPhone.replace(/[ -]/g, '') });
      setSaved(true);
      setTimeout(() => navigate(-1), 600);
    } catch (e) { setError(friendlyError(e)); }
  });

  return (
    <Page title="Bill Settings" subtitle={current.name} back>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Bill Number Prefix" placeholder="INV" autoCapitalize="characters" hint="Bills are numbered like SUN-202610-0001" error={errors.billPrefix?.message} {...register('billPrefix')} />
        <Input label="Due Day of Month" placeholder="10" inputMode="numeric" maxLength={2} hint="New bills fall due on this day (1 to 28)" error={errors.dueDayOfMonth?.message} {...register('dueDayOfMonth')} />
        <MoneyInput label="Default Electricity Rate per Unit" hint="Used for new rooms and tenants that do not set their own rate" error={errors.defaultRatePerUnit?.message} {...register('defaultRatePerUnit')} />
        <Input label="UPI ID (optional)" placeholder="name@bank" autoCapitalize="none" autoCorrect="off" hint="Shows a scan-to-pay QR code, with the amount filled in, on every unpaid bill PDF." error={errors.upiId?.message} {...register('upiId')} />
        <Input label="Contact Phone (optional)" type="tel" placeholder="98765 43210" hint="Printed under the address at the top of every bill. Leave empty to hide it." error={errors.contactPhone?.message} {...register('contactPhone')} />
        <Textarea label="Invoice Footer Note" placeholder="e.g. Please pay by UPI to rent@upi" hint="Printed at the bottom of every PDF invoice" error={errors.billFooterNote?.message} {...register('billFooterNote')} />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button type="submit" loading={save.isPending}>{saved ? 'Saved' : 'Save Settings'}</Button>
      </form>
    </Page>
  );
}
