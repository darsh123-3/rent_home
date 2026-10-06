import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Banknote, CircleCheck } from 'lucide-react-native';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Pressable, View } from 'react-native';
import { z } from 'zod';
import { api, friendlyError } from '@/api/client';
import { Button, Card, DateField, DetailRow, EmptyState, ErrorState, Header, Icon, MoneyField, Screen, Select, Skeleton, SkeletonList, Text, TextField } from '@/components/ui';
import { useBill } from '@/features/bills/api';
import { METHODS } from '@/features/payments/constants';
import { useOpenBill, useRecordPayment } from '@/features/payments/api';
import { useProperty } from '@/features/properties/PropertyProvider';
import { cn } from '@/utils/cn';
import { formatINR, formatMonth, today } from '@/utils/format';
import { moneyString, orUndefined, toNumber } from '@/utils/validation';
import type { Paginated, PaymentMethod, TenantListItem } from '@/types/api';

const schema = z.object({
  amount: moneyString('Amount'),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Select the date the payment was received').refine((v) => v <= today(), 'Payment received date cannot be in the future'),
  method: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'OTHER']),
  reference: z.string().trim().max(100),
  notes: z.string().trim().max(500),
});

export default function RecordPaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ billId?: string; tenantId?: string }>();
  const { current } = useProperty();
  const [tenantId, setTenantId] = useState<string | undefined>(params.tenantId);

  const tenantsQuery = useQuery({
    queryKey: ['tenants', 'payable', current?.id],
    enabled: !params.billId && !params.tenantId && !!current,
    queryFn: () => api.get<Paginated<TenantListItem>>(`/tenants?propertyId=${current!.id}&pageSize=100`),
  });
  const openBill = useOpenBill(params.billId ? undefined : tenantId);
  const billById = useBill(params.billId);

  const billId = params.billId ?? openBill.data?.id;
  const bill = params.billId ? billById.data && { id: billById.data.id, label: formatMonth(billById.data.billingPeriod), billNumber: billById.data.billNumber, totalDue: billById.data.totalDue, paidAmount: billById.data.paidAmount, balance: billById.data.balance, tenantName: billById.data.tenant.fullName, payable: billById.data.balance > 0 && !billById.data.carriedInto && billById.data.status !== 'CANCELLED' } : openBill.data ? { ...openBill.data, tenantName: undefined as string | undefined, payable: true } : undefined;

  const loading = params.billId ? billById.isLoading : !!tenantId && openBill.isLoading;
  const loadError = params.billId ? billById.error : openBill.error;

  const tenantOptions = (tenantsQuery.data?.items ?? []).filter((t) => t.balance > 0).map((t) => ({ value: t.id, label: t.fullName, hint: `Room ${t.room?.roomNumber ?? '-'} · ${formatINR(t.balance)} pending` }));

  if (!params.billId && !tenantId) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Header title="Record Payment" subtitle={current?.name} />
        {tenantsQuery.isLoading ? <Skeleton height={48} radius={12} /> : tenantOptions.length === 0 ? (
          <EmptyState icon={Banknote} title="Nothing to collect" message="No tenant has an unpaid balance right now." />
        ) : (
          <Select label="Tenant" placeholder="Choose a tenant with a pending balance" options={tenantOptions} onChange={setTenantId} />
        )}
      </Screen>
    );
  }
  if (loading) return <Screen><Header title="Record Payment" /><SkeletonList count={2} lines={3} /></Screen>;
  if (loadError) return <Screen><Header title="Record Payment" /><ErrorState error={loadError} onRetry={() => (params.billId ? billById.refetch() : openBill.refetch())} /></Screen>;
  if (!bill || !billId || !bill.payable) {
    return (
      <Screen><Header title="Record Payment" />
        <EmptyState icon={CircleCheck} title="All paid up" message="There is no unpaid bill to record a payment against." actionLabel="Done" onAction={() => router.back()} />
      </Screen>
    );
  }
  return <PaymentForm key={billId} billId={billId} bill={bill} />;
}

function PaymentForm({ billId, bill }: { billId: string; bill: { label: string; billNumber: string; totalDue: number; paidAmount: number; balance: number; tenantName?: string } }) {
  const router = useRouter();
  const record = useRecordPayment(billId);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, setValue, setError: setFieldError } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { amount: String(bill.balance), paymentDate: today(), method: 'UPI' as PaymentMethod, reference: '', notes: '' },
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
      await record.mutateAsync({ amount: value, paymentDate: v.paymentDate, method: v.method, reference: orUndefined(v.reference), notes: orUndefined(v.notes) });
      router.replace({ pathname: '/bills/[id]', params: { id: billId, paid: '1' } });
    } catch (e) {
      setError(friendlyError(e));
    }
  });

  return (
    <Screen edges={['top', 'bottom']} footer={<View className="px-4 pb-4 pt-2"><Button label={amount > 0 ? `Record ${formatINR(amount)}` : 'Record Payment'} icon={Banknote} onPress={submit} loading={record.isPending} /></View>}>
      <Header title="Record Payment" subtitle={bill.tenantName ? `${bill.tenantName} · ${bill.label}` : bill.label} />
      <View className="gap-4 pt-1">
        <Card>
          <DetailRow label={`Bill ${bill.billNumber}`} value={formatINR(bill.totalDue)} />
          <DetailRow label="Paid so far" value={formatINR(bill.paidAmount)} tone="success" />
          <DetailRow label="Balance" value={formatINR(bill.balance)} tone="danger" strong last />
        </Card>

        <MoneyField control={control} name="amount" label="Amount" />
        <View className="flex-row items-center justify-between -mt-2">
          <Pressable onPress={() => setValue('amount', String(bill.balance), { shouldValidate: true })} accessibilityRole="button"><Text variant="secondaryMedium" tone="primary">Pay full balance</Text></Pressable>
          <Text variant="secondary" tone={remaining < 0 ? 'danger' : 'soft'}>{remaining < 0 ? 'More than balance' : `Remaining: ${formatINR(remaining)}`}</Text>
        </View>

        <Controller control={control} name="paymentDate" render={({ field, fieldState }) => <DateField label="Payment Received Date" value={field.value} onChange={field.onChange} maximumDate={new Date()} error={fieldState.error?.message} />} />

        <View className="gap-1.5">
          <Text variant="label" tone="soft">Payment Method</Text>
          <View className="flex-row flex-wrap gap-2">
            {METHODS.map((m) => (
              <Pressable key={m.value} onPress={() => setValue('method', m.value)} accessibilityRole="radio" accessibilityState={{ selected: method === m.value }} className={cn('h-11 flex-row items-center gap-2 rounded-md border px-3.5', method === m.value ? 'border-primary bg-primary-soft' : 'border-line-strong bg-surface')}>
                <Icon icon={m.icon} size="sm" tone={method === m.value ? 'primary' : 'soft'} />
                <Text variant="secondaryMedium" tone={method === m.value ? 'primary' : 'soft'}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <TextField control={control} name="reference" label="Reference Number (optional)" placeholder={method === 'UPI' ? 'UPI transaction ID' : method === 'BANK_TRANSFER' ? 'Transaction / UTR number' : 'Cheque or receipt number'} />
        <TextField control={control} name="notes" label="Notes (optional)" multiline />
        {error ? <Text tone="danger" variant="secondary">{error}</Text> : null}
      </View>
    </Screen>
  );
}
