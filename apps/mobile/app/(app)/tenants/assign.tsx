import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { View } from 'react-native';
import { friendlyError } from '@/api/client';
import { Button, ErrorState, Header, Screen, SkeletonList, Text } from '@/components/ui';
import { useAssignRoom, useTenant } from '@/features/tenants/api';
import { RentFields, RoomPicker } from '@/features/tenants/AssignmentFields';
import { assignmentFieldErrors, assignmentPayload, emptyTenantForm, TenantForm, tenantFormSchema } from '@/features/tenants/schemas';
import { today } from '@/utils/format';

export default function AssignRoomScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: t, isLoading, isError, error, refetch } = useTenant(id);
  const assign = useAssignRoom();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<TenantForm>({ resolver: zodResolver(tenantFormSchema.partial() as any), defaultValues: { ...emptyTenantForm, joiningDate: today(), startDate: today(), depositReceivedOn: today() } });

  const roomId = useWatch({ control: form.control, name: 'roomId' });

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    if (!v.roomId) return setFormError('Choose a room');
    if (!v.agreedRent) return form.setError('agreedRent', { message: 'Enter the monthly rent' });
    const problems = assignmentFieldErrors({ ...emptyTenantForm, ...v });
    problems.forEach((p) => form.setError(p.field, { message: p.message }));
    if (problems.length) return;
    try {
      await assign.mutateAsync({ tenantId: id, ...assignmentPayload(v) });
      router.replace({ pathname: '/tenants/[id]', params: { id } });
    } catch (e) {
      setFormError(friendlyError(e));
    }
  });

  if (isLoading) return <Screen><Header title="Assign Room" /><SkeletonList count={2} /></Screen>;
  if (isError || !t) return <Screen><Header title="Assign Room" /><ErrorState error={error} onRetry={refetch} /></Screen>;

  return (
    <Screen edges={['top', 'bottom']} footer={<View className="px-4 pb-4 pt-2"><Button label="Assign Room" onPress={submit} loading={assign.isPending} /></View>}>
      <Header title="Assign Room" subtitle={t.fullName} />
      <FormProvider {...form}>
        <View className="gap-5 pt-2">
          <RoomPicker />
          {roomId ? <RentFields /> : null}
          {formError ? <Text tone="danger" variant="secondary">{formError}</Text> : null}
        </View>
      </FormProvider>
    </Screen>
  );
}
