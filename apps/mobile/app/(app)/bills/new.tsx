import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Plus, Receipt, X, Zap } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, ApiError, friendlyError } from '@/api/client';
import { Button, Card, DateField, DetailRow, EmptyState, ErrorState, Header, Icon, Input, MonthStepper, Screen, Select, SectionHeader, Skeleton, Text } from '@/components/ui';
import { BillRequest, useBill, useBillPreview, useCreateBill, useReviseBill } from '@/features/bills/api';
import { useChangeElectricity } from '@/features/tenants/api';
import { ChargeRow, ChargeSheet } from '@/features/bills/ChargeSheet';
import { useProperty } from '@/features/properties/PropertyProvider';
import { useDebounced } from '@/hooks/useDebounced';
import { CHARGE_LABELS, isMonthlyCharge, MONTHLY_CHARGE_TYPES, type BillDetail, type BillPreview, type ChargeType, type MonthlyChargeType, type Paginated, type TenantListItem } from '@/types/api';
import { formatDate, formatINR, formatYM, toYM } from '@/utils/format';

/** One editable line per monthly category; blank or 0 leaves it off this bill. */
interface MonthlyRow { amount: string; name?: string; note: string }
const emptyMonthly = (): Record<MonthlyChargeType, MonthlyRow> => ({ WATER: { amount: '', note: '' }, CLEANING: { amount: '', note: '' }, MNGL_GAS: { amount: '', note: '' }, INTERNET: { amount: '', note: '' } });

/** Signed amount for the previous balance adjustment: 500 or -500 (at most 2 decimals). */
const signedNum = (s: string) => (/^-?\d+(\.\d{1,2})?$/.test(s.trim()) && Number(s) !== 0 ? Number(s) : undefined);

const num = (s: string) => (s.trim() !== '' && /^\d+(\.\d{1,2})?$/.test(s.trim()) ? Number(s) : undefined);

/** /bills/new, or /bills/new?edit=<billId> to edit a bill (saving replaces it with a corrected bill for the same month). */
export default function GenerateBillScreen() {
  const params = useLocalSearchParams<{ tenantId?: string; edit?: string }>();
  const editing = useBill(params.edit);
  if (!params.edit) return <GenerateBillForm />;
  if (editing.isLoading) return <Screen><Header title="Edit Bill" /><Skeleton height={120} radius={16} /></Screen>;
  if (editing.isError || !editing.data) return <Screen><Header title="Edit Bill" /><ErrorState error={editing.error} onRetry={editing.refetch} /></Screen>;
  const bill = editing.data;
  const blocked = bill.status === 'CANCELLED' ? 'This bill is cancelled.'
      : bill.carriedInto ? `This bill's balance is already part of ${bill.carriedInto.billNumber}. Edit that bill instead.` : null;
  if (blocked) return <Screen><Header title="Edit Bill" subtitle={bill.billNumber} /><View className="rounded-md bg-warning-soft p-3"><Text variant="secondary" tone="warning">{blocked}</Text></View></Screen>;
  return <GenerateBillForm key={bill.id} editing={bill} />;
}

/** The Generate Bill form filled from an existing bill, for editing it. `preview` is the server's preview of the edit. */
function billToForm(bill: BillDetail, preview: BillPreview) {
  const el = bill.items.find((i) => i.type === 'ELECTRICITY');
  const rentItem = bill.items.find((i) => i.type === 'RENT');
  const adjustmentItem = bill.items.find((i) => i.type === 'PREVIOUS_BALANCE' && i.meta?.adjustment);
  const m = (el?.meta ?? {}) as Record<string, unknown>;
  const metered = typeof m.currentReading === 'number';
  const monthly = emptyMonthly();
  const charges: ChargeRow[] = [];
  for (const i of bill.items.filter((x) => x.type === 'CHARGE')) {
    const type = (typeof i.meta?.chargeType === 'string' ? i.meta.chargeType : 'OTHER') as ChargeType;
    if (isMonthlyCharge(type) && !monthly[type].amount) monthly[type] = { amount: String(i.amount), name: i.description, note: typeof i.meta?.note === 'string' ? i.meta.note : '' };
    else charges.push({ type, name: i.description, amount: String(i.amount) });
  }
  const rate = metered && typeof m.ratePerUnit === 'number' && m.ratePerUnit !== preview.electricity.defaultRatePerUnit ? String(m.ratePerUnit) : '';
  const prev = metered && typeof m.previousReading === 'number' && m.previousReading !== preview.electricity.previousReading ? String(m.previousReading) : '';
  // An amount typed by hand (faulty meter, imported record, changed fixed amount) stays a manual amount.
  const manual = !!el && m.isOverride === true && (!metered || m.calculatedAmount !== el.amount);
  return {
    reading: metered ? String(m.currentReading) : '', prevReading: prev, rate, manual, manualAmount: manual && el ? String(el.amount) : '',
    monthly, charges, lateFee: bill.lateFee > 0 ? String(bill.lateFee) : '', discount: bill.discount > 0 ? String(bill.discount) : '', dueDate: bill.dueDate.slice(0, 10),
    rent: rentItem && typeof rentItem.meta?.standardRent === 'number' ? String(rentItem.amount) : null,
    adjustment: adjustmentItem ? String(adjustmentItem.amount) : '', adjustmentNote: adjustmentItem && typeof adjustmentItem.meta?.note === 'string' ? adjustmentItem.meta.note : '',
  };
}

function GenerateBillForm({ editing }: { editing?: BillDetail }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ tenantId?: string }>();
  const fixedTenant = editing?.tenant.id ?? params.tenantId;
  const { current } = useProperty();
  const [tenantId, setTenantId] = useState<string | undefined>(fixedTenant);
  const [period, setPeriod] = useState<string | undefined>();
  const [reading, setReading] = useState('');
  const [prevReading, setPrevReading] = useState('');
  const [rate, setRate] = useState('');
  const [manual, setManual] = useState(false);
  const [manualAmount, setManualAmount] = useState('');
  const [monthly, setMonthly] = useState(emptyMonthly);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [lateFee, setLateFee] = useState('');
  const [discount, setDiscount] = useState('');
  /** null: the tenant's usual rent. A value: the rent for this bill. */
  const [rentText, setRentText] = useState<string | null>(null);
  const [rentFromNow, setRentFromNow] = useState(false);
  const [adjustment, setAdjustment] = useState('');
  const [adjustmentNote, setAdjustmentNote] = useState('');
  const [dueDate, setDueDate] = useState<string | undefined>();
  const [chargeSheet, setChargeSheet] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const create = useCreateBill();
  const revise = useReviseBill(editing?.id ?? '');
  const saving = editing ? revise.isPending : create.isPending;

  const tenantsQuery = useQuery({
    queryKey: ['tenants', 'billable', current?.id],
    enabled: !fixedTenant && !!current,
    queryFn: () => api.get<Paginated<TenantListItem>>(`/tenants?propertyId=${current!.id}&status=ACTIVE&pageSize=100`),
  });

  const request: BillRequest | null = useMemo(() => {
    if (!tenantId) return null;
    return {
      tenantId,
      billingPeriod: period,
      dueDate,
      ...(editing ? { replacingBillId: editing.id } : {}),
      electricity: {
        ...(manual ? { currentReading: num(reading), overrideAmount: num(manualAmount) ?? 0 } : { currentReading: num(reading) }),
        ...(prevReading.trim() !== '' && num(prevReading) !== undefined ? { previousReading: num(prevReading) } : {}),
        ...(rate.trim() !== '' && num(rate) !== undefined ? { ratePerUnit: num(rate) } : {}),
      },
      charges: [
        ...MONTHLY_CHARGE_TYPES.filter((t) => num(monthly[t].amount)).map((t) => ({ type: t, name: monthly[t].name, amount: Number(monthly[t].amount), note: monthly[t].note.trim() || undefined })),
        ...charges.filter((c) => num(c.amount)).map((c) => ({ type: c.type, name: c.name, amount: Number(c.amount) })),
      ],
      lateFee: num(lateFee),
      discount: num(discount),
      ...(rentText !== null && num(rentText) !== undefined ? { rent: num(rentText), applyRentFromThisMonth: rentFromNow } : {}),
      // Sent only with its reason; until then the reason box asks for one.
      ...(signedNum(adjustment) && adjustmentNote.trim() ? { previousBalanceAdjustment: signedNum(adjustment), previousBalanceNote: adjustmentNote.trim() } : {}),
    };
  }, [tenantId, period, dueDate, editing, rentText, rentFromNow, adjustment, adjustmentNote, manual, reading, prevReading, rate, manualAmount, monthly, charges, lateFee, discount]);

  const debounced = useDebounced(request, 400);
  const preview = useBillPreview(debounced);
  // The last good preview stays on screen while a change is being corrected (an error must not hide the form).
  const [lastGood, setLastGood] = useState<BillPreview | undefined>();
  if (preview.data && preview.data !== lastGood) setLastGood(preview.data);
  const data = preview.data ?? lastGood;
  const saveRate = useChangeElectricity(data?.assignmentId ?? '');
  const settling = request !== debounced || preview.isFetching;

  // First response seeds the month and any recurring charges (adjusting state while rendering, not in an effect).
  if (data && !seeded) {
    setSeeded(true);
    setPeriod(toYM(data.billingPeriod));
    if (editing) {
      // Editing: start from what the bill says.
      const f = billToForm(editing, data);
      setReading(f.reading); setPrevReading(f.prevReading); setRate(f.rate); setManual(f.manual); setManualAmount(f.manualAmount);
      setMonthly(f.monthly); setCharges(f.charges); setLateFee(f.lateFee); setDiscount(f.discount); setDueDate(f.dueDate);
      setRentText(f.rent); setAdjustment(f.adjustment); setAdjustmentNote(f.adjustmentNote);
    } else {
      // Recurring Water / Housekeeping / MNGL / WiFi fill their own row (first one of each); anything else is an other charge.
      const seed = emptyMonthly();
      const others: ChargeRow[] = [];
      for (const c of data.recurringCharges) {
        if (isMonthlyCharge(c.type) && !seed[c.type].amount) seed[c.type] = { amount: String(c.amount), name: c.name, note: '' };
        else others.push({ type: c.type, name: c.name, amount: String(c.amount) });
      }
      setMonthly(seed);
      setCharges(others);
    }
  }

  const el = data?.electricity;
  const previewError = preview.error ? (preview.error instanceof ApiError ? preview.error.message : friendlyError(preview.error)) : null;
  const needsReading = el?.mode === 'METER' && !manual && (el?.needsReading ?? true);
  const canGenerate = !!data && !previewError && !settling && !needsReading && !saving;

  const generate = async () => {
    if (!request) return;
    setSubmitError(null);
    try {
      if (editing) {
        const { replacingBillId: _skip, ...body } = request;
        void _skip;
        const bill = await revise.mutateAsync(body);
        router.replace({ pathname: '/bills/[id]', params: { id: bill.id, edited: '1' } });
        return;
      }
      const bill = await create.mutateAsync({ ...request, billingPeriod: period });
      router.replace({ pathname: '/bills/[id]', params: { id: bill.id, created: '1' } });
    } catch (e) {
      setSubmitError(friendlyError(e));
    }
  };

  const tenantOptions = (tenantsQuery.data?.items ?? []).filter((t) => t.assignmentId).map((t) => ({ value: t.id, label: t.fullName, hint: `Room ${t.room?.roomNumber}` }));

  return (
    <Screen
      edges={['top', 'bottom']}
      bottomInset={32}
      footer={
        <View className="gap-2 border-t border-line bg-surface px-4 pb-4 pt-3">
          {data ? (
            <View className="flex-row items-end justify-between">
              <Text tone="soft">Total due</Text>
              <Text variant="title">{formatINR(data.totals.totalDue)}</Text>
            </View>
          ) : null}
          {submitError ? <Text tone="danger" variant="secondary">{submitError}</Text> : null}
          <Button label={editing ? (saving ? 'Saving changes...' : 'Save Changes') : saving ? 'Generating bill...' : 'Generate Bill'} icon={Receipt} onPress={generate} disabled={!canGenerate} loading={saving} />
        </View>
      }
    >
      <Header title={editing ? 'Edit Bill' : 'Generate Bill'} subtitle={editing ? editing.billNumber : current?.name} />

      {!tenantId ? (
        tenantsQuery.isLoading ? <Skeleton height={48} radius={12} /> : tenantOptions.length === 0 ? (
          <EmptyState icon={Receipt} title="No tenants to bill" message="Assign a tenant to a room first, then generate their bill." />
        ) : (
          <Select label="Tenant" placeholder="Choose a tenant" options={tenantOptions} onChange={setTenantId} />
        )
      ) : (
        <View className="gap-4 pt-1">
          <Card className="flex-row items-center justify-between">
            <View>
              <Text variant="heading">{data?.tenant.fullName ?? ' '}</Text>
              <Text variant="secondary" tone="soft">{data ? `Room ${data.room.roomNumber}` : ' '}</Text>
            </View>
            {!fixedTenant ? <Pressable onPress={() => { setTenantId(undefined); setLastGood(undefined); setSeeded(false); setPeriod(undefined); setMonthly(emptyMonthly()); setCharges([]); setReading(''); setPrevReading(''); }} accessibilityRole="button"><Text variant="secondaryMedium" tone="primary">Change</Text></Pressable> : null}
          </Card>

          {editing ? (
            <View className="rounded-md bg-warning-soft p-3"><Text variant="secondary" tone="warning">Editing the {formatYM(toYM(editing.billingPeriod))} bill. Saving creates a corrected bill with a new number and cancels {editing.billNumber}. The month cannot be changed.{editing.paidAmount > 0 ? ` The ${formatINR(editing.paidAmount)} already paid moves to the corrected bill with the same dates.` : ''}</Text></View>
          ) : period ? <MonthStepper label="Billing Month" value={period} onChange={setPeriod} /> : <Skeleton height={48} radius={12} />}

          {previewError ? (
            <View className="rounded-md bg-danger-soft p-3"><Text variant="secondary" tone="danger">{previewError}</Text></View>
          ) : null}

          {data ? (
            <>
              <Card className="gap-2">
                <Input label="Rent for this bill" prefix="₹" keyboardType="decimal-pad" value={rentText ?? String(data.standardRent)} onChangeText={setRentText}
                  hint={rentText !== null && num(rentText) !== data.standardRent ? `Usual rent: ${formatINR(data.standardRent)}` : "The tenant's monthly rent. Change it for this bill if needed."} />
                {rentText !== null && num(rentText) !== undefined && num(rentText) !== data.standardRent ? (
                  <Pressable onPress={() => setRentFromNow((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: rentFromNow }} className="flex-row items-start gap-2">
                    <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${rentFromNow ? 'border-primary bg-primary' : 'border-line-strong'}`}>{rentFromNow ? <Text variant="caption" tone="white">✓</Text> : null}</View>
                    <Text variant="secondary" tone="soft" className="flex-1">Also make {formatINR(num(rentText))} the monthly rent from {formatYM(period ?? toYM(data.billingPeriod))} onward (later bills use it too)</Text>
                  </Pressable>
                ) : null}
              </Card>

              <Card className="gap-3">
                <View className="flex-row items-center justify-between gap-3">
                  <Text variant="heading">Previous due</Text>
                  <Text variant="bodyMedium" tone={data.carriedBalance > 0 ? 'danger' : 'soft'}>{data.carriedBalance > 0 ? formatINR(data.carriedBalance) : 'Nil'}</Text>
                </View>
                <Text variant="secondary" tone="soft">
                  {data.carriedBalance > 0
                    ? `Unpaid from earlier bills${data.carriedBills.length ? ` (${data.carriedBills.map((c) => formatYM(toYM(c.billingPeriod))).join(', ')})` : ''}. It is added to this bill automatically.`
                    : 'Nothing unpaid from earlier bills in the app.'}
                </Text>
                <Input label="Add previous due (if any)" prefix="₹" keyboardType="numbers-and-punctuation" placeholder="0" value={adjustment} onChangeText={setAdjustment}
                  hint="Old dues not in the app, e.g. 2000. Type -500 to reduce." error={adjustment.trim() && signedNum(adjustment) === undefined ? 'Enter an amount like 2000 or -500' : undefined} />
                {signedNum(adjustment) ? <Input label="Reason" placeholder="e.g. Old dues from the register" maxLength={100} error={adjustmentNote.trim() ? undefined : 'Enter a reason to add this amount'} value={adjustmentNote} onChangeText={setAdjustmentNote} /> : null}
              </Card>

              {el && el.mode !== 'NONE' ? (
                <Card className="gap-3">
                  <View className="flex-row items-center gap-2"><Icon icon={Zap} tone="primary" /><Text variant="heading">Electricity</Text></View>
                  {el.mode === 'METER' ? (
                    <>
                      <View className="flex-row gap-3">
                        <View className="flex-1"><Input label="Previous" keyboardType="decimal-pad" value={prevReading !== '' ? prevReading : String(el.previousReading ?? 0)} onChangeText={setPrevReading} /></View>
                        <View className="flex-1"><Input label="Current" placeholder="Enter reading" keyboardType="decimal-pad" value={reading} onChangeText={setReading} editable={!manual} /></View>
                      </View>
                      <Input label="Rate per unit" prefix="₹" keyboardType="decimal-pad" value={rate !== '' ? rate : String(el.ratePerUnit ?? '')} onChangeText={setRate} editable={!manual}
                        hint={rate !== '' && num(rate) !== undefined ? 'Used for this bill only.' : "This tenant's rate. Change it for one bill, or save it for all future bills."} />
                      {rate !== '' && num(rate) !== undefined && num(rate) !== data.electricity.defaultRatePerUnit ? (
                        <Pressable onPress={() => saveRate.mutate({ ratePerUnit: num(rate) }, { onSuccess: () => setRate('') })} accessibilityRole="button" disabled={saveRate.isPending}><Text variant="secondaryMedium" tone="primary">Save ₹{rate} as this tenant&apos;s rate for all future bills</Text></Pressable>
                      ) : null}
                      {prevReading === '' && (el.previousReading ?? 0) === 0 ? <Text variant="caption" tone="warning">No earlier meter reading is on record. Type the last reading from the meter in Previous, otherwise the whole meter value is billed.</Text> : null}
                      {prevReading !== '' ? <Text variant="caption" tone="warning">Previous reading changed by you. Use this only if the stored reading is wrong or the meter was replaced.</Text> : null}
                      {!manual && el.currentReading != null ? (
                        <Text tone="soft">{el.units} units × {formatINR(el.ratePerUnit)} = <Text variant="bodyMedium">{formatINR(el.amount)}</Text></Text>
                      ) : null}
                    </>
                  ) : (
                    <Text tone="soft">Fixed monthly amount: {formatINR(el.calculatedAmount)}</Text>
                  )}
                  {manual ? <Input label="Amount" prefix="₹" keyboardType="decimal-pad" placeholder="0" value={manualAmount} onChangeText={setManualAmount} hint="Replaces the calculated amount, for example when the meter is faulty." /> : null}
                  <Pressable onPress={() => setManual((m) => !m)} accessibilityRole="button"><Text variant="secondaryMedium" tone="primary">{manual ? 'Use meter reading instead' : 'Enter amount manually'}</Text></Pressable>
                </Card>
              ) : null}

              <SectionHeader title="Monthly charges" />
              <Card padded={false}>
                {MONTHLY_CHARGE_TYPES.map((t, i) => {
                  const row = monthly[t];
                  const label = row.name ?? CHARGE_LABELS[t];
                  const set = (patch: Partial<MonthlyRow>) => setMonthly((cur) => ({ ...cur, [t]: { ...cur[t], ...patch } }));
                  return (
                    <View key={t} className={`gap-2 px-4 py-2 ${i < MONTHLY_CHARGE_TYPES.length - 1 ? 'border-b border-line' : ''}`}>
                      <View className="flex-row items-center">
                        <Text className="flex-1" variant="bodyMedium">{label}</Text>
                        <View className="w-28"><Input accessibilityLabel={`${label} amount`} prefix="₹" keyboardType="decimal-pad" placeholder="0" value={row.amount} onChangeText={(v) => set({ amount: v })} /></View>
                      </View>
                      {t === 'MNGL_GAS' && num(row.amount) ? <Input accessibilityLabel="MNGL note" placeholder="Units or reading (optional)" maxLength={60} value={row.note} onChangeText={(v) => set({ note: v })} /> : null}
                    </View>
                  );
                })}
              </Card>
              <Text variant="caption" tone="muted">Prefilled from the tenant&apos;s regular charges. Change an amount for this bill only; leave it blank or 0 to leave the line off.</Text>

              <SectionHeader title="Other charges" actionLabel="Add other charge" onAction={() => setChargeSheet(true)} />
              {charges.length === 0 ? (
                <Card className="items-center gap-2 py-5">
                  <Text tone="soft">No other charges</Text>
                  <Button label="Add other charge" icon={Plus} variant="secondary" size="sm" fullWidth={false} onPress={() => setChargeSheet(true)} />
                </Card>
              ) : (
                <Card padded={false}>
                  {charges.map((c, i) => (
                    <View key={`${c.name}-${i}`} className={`flex-row items-center px-4 py-2 ${i < charges.length - 1 ? 'border-b border-line' : ''}`}>
                      <Text className="flex-1" variant="bodyMedium">{c.name}</Text>
                      <View className="w-28"><Input prefix="₹" keyboardType="decimal-pad" value={c.amount} onChangeText={(v) => setCharges((cur) => cur.map((x, j) => (j === i ? { ...x, amount: v } : x)))} /></View>
                      <Pressable onPress={() => setCharges((cur) => cur.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`Remove ${c.name}`} hitSlop={8} className="ml-1 h-10 w-10 items-center justify-center"><Icon icon={X} tone="muted" /></Pressable>
                    </View>
                  ))}
                </Card>
              )}

              <SectionHeader title="Adjustments" />
              <View className="flex-row gap-3">
                <View className="flex-1"><Input label="Late fee" prefix="₹" keyboardType="decimal-pad" placeholder="0" value={lateFee} onChangeText={setLateFee} /></View>
                <View className="flex-1"><Input label="Discount" prefix="₹" keyboardType="decimal-pad" placeholder="0" value={discount} onChangeText={setDiscount} /></View>
              </View>
              <DateField label="Due Date" value={dueDate ?? data.dueDate.slice(0, 10)} onChange={setDueDate}
                minimumDate={(() => { const [y, m] = (period ?? toYM(data.billingPeriod)).split('-').map(Number); return new Date(y, m, 1); })()} />

              <SectionHeader title="Summary" />
              <Card>
                <DetailRow label={data.rent !== data.standardRent ? 'Rent (set for this bill)' : 'Rent'} value={formatINR(data.totals.rent)} />
                {data.totals.electricity > 0 ? <DetailRow label="Electricity" value={formatINR(data.totals.electricity)} /> : null}
                {data.charges.map((c, i) => <DetailRow key={i} label={c.name} value={formatINR(c.amount)} />)}
                {data.totals.lateFee > 0 ? <DetailRow label="Late fee" value={formatINR(data.totals.lateFee)} /> : null}
                {data.totals.discount > 0 ? <DetailRow label="Discount" value={`-${formatINR(data.totals.discount)}`} tone="success" /> : null}
                {data.carriedBalance > 0 ? <DetailRow label={`${data.openingBalance > 0 && data.carriedBills.length === 0 ? 'Outstanding (from before)' : 'Previous balance'}${data.carriedBills.length ? ` (not paid: ${data.carriedBills.map((c) => formatYM(toYM(c.billingPeriod))).join(', ')})` : ''}`} value={formatINR(data.carriedBalance)} tone="danger" /> : null}
                {data.previousBalanceAdjustment !== 0 ? <DetailRow label="Previous balance adjustment" value={data.previousBalanceAdjustment < 0 ? `-${formatINR(-data.previousBalanceAdjustment)}` : formatINR(data.previousBalanceAdjustment)} tone={data.previousBalanceAdjustment < 0 ? 'success' : 'danger'} /> : null}
                <DetailRow label="Total" value={formatINR(data.totals.totalDue)} strong last />
              </Card>
              <Text variant="caption" tone="muted" className="text-center">Totals are calculated and verified by the server for {formatYM(period ?? toYM(data.billingPeriod))}. Due {formatDate(dueDate ?? data.dueDate)}.</Text>
            </>
          ) : preview.isLoading ? (
            <View className="gap-3"><Skeleton height={64} radius={16} /><Skeleton height={120} radius={16} /></View>
          ) : null}
        </View>
      )}
      <ChargeSheet visible={chargeSheet} onClose={() => setChargeSheet(false)}
        onAdd={(row) => (isMonthlyCharge(row.type) ? setMonthly((cur) => ({ ...cur, [row.type]: { ...cur[row.type as MonthlyChargeType], amount: row.amount, name: row.name } })) : setCharges((cur) => [...cur, row]))} />
    </Screen>
  );
}
