import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ArrowRight, Check, Pencil } from 'lucide-react-native';
import { useState } from 'react';
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form';
import { Pressable, View } from 'react-native';
import { Button, Card, DateField, DetailRow, Header, Icon, Screen, StepIndicator, Text, TextField } from '@/components/ui';
import { friendlyError } from '@/api/client';
import type { DocumentType } from '@/types/api';
import { useProperty } from '@/features/properties/PropertyProvider';
import { useQueryClient } from '@tanstack/react-query';
import { uploadTenantDocument } from '@/features/documents/api';
import { DOC_ORDER } from '@/features/documents/constants';
import { DocumentSlot } from '@/features/documents/DocumentSlot';
import type { PickedDocument } from '@/features/documents/pickFile';
import { QueueItem, UploadQueue } from '@/features/documents/UploadQueue';
import { useCreateTenant } from '@/features/tenants/api';
import { RentFields, RoomPicker } from '@/features/tenants/AssignmentFields';
import { assignmentFieldErrors, assignmentPayload, emptyTenantForm, STEP_FIELDS, TenantForm, tenantFormSchema, tenantPayload } from '@/features/tenants/schemas';
import { formatDate, formatINR, today } from '@/utils/format';
import { toNumber } from '@/utils/validation';

const STEPS = ['Personal', 'Contact', 'Documents', 'Room', 'Rent & Deposit', 'Review'];

export default function AddTenantScreen() {
  const router = useRouter();
  const { roomId } = useLocalSearchParams<{ roomId?: string }>();
  const { current } = useProperty();
  const create = useCreateTenant();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<Partial<Record<DocumentType, PickedDocument>>>({});
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const DOC_STEP_TYPES = DOC_ORDER.filter((t) => t !== 'OTHER');

  const form = useForm<TenantForm>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: { ...emptyTenantForm, joiningDate: today(), startDate: today(), depositReceivedOn: today(), roomId: roomId ?? '' },
    mode: 'onTouched',
  });
  const { control, trigger, getValues, handleSubmit, setError: setFieldError } = form;
  const watchedRoomId = useWatch({ control, name: 'roomId' });
  const hasRoom = () => !!getValues('roomId');
  const name = STEPS[step];

  const next = async () => {
    if (!(await trigger(STEP_FIELDS[name]))) return;
    if (name === 'Rent & Deposit' && !getValues('agreedRent')) return setFieldError('agreedRent', { message: 'Enter the monthly rent' });
    if (name === 'Rent & Deposit') {
      const problems = assignmentFieldErrors(getValues());
      problems.forEach((p) => setFieldError(p.field, { message: p.message }));
      if (problems.length) return;
    }
    setStep((s) => (name === 'Room' && !hasRoom() ? s + 2 : s + 1));
  };
  const back = () => (step === 0 ? router.back() : setStep((s) => (name === 'Review' && !hasRoom() ? s - 2 : s - 1)));

  const goToProfile = (id: string) => router.replace({ pathname: '/tenants/[id]', params: { id } });

  /** Uploads every picked document that is not done yet; returns true when none failed. */
  const runUploads = async (tenantId: string, only?: DocumentType[]) => {
    const types = (only ?? DOC_STEP_TYPES).filter((t) => docs[t]);
    setQueue((q) => DOC_STEP_TYPES.filter((t) => docs[t]).map((t) => q.find((i) => i.type === t && i.status === 'done') ?? { type: t, status: 'pending', progress: 0 }));
    setQueueOpen(true);
    let ok = true;
    for (const type of types) {
      const patch = (p: Partial<QueueItem>) => setQueue((q) => q.map((i) => (i.type === type ? { ...i, ...p } : i)));
      patch({ status: 'uploading', progress: 0, error: undefined });
      try {
        await uploadTenantDocument(tenantId, docs[type]!, type, (f) => patch({ progress: f }));
        patch({ status: 'done', progress: 1 });
      } catch (e) {
        ok = false;
        patch({ status: 'failed', error: friendlyError(e) });
      }
    }
    await queryClient.invalidateQueries({ queryKey: ['tenants'] });
    return ok;
  };

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      let id = createdId;
      if (!id) {
        const body = { ...tenantPayload(v, v.roomId ? undefined : current?.id), ...(v.roomId ? { assignment: assignmentPayload(v) } : {}) };
        id = (await create.mutateAsync(body)).id;
        setCreatedId(id);
      }
      if (Object.keys(docs).length === 0) return goToProfile(id);
      if (await runUploads(id)) {
        setQueueOpen(false);
        goToProfile(id);
      }
    } catch (e) {
      setError(friendlyError(e));
    }
  });

  const v = getValues();
  const isReview = name === 'Review';

  return (
    <Screen
      edges={['top', 'bottom']}
      footer={
        <View className="flex-row gap-3 px-4 pb-4 pt-2">
          <View className="w-14"><Button label="" icon={ArrowLeft} variant="secondary" onPress={back} accessibilityLabel="Back" /></View>
          <View className="flex-1">
            {isReview ? (
              <Button label="Save Tenant" icon={Check} onPress={submit} loading={create.isPending} />
            ) : (
              <Button label={name === 'Room' && !watchedRoomId ? 'Skip for now' : 'Next'} icon={ArrowRight} onPress={next} />
            )}
          </View>
        </View>
      }
    >
      <Header title="Add Tenant" subtitle={current?.name} onBack={back} />
      <StepIndicator steps={STEPS} current={step} />
      <FormProvider {...form}>
        <View className="gap-4 pt-3">
          {name === 'Personal' ? (
            <>
              <TextField control={control} name="fullName" label="Full Name" placeholder="e.g. Rahul Sharma" autoCapitalize="words" />
              <Controller control={control} name="joiningDate" render={({ field, fieldState }) => (
                <DateField label="Joining Date" value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
              )} />
              <TextField control={control} name="occupation" label="Occupation (optional)" placeholder="e.g. Software engineer" />
              <TextField control={control} name="notes" label="Notes (optional)" multiline placeholder="Anything worth remembering" />
            </>
          ) : null}

          {name === 'Contact' ? (
            <>
              <TextField control={control} name="phone" label="Phone" placeholder="98765 43210" keyboardType="phone-pad" />
              <TextField control={control} name="alternatePhone" label="Alternate Phone (optional)" keyboardType="phone-pad" />
              <TextField control={control} name="email" label="Email (optional)" placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" />
              <TextField control={control} name="permanentAddress" label="Permanent Address (optional)" multiline />
              <TextField control={control} name="currentAddress" label="Current Address (optional)" multiline />
              <TextField control={control} name="emergencyContact" label="Emergency Contact (optional)" placeholder="Name" />
              <TextField control={control} name="emergencyPhone" label="Emergency Phone (optional)" keyboardType="phone-pad" />
            </>
          ) : null}

          {name === 'Documents' ? (
            <>
              <Text tone="soft">Capture or upload documents now, or add them later from the tenant profile. Files are stored privately and encrypted in transit.</Text>
              {DOC_STEP_TYPES.map((t) => (
                <DocumentSlot key={t} type={t} value={docs[t]} onChange={(d) => setDocs((cur) => { const next = { ...cur }; if (d) next[t] = d; else delete next[t]; return next; })} />
              ))}
            </>
          ) : null}

          {name === 'Room' ? (
            <>
              <Text tone="soft">Choose a vacant room for this tenant, or skip and assign one later.</Text>
              <RoomPicker />
            </>
          ) : null}

          {name === 'Rent & Deposit' ? <RentFields /> : null}

          {isReview ? (
            <>
              <ReviewCard title="Personal" onEdit={() => setStep(0)}>
                <DetailRow label="Name" value={v.fullName} />
                <DetailRow label="Joining date" value={formatDate(v.joiningDate)} />
                <DetailRow label="Occupation" value={v.occupation || '-'} last />
              </ReviewCard>
              <ReviewCard title="Contact" onEdit={() => setStep(1)}>
                <DetailRow label="Phone" value={v.phone} />
                <DetailRow label="Email" value={v.email || '-'} />
                <DetailRow label="Emergency" value={v.emergencyContact ? `${v.emergencyContact}${v.emergencyPhone ? ` (${v.emergencyPhone})` : ''}` : '-'} last />
              </ReviewCard>
              <ReviewCard title="Documents" onEdit={() => setStep(2)}>
                {DOC_STEP_TYPES.map((t, i) => <DetailRow key={t} label={t === 'AADHAAR' ? 'Aadhaar' : t === 'PAN' ? 'PAN' : 'Agreement'} value={docs[t] ? 'Ready to upload' : 'Not added'} last={i === DOC_STEP_TYPES.length - 1} />)}
              </ReviewCard>
              <ReviewCard title="Room & Rent" onEdit={() => setStep(3)}>
                {v.roomId ? (
                  <>
                    <DetailRow label="Move-in" value={formatDate(v.startDate || v.joiningDate)} />
                    <DetailRow label="Monthly rent" value={formatINR(toNumber(v.agreedRent || '0'))} />
                    <DetailRow label="Agreed deposit" value={formatINR(toNumber(v.securityDeposit || '0'))} />
                    {toNumber(v.depositReceived || '0') > 0 ? <DetailRow label="Deposit received" value={`${formatINR(toNumber(v.depositReceived))} on ${formatDate(v.depositReceivedOn || today())}`} /> : null}
                    {v.agreementStartDate || v.agreementEndDate ? <DetailRow label="Agreement" value={`${v.agreementStartDate ? formatDate(v.agreementStartDate) : '...'} to ${v.agreementEndDate ? formatDate(v.agreementEndDate) : '...'}`} /> : null}
                    {toNumber(v.openingBalance || '0') > 0 ? <DetailRow label="Outstanding from before" value={formatINR(toNumber(v.openingBalance))} /> : null}
                    <DetailRow label="Electricity" value={v.electricityMode === 'METER' ? `Meter, ${formatINR(toNumber(v.ratePerUnit || '0'))} / unit` : v.electricityMode === 'FIXED' ? `Fixed ${formatINR(toNumber(v.fixedElectricity || '0'))}` : 'Not charged'} last />
                  </>
                ) : (
                  <DetailRow label="Room" value="Not assigned yet" last />
                )}
              </ReviewCard>
              {error ? <Text tone="danger" variant="secondary">{error}</Text> : null}
            </>
          ) : null}
        </View>
      </FormProvider>
      <UploadQueue
        visible={queueOpen}
        items={queue}
        onRetry={() => createdId && runUploads(createdId, queue.filter((i) => i.status === 'failed').map((i) => i.type)).then((ok) => { if (ok) { setQueueOpen(false); goToProfile(createdId); } })}
        onContinue={() => { setQueueOpen(false); if (createdId) goToProfile(createdId); }}
      />
    </Screen>
  );
}

function ReviewCard({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <Card>
      <View className="mb-1 flex-row items-center justify-between">
        <Text variant="label" tone="muted">{title.toUpperCase()}</Text>
        <Pressable onPress={onEdit} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Edit ${title}`} className="flex-row items-center gap-1">
          <Icon icon={Pencil} size="sm" tone="primary" />
          <Text variant="secondaryMedium" tone="primary">Edit</Text>
        </Pressable>
      </View>
      {children}
    </Card>
  );
}
