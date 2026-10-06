import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { friendlyError } from '@/api/client';
import { Button, Card, DateInput, DetailRow, Icon, Input, Notice, Textarea } from '@/components/ui';
import { Page } from '@/components/layout/Page';
import { uploadTenantDocument } from '@/features/documents/api';
import { DOC_ORDER } from '@/features/documents/constants';
import { DocumentSlot } from '@/features/documents/DocumentSlot';
import type { PreparedFile } from '@/features/documents/prepareFile';
import { UploadQueue, type QueueItem } from '@/features/documents/UploadQueue';
import { useProperty } from '@/features/properties/PropertyProvider';
import { useCreateTenant } from '@/features/tenants/api';
import { RentFields, RoomPicker } from '@/features/tenants/AssignmentFields';
import { assignmentFieldErrors, assignmentPayload, emptyTenantForm, STEP_FIELDS, tenantFormSchema, tenantPayload, type TenantForm } from '@/features/tenants/schemas';
import { cn } from '@/utils/cn';
import { formatDate, formatINR, today } from '@/utils/format';
import { toNumber } from '@/utils/validation';
import type { DocumentType } from '@rental/shared';

const STEPS = ['Personal', 'Contact', 'Documents', 'Room', 'Rent & Deposit', 'Review'];
const DOC_STEP_TYPES = DOC_ORDER.filter((t) => t !== 'OTHER');

function Steps({ current }: { current: number }) {
  return (
    <ol className="mb-4 flex items-center gap-1.5" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col gap-1" aria-current={i === current ? 'step' : undefined}>
          <span className={cn('h-1.5 rounded-full', i <= current ? 'bg-primary' : 'bg-line')} />
          <span className={cn('hidden text-caption sm:block', i === current ? 'font-semibold text-primary' : 'text-ink-muted')}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function ReviewCard({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-caption font-semibold text-ink-muted">{title.toUpperCase()}</span>
        <button type="button" onClick={onEdit} aria-label={`Edit ${title}`} className="flex items-center gap-1 text-small font-medium text-primary"><Icon icon={Pencil} size={16} tone="primary" />Edit</button>
      </div>
      {children}
    </Card>
  );
}

export function AddTenantPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { current } = useProperty();
  const create = useCreateTenant();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<Partial<Record<DocumentType, PreparedFile>>>({});
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const form = useForm<TenantForm>({ resolver: zodResolver(tenantFormSchema), defaultValues: { ...emptyTenantForm, joiningDate: today(), startDate: today(), depositReceivedOn: today(), roomId: params.get('roomId') ?? '' }, mode: 'onTouched' });
  const { control, trigger, getValues, handleSubmit, setError: setFieldError, register, formState: { errors } } = form;
  const watchedRoomId = useWatch({ control, name: 'roomId' });
  const name = STEPS[step];
  const hasRoom = () => !!getValues('roomId');

  const next = async () => {
    if (!(await trigger(STEP_FIELDS[name]))) return;
    if (name === 'Rent & Deposit' && !getValues('agreedRent')) return setFieldError('agreedRent', { message: 'Enter the monthly rent' });
    if (name === 'Rent & Deposit') {
      const problems = assignmentFieldErrors(getValues());
      problems.forEach((p) => setFieldError(p.field, { message: p.message }));
      if (problems.length) return;
    }
    setStep((s) => (name === 'Room' && !hasRoom() ? s + 2 : s + 1));
    window.scrollTo({ top: 0 });
  };
  const back = () => (step === 0 ? navigate(-1) : setStep((s) => (name === 'Review' && !hasRoom() ? s - 2 : s - 1)));
  const goToProfile = (id: string) => navigate(`/tenants/${id}`, { replace: true });

  const runUploads = async (tenantId: string, only?: DocumentType[]) => {
    const types = (only ?? DOC_STEP_TYPES).filter((t) => docs[t]);
    setQueue((q) => DOC_STEP_TYPES.filter((t) => docs[t]).map((t) => q.find((i) => i.type === t && i.status === 'done') ?? { type: t, status: 'pending', progress: 0 }));
    setQueueOpen(true);
    let ok = true;
    for (const type of types) {
      const patch = (p: Partial<QueueItem>) => setQueue((q) => q.map((i) => (i.type === type ? { ...i, ...p } : i)));
      const f = docs[type]!;
      patch({ status: 'uploading', progress: 0, error: undefined });
      try {
        await uploadTenantDocument(tenantId, f.blob, f.name, type, (p) => patch({ progress: p }));
        patch({ status: 'done', progress: 1 });
      } catch (e) { ok = false; patch({ status: 'failed', error: friendlyError(e) }); }
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
      if (await runUploads(id)) { setQueueOpen(false); goToProfile(id); }
    } catch (e) { setError(friendlyError(e)); }
  });

  const v = getValues();
  const isReview = name === 'Review';

  return (
    <Page title="Add Tenant" subtitle={`${current?.name ?? ''} · Step ${step + 1} of ${STEPS.length}: ${name}`} back="/tenants">
      <Steps current={step} />
      <FormProvider {...form}>
        <form onSubmit={(e) => { e.preventDefault(); if (isReview) void submit(); else void next(); }} className="space-y-4" noValidate>
          {name === 'Personal' ? (
            <>
              <Input label="Full Name" placeholder="e.g. Rahul Sharma" autoComplete="off" error={errors.fullName?.message} {...register('fullName')} />
              <DateInput label="Joining Date" error={errors.joiningDate?.message} {...register('joiningDate')} />
              <Input label="Occupation (optional)" placeholder="e.g. Software engineer" {...register('occupation')} />
              <Textarea label="Notes (optional)" placeholder="Anything worth remembering" {...register('notes')} />
            </>
          ) : null}
          {name === 'Contact' ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Phone" type="tel" placeholder="98765 43210" error={errors.phone?.message} {...register('phone')} />
                <Input label="Alternate Phone (optional)" type="tel" error={errors.alternatePhone?.message} {...register('alternatePhone')} />
              </div>
              <Input label="Email (optional)" type="email" placeholder="name@example.com" autoCapitalize="none" error={errors.email?.message} {...register('email')} />
              <Textarea label="Permanent Address (optional)" {...register('permanentAddress')} />
              <Textarea label="Current Address (optional)" {...register('currentAddress')} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Emergency Contact (optional)" placeholder="Name" {...register('emergencyContact')} />
                <Input label="Emergency Phone (optional)" type="tel" error={errors.emergencyPhone?.message} {...register('emergencyPhone')} />
              </div>
            </>
          ) : null}
          {name === 'Documents' ? (
            <>
              <p className="text-ink-soft">Take a photo or upload documents now, or add them later from the tenant profile. Files are stored privately and encrypted in transit.</p>
              <div className="grid gap-4 md:grid-cols-2">
                {DOC_STEP_TYPES.map((t) => <DocumentSlot key={t} type={t} value={docs[t]} onChange={(d) => setDocs((cur) => { const n = { ...cur }; if (d) n[t] = d; else delete n[t]; return n; })} />)}
              </div>
            </>
          ) : null}
          {name === 'Room' ? (<><p className="text-ink-soft">Choose a vacant room for this tenant, or skip and assign one later.</p><RoomPicker /></>) : null}
          {name === 'Rent & Deposit' ? <RentFields /> : null}
          {isReview ? (
            <>
              <ReviewCard title="Personal" onEdit={() => setStep(0)}>
                <DetailRow label="Name" value={v.fullName} /><DetailRow label="Joining date" value={formatDate(v.joiningDate)} /><DetailRow label="Occupation" value={v.occupation || '-'} last />
              </ReviewCard>
              <ReviewCard title="Contact" onEdit={() => setStep(1)}>
                <DetailRow label="Phone" value={v.phone} /><DetailRow label="Email" value={v.email || '-'} />
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
                ) : <DetailRow label="Room" value="Not assigned yet" last />}
              </ReviewCard>
              {error ? <Notice tone="danger">{error}</Notice> : null}
            </>
          ) : null}
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" full={false} className="w-14 shrink-0" icon={ArrowLeft} onClick={back} aria-label="Back" />
            {isReview ? <Button type="submit" icon={Check} loading={create.isPending}>Save Tenant</Button>
              : <Button type="submit" icon={ArrowRight}>{name === 'Room' && !watchedRoomId ? 'Skip for now' : 'Next'}</Button>}
          </div>
        </form>
      </FormProvider>
      <UploadQueue open={queueOpen} items={queue}
        onRetry={() => createdId && void runUploads(createdId, queue.filter((i) => i.status === 'failed').map((i) => i.type)).then((ok) => { if (ok) { setQueueOpen(false); goToProfile(createdId); } })}
        onContinue={() => { setQueueOpen(false); if (createdId) goToProfile(createdId); }} />
    </Page>
  );
}
