import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Banknote, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { api, friendlyError } from '@/api/client';
import { Button, Card, DateInput, DetailRow, EmptyState, ErrorState, Field, Icon, Input, MoneyInput, Notice, Select, Skeleton, SkeletonList, Textarea } from '@/components/ui';
import { Page } from '@/components/layout/Page';
import { useBill } from '@/features/bills/api';
import { useOpenBill, useRecordPayment } from '@/features/payments/api';
import { METHODS } from '@/features/payments/constants';
import { useProperty } from '@/features/properties/PropertyProvider';
import { cn } from '@/utils/cn';
import { formatINR, formatMonth, today } from '@/utils/format';
import { moneyString, orUndefined, toNumber } from '@/utils/validation';
import type { Paginated, PaymentMethod, TenantListItem } from '@rental/shared';

const schema = z.object({
  amount: moneyString('Amount'),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Select the date the payment was received').refine((v) => v <= today(), 'Payment received date cannot be in the future'),
  method: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'OTHER']),
  reference: z.string().trim().max(100),
  notes: z.string().trim().max(500),
});
type Form = z.infer<typeof schema>;
interface BillSummary { label: string; billNumber: string; totalDue: number; paidAmount: number; balance: number; tenantName?: string }

export function RecordPaymentPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const paramBill = params.get('billId') ?? undefined;
  const paramTenant = params.get('tenantId') ?? undefined;
  const { current } = useProperty();
  const [tenantId, setTenantId] = useState<string | undefined>(paramTenant);

  const tenantsQuery = useQuery({
    queryKey: ['tenants', 'payable', current?.id],
    enabled: !paramBill && !paramTenant && !!current,
    queryFn: () => api.get<Paginated<TenantListItem>>(`/tenants?propertyId=${current!.id}&pageSize=100`),
  });
  const openBill = useOpenBill(paramBill ? undefined : tenantId);
  const billById = useBill(paramBill);

  const b = billById.data;
  const bill: (BillSummary & { id: string; payable: boolean }) | undefined = paramBill
    ? b && { id: b.id, label: formatMonth(b.billingPeriod), billNumber: b.billNumber, totalDue: b.totalDue, paidAmount: b.paidAmount, balance: b.balance, tenantName: b.tenant.fullName, payable: b.balance > 0 && !b.carriedInto && b.status !== 'CANCELLED' }
    : openBill.data ? { ...openBill.data, payable: true } : undefined;
  const loading = paramBill ? billById.isLoading : !!tenantId && openBill.isLoading;
  const loadError = paramBill ? billById.error : openBill.error;
  const tenantOptions = (tenantsQuery.data?.items ?? []).filter((t) => t.balance > 0).map((t) => ({ value: t.id, label: `${t.fullName} · Room ${t.room?.roomNumber ?? '-'} · ${formatINR(t.balance)} pending` }));

  if (!paramBill && !tenantId) {
    return (
      <Page title="Record Payment" subtitle={current?.name} back>
        {tenantsQuery.isLoading ? <Skeleton className="h-12" /> : tenantOptions.length === 0 ? <EmptyState icon={Banknote} title="Nothing to collect" message="No tenant has an unpaid balance right now." />
          : <Select label="Tenant" placeholder="Choose a tenant with a pending balance" options={tenantOptions} value="" onChange={(e) => e.target.value && setTenantId(e.target.value)} />}
      </Page>
    );
  }
  if (loading) return <Page title="Record Payment" back><SkeletonList count={2} /></Page>;
  if (loadError) return <Page title="Record Payment" back><ErrorState error={loadError} onRetry={() => void (paramBill ? billById.refetch() : openBill.refetch())} /></Page>;
  if (!bill || !bill.payable) return <Page title="Record Payment" back><EmptyState icon={CircleCheck} title="All paid up" message="There is no unpaid bill to record a payment against." action={<Button full={false} className="px-6" onClick={() => navigate(-1)}>Done</Button>} /></Page>;
  return <PaymentForm key={bill.id} billId={bill.id} bill={bill} />;
}

function PaymentForm({ billId, bill }: { billId: string; bill: BillSummary }) {
  const navigate = useNavigate();
  const record = useRecordPayment(billId);
  const [error, setError] = useState<string | null>(null);
  const { register, control, handleSubmit, setValue, setError: setFieldError, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { amount: String(bill.balance), paymentDate: today(), method: 'UPI', reference: '', notes: '' },
  });
  const amountText = useWatch({ control, name: 'amount' });
  const method = useWatch({ control, name: 'method' });
  const amount = /^\d+(\.\d{1,2})?$/.test(amountText) ? Number(amountText) : 0;
  const remaining = Math.round((bill.balance - amount) * 100) / 100;

  const submit = handleSubmit(async (v) => {
    setError(null);
    const value = toNumber(v.amount);
    if (value <= 0) return setFieldError('amount', { message: 'Amount must be more than zero' });
    if (value > bill.balance) return setFieldError('amount', { message: `Amount is more than the balance (${formatINR(bill.balance)})` });
    try {
      await record.mutateAsync({ amount: value, paymentDate: v.paymentDate, method: v.method as PaymentMethod, reference: orUndefined(v.reference), notes: orUndefined(v.notes) });
      navigate(`/bills/${billId}?paid=1`, { replace: true });
    } catch (e) { setError(friendlyError(e)); }
  });

  return (
    <Page title="Record Payment" subtitle={bill.tenantName ? `${bill.tenantName} · ${bill.label}` : bill.label} back>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Card>
          <DetailRow label={`Bill ${bill.billNumber}`} value={formatINR(bill.totalDue)} />
          <DetailRow label="Paid so far" value={formatINR(bill.paidAmount)} tone="success" />
          <DetailRow label="Balance" value={formatINR(bill.balance)} tone="danger" strong last />
        </Card>
        <MoneyInput label="Amount" error={errors.amount?.message} {...register('amount')} />
        <div className="-mt-2 flex items-center justify-between">
          <button type="button" onClick={() => setValue('amount', String(bill.balance), { shouldValidate: true })} className="text-small font-medium text-primary">Pay full balance</button>
          <span className={`text-small ${remaining < 0 ? 'text-danger' : 'text-ink-soft'}`}>{remaining < 0 ? 'More than balance' : `Remaining: ${formatINR(remaining)}`}</span>
        </div>
        <DateInput label="Payment Received Date" max={today()} hint="The day the money was received" error={errors.paymentDate?.message} {...register('paymentDate')} />
        <Field label="Payment Method">
          <Controller control={control} name="method" render={({ field }) => (
            <div role="radiogroup" aria-label="Payment method" className="flex flex-wrap gap-2">
              {METHODS.map((m) => (
                <button key={m.value} type="button" role="radio" aria-checked={field.value === m.value} onClick={() => field.onChange(m.value)} className={cn('flex h-11 items-center gap-2 rounded-md border px-3.5 text-small font-medium', field.value === m.value ? 'border-primary bg-primary-soft text-primary' : 'border-line-strong bg-surface text-ink-soft hover:bg-surface-muted')}>
                  <Icon icon={m.icon} size={16} tone={field.value === m.value ? 'primary' : 'soft'} />{m.label}
                </button>
              ))}
            </div>
          )} />
        </Field>
        <Input label="Reference Number (optional)" placeholder={method === 'UPI' ? 'UPI transaction ID' : method === 'BANK_TRANSFER' ? 'Transaction / UTR number' : 'Cheque or receipt number'} {...register('reference')} />
        <Textarea label="Notes (optional)" {...register('notes')} />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button type="submit" icon={Banknote} loading={record.isPending}>{amount > 0 ? `Record ${formatINR(amount)}` : 'Record Payment'}</Button>
      </form>
    </Page>
  );
}
