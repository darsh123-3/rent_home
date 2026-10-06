import { useQuery } from '@tanstack/react-query';
import { Plus, Receipt, X, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, friendlyError } from '@/api/client';
import { Button, Card, DateInput, DetailRow, EmptyState, Icon, Input, MonthStepper, Notice, SectionHeader, Select, Skeleton } from '@/components/ui';
import { Page } from '@/components/layout/Page';
import { useBillPreview, useCreateBill, type BillRequest } from '@/features/bills/api';
import { useChangeElectricity } from '@/features/tenants/api';
import { ChargeModal, type ChargeRow } from '@/features/bills/ChargeModal';
import { useProperty } from '@/features/properties/PropertyProvider';
import { useDebounced } from '@/hooks/useDebounced';
import { formatDate, formatINR, formatYM, shiftMonth, toYM } from '@/utils/format';
import { CHARGE_LABELS, isMonthlyCharge, MONTHLY_CHARGE_TYPES, type MonthlyChargeType, type Paginated, type TenantListItem } from '@rental/shared';

/** One editable line per monthly category; blank or 0 leaves it off this bill. */
interface MonthlyRow { amount: string; name?: string; note: string }
const emptyMonthly = (): Record<MonthlyChargeType, MonthlyRow> => ({ WATER: { amount: '', note: '' }, CLEANING: { amount: '', note: '' }, MNGL_GAS: { amount: '', note: '' }, INTERNET: { amount: '', note: '' } });

const num = (s: string) => (s.trim() !== '' && /^\d+(\.\d{1,2})?$/.test(s.trim()) ? Number(s) : undefined);

export function GenerateBillPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fixedTenant = params.get('tenantId') ?? undefined;
  const { current } = useProperty();
  const [tenantId, setTenantId] = useState<string | undefined>(fixedTenant);
  const [period, setPeriod] = useState<string | undefined>();
  const [reading, setReading] = useState('');
  const [prevReading, setPrevReading] = useState<string | null>(null);
  const [rate, setRate] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [manualAmount, setManualAmount] = useState('');
  const [monthly, setMonthly] = useState(emptyMonthly);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [lateFee, setLateFee] = useState('');
  const [discount, setDiscount] = useState('');
  const [dueDate, setDueDate] = useState<string | undefined>();
  const [chargeModal, setChargeModal] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const create = useCreateBill();

  const tenantsQuery = useQuery({
    queryKey: ['tenants', 'billable', current?.id],
    enabled: !fixedTenant && !!current,
    queryFn: () => api.get<Paginated<TenantListItem>>(`/tenants?propertyId=${current!.id}&status=ACTIVE&pageSize=100`),
  });

  const request: BillRequest | null = useMemo(() => {
    if (!tenantId) return null;
    return {
      tenantId, billingPeriod: period, dueDate,
      electricity: {
        ...(manual ? { currentReading: num(reading), overrideAmount: num(manualAmount) ?? 0 } : { currentReading: num(reading) }),
        ...(prevReading !== null && num(prevReading) !== undefined ? { previousReading: num(prevReading) } : {}),
        ...(rate !== null && num(rate) !== undefined ? { ratePerUnit: num(rate) } : {}),
      },
      charges: [
        ...MONTHLY_CHARGE_TYPES.filter((t) => num(monthly[t].amount)).map((t) => ({ type: t, name: monthly[t].name, amount: Number(monthly[t].amount), note: monthly[t].note.trim() || undefined })),
        ...charges.filter((c) => num(c.amount)).map((c) => ({ type: c.type, name: c.name, amount: Number(c.amount) })),
      ],
      lateFee: num(lateFee), discount: num(discount),
    };
  }, [tenantId, period, dueDate, manual, reading, prevReading, rate, manualAmount, monthly, charges, lateFee, discount]);

  const debounced = useDebounced(request, 200);
  const preview = useBillPreview(debounced);
  const data = preview.data;
  const saveRate = useChangeElectricity(data?.assignmentId ?? '');
  const settling = request !== debounced || preview.isFetching;

  // First response seeds the month and any recurring charges (adjusting state while rendering, not in an effect).
  if (data && !seeded) {
    setSeeded(true);
    setPeriod(toYM(data.billingPeriod));
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

  const el = data?.electricity;

  // Instant on-screen totals while typing; the server's verified numbers replace them a moment later.
  const live = useMemo(() => {
    if (!data) return null;
    const p = (n: number) => Math.round(n * 100);
    let elecP = p(data.totals.electricity);
    let units = data.electricity.units;
    let r = data.electricity.ratePerUnit ?? 0;
    if (data.electricity.mode === 'METER') {
      if (manual) elecP = p(num(manualAmount) ?? 0);
      else {
        const cur = num(reading);
        const prev = num(prevReading ?? String(data.electricity.previousReading ?? 0)) ?? 0;
        r = num(rate ?? String(data.electricity.ratePerUnit ?? '')) ?? 0;
        units = cur === undefined || cur < prev ? 0 : Math.round((cur - prev) * 100) / 100;
        elecP = Math.round(units * 100 * p(r) / 100);
      }
    }
    // Same maths as the server: every charge line (monthly and other) adds to the total.
    const otherP = MONTHLY_CHARGE_TYPES.reduce((sum, t) => sum + p(num(monthly[t].amount) ?? 0), 0) + charges.reduce((sum, c) => sum + p(num(c.amount) ?? 0), 0);
    const lateP = p(num(lateFee) ?? 0);
    const discP = p(num(discount) ?? 0);
    const gross = p(data.totals.rent) + elecP + otherP + lateP + p(data.totals.previousBalance);
    return { electricity: elecP / 100, units, rate: r, total: (gross - discP) / 100 };
  }, [data, manual, manualAmount, reading, prevReading, rate, monthly, charges, lateFee, discount]);
  const previewError = preview.error ? (preview.error instanceof ApiError ? preview.error.message : friendlyError(preview.error)) : null;
  const needsReading = el?.mode === 'METER' && !manual && (el?.needsReading ?? true);
  const canGenerate = !!data && !previewError && !settling && !needsReading && !create.isPending;

  const generate = async () => {
    if (!request) return;
    setSubmitError(null);
    try {
      const bill = await create.mutateAsync({ ...request, billingPeriod: period });
      navigate(`/bills/${bill.id}?created=1`, { replace: true });
    } catch (e) { setSubmitError(friendlyError(e)); }
  };

  const tenantOptions = (tenantsQuery.data?.items ?? []).filter((t) => t.assignmentId).map((t) => ({ value: t.id, label: `${t.fullName} · Room ${t.room?.roomNumber}` }));
  const reset = () => { setTenantId(undefined); setSeeded(false); setPeriod(undefined); setMonthly(emptyMonthly()); setCharges([]); setReading(''); setPrevReading(null); setRate(null); };

  return (
    <Page title="Generate Bill" subtitle={current?.name} back>
      {!tenantId ? (
        tenantsQuery.isLoading ? <Skeleton className="h-12" /> : tenantOptions.length === 0 ? <EmptyState icon={Receipt} title="No tenants to bill" message="Assign a tenant to a room first, then generate their bill." />
          : <Select label="Tenant" placeholder="Choose a tenant" options={tenantOptions} value="" onChange={(e) => e.target.value && setTenantId(e.target.value)} />
      ) : (
        <div className="space-y-4">
          <Card className="flex items-center justify-between">
            <div><div className="text-heading">{data?.tenant.fullName ?? ' '}</div><div className="text-small text-ink-soft">{data ? `Room ${data.room.roomNumber}` : ' '}</div></div>
            {!fixedTenant ? <button type="button" onClick={reset} className="text-small font-medium text-primary">Change</button> : null}
          </Card>
          {period ? <MonthStepper label="Billing Month" value={period} onChange={setPeriod} /> : <Skeleton className="h-12" />}
          {previewError ? <Notice tone="danger">{previewError}</Notice> : null}

          {data ? (
            <>
              <Card><DetailRow label="Rent" value={formatINR(data.rent)} strong last /></Card>

              {el && el.mode !== 'NONE' ? (
                <Card className="space-y-3">
                  <div className="flex items-center gap-2"><Icon icon={Zap} tone="primary" /><span className="text-heading">Electricity</span></div>
                  <p className="text-small text-ink-soft">Enter the meter readings for {formatYM(period ?? toYM(data.billingPeriod))}. This bill covers {formatYM(period ?? toYM(data.billingPeriod))} rent and {formatYM(period ?? toYM(data.billingPeriod))} electricity, payable by {formatDate(dueDate ?? data.dueDate)}.</p>
                  {el.mode === 'METER' ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <Input label="Previous" inputMode="decimal" value={prevReading ?? String(el.previousReading ?? 0)} onChange={(e) => setPrevReading(e.target.value)} />
                        <Input label="Current" placeholder="Enter reading" inputMode="decimal" value={reading} onChange={(e) => setReading(e.target.value)} disabled={manual} />
                      </div>
                      <Input label="Rate per unit" prefix="₹" inputMode="decimal" value={rate ?? String(el.ratePerUnit ?? '')} onChange={(e) => setRate(e.target.value)} disabled={manual}
                        hint={rate !== null && num(rate) !== undefined ? 'Used for this bill only.' : "This tenant's rate. Change it for one bill, or save it for all future bills."} />
                      {rate !== null && num(rate) !== undefined && num(rate) !== data.electricity.defaultRatePerUnit ? (
                        <button type="button" disabled={saveRate.isPending} onClick={() => saveRate.mutate({ ratePerUnit: num(rate) }, { onSuccess: () => setRate(null) })} className="text-small font-medium text-primary">Save ₹{rate} as this tenant's rate for all future bills</button>
                      ) : null}
                      {prevReading === null && (el.previousReading ?? 0) === 0 ? <p className="text-caption text-warning">No earlier meter reading is on record. Type the last reading from the meter in Previous, otherwise the whole meter value is billed.</p> : null}
                      {prevReading !== null ? <p className="text-caption text-warning">Previous reading changed by you. Use this only if the stored reading is wrong or the meter was replaced.</p> : null}
                      {!manual && live && (el.currentReading != null || num(reading) !== undefined) ? <p className="text-ink-soft">{settling ? live.units : el.units} units × {formatINR(settling ? live.rate : el.ratePerUnit)} = <span className="font-medium text-ink">{formatINR(settling ? live.electricity : el.amount)}</span></p> : null}
                    </>
                  ) : <p className="text-ink-soft">Fixed monthly amount: {formatINR(el.calculatedAmount)}</p>}
                  {manual ? <Input label="Amount" prefix="₹" inputMode="decimal" placeholder="0" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} hint="Replaces the calculated amount, for example when the meter is faulty." /> : null}
                  <button type="button" onClick={() => setManual((m) => !m)} className="text-small font-medium text-primary">{manual ? 'Use meter reading instead' : 'Enter amount manually'}</button>
                </Card>
              ) : null}

              <SectionHeader title="Monthly charges" />
              <Card padded={false}>
                {MONTHLY_CHARGE_TYPES.map((t, i) => {
                  const row = monthly[t];
                  const label = row.name ?? CHARGE_LABELS[t];
                  const set = (patch: Partial<MonthlyRow>) => setMonthly((cur) => ({ ...cur, [t]: { ...cur[t], ...patch } }));
                  return (
                    <div key={t} className={`space-y-2 px-4 py-2 ${i < MONTHLY_CHARGE_TYPES.length - 1 ? 'border-b border-line' : ''}`}>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 font-medium">{label}</span>
                        <div className="w-32"><Input aria-label={`${label} amount`} prefix="₹" inputMode="decimal" placeholder="0" value={row.amount} onChange={(e) => set({ amount: e.target.value })} /></div>
                      </div>
                      {t === 'MNGL_GAS' && num(row.amount) ? <Input aria-label="MNGL note" placeholder="Units or reading (optional), printed on the bill" maxLength={60} value={row.note} onChange={(e) => set({ note: e.target.value })} /> : null}
                    </div>
                  );
                })}
              </Card>
              <p className="-mt-2 text-caption text-ink-muted">Prefilled from the tenant's regular charges. Change an amount for this bill only; leave it blank or 0 to leave the line off.</p>

              <SectionHeader title="Other charges" action={<button type="button" onClick={() => setChargeModal(true)} className="text-small font-medium text-primary">Add other charge</button>} />
              {charges.length === 0 ? (
                <Card className="flex flex-col items-center gap-2 py-5"><span className="text-ink-soft">No other charges</span><Button variant="secondary" size="sm" full={false} icon={Plus} onClick={() => setChargeModal(true)}>Add other charge</Button></Card>
              ) : (
                <Card padded={false}>
                  {charges.map((c, i) => (
                    <div key={`${c.name}-${i}`} className={`flex items-center gap-2 px-4 py-2 ${i < charges.length - 1 ? 'border-b border-line' : ''}`}>
                      <span className="flex-1 font-medium">{c.name}</span>
                      <div className="w-32"><Input aria-label={`${c.name} amount`} prefix="₹" inputMode="decimal" value={c.amount} onChange={(e) => setCharges((cur) => cur.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} /></div>
                      <button type="button" onClick={() => setCharges((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove ${c.name}`} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-muted"><Icon icon={X} tone="muted" /></button>
                    </div>
                  ))}
                </Card>
              )}

              <SectionHeader title="Adjustments" />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Late fee" prefix="₹" inputMode="decimal" placeholder="0" value={lateFee} onChange={(e) => setLateFee(e.target.value)} />
                <Input label="Discount" prefix="₹" inputMode="decimal" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </div>
              <DateInput label="Due Date" min={`${shiftMonth(period ?? toYM(data.billingPeriod), 1)}-01`} hint="After the billing month ends: its electricity is billed once the month is over."
                value={dueDate ?? data.dueDate.slice(0, 10)} onChange={(e) => setDueDate(e.target.value)} />

              <SectionHeader title="Summary" />
              <Card>
                <DetailRow label="Rent" value={formatINR(data.totals.rent)} />
                {data.totals.electricity > 0 ? <DetailRow label="Electricity" value={formatINR(data.totals.electricity)} /> : null}
                {data.charges.map((c, i) => <DetailRow key={i} label={c.name} value={formatINR(c.amount)} />)}
                {data.totals.lateFee > 0 ? <DetailRow label="Late fee" value={formatINR(data.totals.lateFee)} /> : null}
                {data.totals.discount > 0 ? <DetailRow label="Discount" value={`-${formatINR(data.totals.discount)}`} tone="success" /> : null}
                {data.totals.previousBalance > 0 ? <DetailRow label={`${data.openingBalance > 0 && data.carriedBills.length === 0 ? 'Outstanding (from before)' : 'Previous balance'}${data.carriedBills.length ? ` (${data.carriedBills.length} bill${data.carriedBills.length > 1 ? 's' : ''})` : ''}`} value={formatINR(data.totals.previousBalance)} tone="danger" /> : null}
                <DetailRow label="Total" value={formatINR(data.totals.totalDue)} strong last />
              </Card>
              <p className="text-center text-caption text-ink-muted">Totals are calculated and verified by the server for {formatYM(period ?? toYM(data.billingPeriod))}. Due {formatDate(dueDate ?? data.dueDate)}.</p>

              <div className="sticky bottom-2 z-10 space-y-2 rounded-lg border border-line bg-surface p-3 shadow-lg">
                <div className="flex items-end justify-between"><span className="text-ink-soft">Total due</span><span className="text-title">{formatINR(settling && live ? live.total : data.totals.totalDue)}</span></div>
                {submitError ? <Notice tone="danger">{submitError}</Notice> : null}
                <Button icon={Receipt} onClick={() => void generate()} disabled={!canGenerate} loading={create.isPending}>{create.isPending ? 'Generating bill...' : 'Generate Bill'}</Button>
              </div>
            </>
          ) : preview.isLoading ? <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-28" /></div> : null}
        </div>
      )}
      <ChargeModal open={chargeModal} onClose={() => setChargeModal(false)}
        onAdd={(row) => (isMonthlyCharge(row.type) ? setMonthly((cur) => ({ ...cur, [row.type]: { ...cur[row.type as MonthlyChargeType], amount: row.amount, name: row.name } })) : setCharges((cur) => [...cur, row]))} />
    </Page>
  );
}