import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { friendlyError } from '@/api/client';
import { Button, ErrorState, Notice, SkeletonList } from '@/components/ui';
import { Page } from '@/components/layout/Page';
import { useAssignRoom, useTenant } from '@/features/tenants/api';
import { RentFields, RoomPicker } from '@/features/tenants/AssignmentFields';
import { assignmentFieldErrors, assignmentPayload, emptyTenantForm, tenantFormSchema, type TenantForm } from '@/features/tenants/schemas';
import { today } from '@/utils/format';

export function AssignRoomPage() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { data: t, isLoading, isError, error, refetch } = useTenant(id);
  const assign = useAssignRoom();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<TenantForm>({ resolver: zodResolver(tenantFormSchema.partial()) as never, defaultValues: { ...emptyTenantForm, joiningDate: today(), startDate: today(), depositReceivedOn: today() } });
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
      navigate(`/tenants/${id}`, { replace: true });
    } catch (e) { setFormError(friendlyError(e)); }
  });

  if (isLoading) return <Page title="Assign Room" back><SkeletonList count={2} /></Page>;
  if (isError || !t) return <Page title="Assign Room" back><ErrorState error={error} onRetry={() => void refetch()} /></Page>;

  return (
    <Page title="Assign Room" subtitle={t.fullName} back>
      <FormProvider {...form}>
        <form onSubmit={submit} className="space-y-5" noValidate>
          <RoomPicker />
          {roomId ? <RentFields /> : null}
          {formError ? <Notice tone="danger">{formError}</Notice> : null}
          <Button type="submit" loading={assign.isPending}>Assign Room</Button>
        </form>
      </FormProvider>
    </Page>
  );
}
