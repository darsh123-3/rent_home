import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, View } from 'react-native';
import { friendlyError } from '@/api/client';
import { Button, DateField, ErrorState, Header, Screen, SkeletonList, Text, TextField } from '@/components/ui';
import { useTenant, useUpdateTenant } from '@/features/tenants/api';
import { tenantFormSchema, tenantPayload } from '@/features/tenants/schemas';
import { z } from 'zod';

const schema = tenantFormSchema.pick({
  fullName: true, joiningDate: true, occupation: true, notes: true, phone: true, alternatePhone: true, email: true,
  permanentAddress: true, currentAddress: true, emergencyContact: true, emergencyPhone: true, agreementStartDate: true, agreementEndDate: true,
});
type Form = z.infer<typeof schema>;

export default function EditTenantScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: t, isLoading, isError, error, refetch } = useTenant(id);
  const update = useUpdateTenant(id);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, reset, setError } = useForm<Form>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (t) reset({
      fullName: t.fullName, joiningDate: t.joiningDate.slice(0, 10), occupation: t.occupation ?? '', notes: t.notes ?? '', phone: t.phone,
      alternatePhone: t.alternatePhone ?? '', email: t.email ?? '', permanentAddress: t.permanentAddress ?? '', currentAddress: t.currentAddress ?? '',
      emergencyContact: t.emergencyContact ?? '', emergencyPhone: t.emergencyPhone ?? '',
      agreementStartDate: t.currentAssignment?.agreementStartDate ?? '', agreementEndDate: t.currentAssignment?.agreementEndDate ?? '',
    });
  }, [t, reset]);
  const hasRoom = !!t?.currentAssignment;

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    if (v.agreementStartDate && v.agreementEndDate && v.agreementEndDate < v.agreementStartDate) return setError('agreementEndDate', { message: 'Agreement end date cannot be before the start date' });
    try {
      // Agreement dates belong to the current stay; an empty value clears the date.
      await update.mutateAsync({ ...tenantPayload(v as any), ...(hasRoom ? { agreementStartDate: v.agreementStartDate, agreementEndDate: v.agreementEndDate } : {}) });
      router.back();
    } catch (e) {
      setFormError(friendlyError(e));
    }
  });

  if (isLoading) return <Screen><Header title="Edit Tenant" /><SkeletonList count={2} /></Screen>;
  if (isError) return <Screen><Header title="Edit Tenant" /><ErrorState error={error} onRetry={refetch} /></Screen>;

  return (
    <Screen edges={['top', 'bottom']} footer={<View className="px-4 pb-4 pt-2"><Button label="Save Changes" onPress={submit} loading={update.isPending} /></View>}>
      <Header title="Edit Tenant" subtitle={t?.fullName} />
      <View className="gap-4 pt-2">
        <TextField control={control} name="fullName" label="Full Name" autoCapitalize="words" />
        <TextField control={control} name="phone" label="Phone" keyboardType="phone-pad" />
        <TextField control={control} name="alternatePhone" label="Alternate Phone" keyboardType="phone-pad" />
        <TextField control={control} name="email" label="Email" keyboardType="email-address" autoCapitalize="none" />
        <Controller control={control} name="joiningDate" render={({ field, fieldState }) => <DateField label="Joining Date" value={field.value} onChange={field.onChange} error={fieldState.error?.message} />} />
        <TextField control={control} name="occupation" label="Occupation" />
        <TextField control={control} name="currentAddress" label="Current Address" multiline />
        <TextField control={control} name="permanentAddress" label="Permanent Address" multiline />
        <TextField control={control} name="emergencyContact" label="Emergency Contact" />
        <TextField control={control} name="emergencyPhone" label="Emergency Phone" keyboardType="phone-pad" />
        <TextField control={control} name="notes" label="Notes" multiline />
        {hasRoom ? (['agreementStartDate', 'agreementEndDate'] as const).map((name) => (
          <Controller key={name} control={control} name={name} render={({ field, fieldState }) => (
            <View className="gap-1">
              <DateField label={name === 'agreementStartDate' ? 'Agreement Start Date' : 'Agreement End Date'} value={field.value || undefined} onChange={field.onChange} error={fieldState.error?.message} />
              {field.value ? <Pressable onPress={() => field.onChange('')} accessibilityRole="button" hitSlop={8} className="self-end"><Text variant="secondaryMedium" tone="primary">Clear</Text></Pressable> : null}
            </View>
          )} />
        )) : null}
        {formError ? <Text tone="danger" variant="secondary">{formError}</Text> : null}
      </View>
    </Screen>
  );
}
