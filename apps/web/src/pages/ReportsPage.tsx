import { ChevronRight, CircleCheck, DoorOpen } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, DetailRow, EmptyState, ErrorState, Icon, MonthStepper, ProgressBar, SectionHeader, Segmented, SkeletonList, StatCard } from '@/components/ui';
import { Page } from '@/components/layout/Page';
import { useCollectionReport, useDashboard, useOccupancyReport, useOutstandingReport } from '@/features/dashboard';
import { METHOD_LABEL } from '@/features/payments/constants';
import { useProperty } from '@/features/properties/PropertyProvider';
import { TrendChart } from '@/features/reports/TrendChart';
import { formatINR, formatShortDate, monthStart, toYM } from '@/utils/format';

type Tab = 'collection' | 'occupancy' | 'outstanding';
const TABS: Tab[] = ['collection', 'occupancy', 'outstanding'];

export function ReportsPage() {
  const [params] = useSearchParams();
  const initial = params.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(initial && TABS.includes(initial) ? initial : 'collection');
  const { current } = useProperty();
  // Open on the month the dashboard resolved (the latest month with bills), not an empty current month.
  const dash = useDashboard(current?.id);
  const initialMonth = dash.data?.collection?.month;
  return (
    <Page wide title="Reports" subtitle={current?.name}>
      <div className="mb-4 max-w-xl"><Segmented value={tab} onChange={setTab} options={[{ value: 'collection', label: 'Collection' }, { value: 'occupancy', label: 'Occupancy' }, { value: 'outstanding', label: 'Outstanding' }]} /></div>
      {!current ? <EmptyState icon={DoorOpen} title="No property yet" message="Reports appear once you have a property with rooms and bills." />
        : tab === 'collection' ? <CollectionTab key={initialMonth ?? 'pending'} propertyId={current.id} initialMonth={initialMonth} />
        : tab === 'occupancy' ? <OccupancyTab propertyId={current.id} /> : <OutstandingTab propertyId={current.id} />}
    </Page>
  );
}

function CollectionTab({ propertyId, initialMonth }: { propertyId: string; initialMonth?: string }) {
  const [month, setMonth] = useState(initialMonth ?? toYM(monthStart()));
  const q = useCollectionReport(propertyId, month);
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="max-w-md"><MonthStepper value={month} onChange={setMonth} /></div>
      {q.isLoading ? <SkeletonList count={2} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : d ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-xl bg-primary p-5 text-white">
              <div className="text-small font-medium opacity-80">Paid for {d.monthLabel} bills</div>
              <div className="mt-1 text-[34px] font-bold leading-[40px]">{formatINR(d.forBills.paid)}</div>
              <div className="mb-4 text-small opacity-80">of {formatINR(d.forBills.total)} · {formatINR(d.forBills.remaining)} still to collect</div>
              <ProgressBar value={d.forBills.rate} />
            </div>
            <div className="flex gap-3"><StatCard value={formatINR(d.forBills.total)} label={`${d.monthLabel} bills`} /><StatCard value={formatINR(d.collected)} label={`Received in ${d.monthLabel}`} /></div>
            <Card className="space-y-1">
              <div className="text-small text-ink-soft">Total pending from tenants</div>
              <div className={`text-title ${d.pending > 0 ? 'text-danger' : 'text-success'}`}>{formatINR(d.pending)}</div>
              <div className="text-caption text-ink-muted">Includes balances carried over from earlier months.</div>
            </Card>
            {d.byCategory?.some((c) => c.amount > 0) ? (
              <>
                <SectionHeader title={`Charges billed for ${d.monthLabel}`} />
                <Card>{d.byCategory.map((c, i) => <DetailRow key={c.category} label={`${c.label}${c.count ? ` (${c.count})` : ''}`} value={c.amount > 0 ? formatINR(c.amount) : '-'} last={i === d.byCategory.length - 1} />)}</Card>
              </>
            ) : null}
          </div>
          <div>
            <SectionHeader title="Last 6 months" />
            <Card><TrendChart data={d.trend} highlight={d.month} /></Card>
            {d.byMethod.length > 0 ? (
              <>
                <SectionHeader title="How tenants paid" />
                <Card>{d.byMethod.map((m, i) => <DetailRow key={m.method} label={`${METHOD_LABEL[m.method]} (${m.count})`} value={formatINR(m.amount)} last={i === d.byMethod.length - 1} />)}</Card>
              </>
            ) : <p className="mt-4 text-center text-ink-muted">No payments were recorded in {d.monthLabel}.</p>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OccupancyTab({ propertyId }: { propertyId: string }) {
  const q = useOccupancyReport(propertyId);
  const d = q.data;
  if (q.isLoading) return <SkeletonList count={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!d) return null;
  if (d.totalRooms === 0) return <EmptyState icon={DoorOpen} title="No rooms yet" message="Add rooms to see occupancy." />;
  const seg = (n: number) => `${(n / d.totalRooms) * 100}%`;
  const legend: [string, string, number][] = [['bg-primary', 'Occupied', d.occupied], ['bg-warning', 'Vacant', d.vacant], ['bg-ink-muted', 'Maintenance', d.maintenance]];
  return (
    <div className="max-w-[720px] space-y-4">
      <Card className="space-y-4">
        <div className="flex items-end justify-between">
          <div><div className="text-small text-ink-soft">Occupancy</div><div className="text-[40px] font-bold leading-[46px]">{d.occupancyPercent}%</div></div>
          <span className="text-ink-soft">{d.occupied} of {d.totalRooms} rooms</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-surface-muted">
          <div className="bg-primary" style={{ width: seg(d.occupied) }} /><div className="bg-warning" style={{ width: seg(d.vacant) }} /><div className="bg-ink-muted" style={{ width: seg(d.maintenance) }} />
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          {legend.map(([c, l, n]) => <span key={l} className="flex items-center gap-1.5 text-small text-ink-soft"><span className={`h-2.5 w-2.5 rounded-sm ${c}`} />{l} {n}</span>)}
        </div>
      </Card>
      <div className="flex gap-3"><StatCard value={String(d.totalRooms)} label="Total rooms" /><StatCard value={String(d.vacant)} label="Vacant" /></div>
      {d.vacantRooms.length > 0 ? (
        <>
          <SectionHeader title="Vacant rooms" />
          <Card padded={false} className="overflow-hidden">
            {d.vacantRooms.map((r, i) => (
              <Link key={r.id} to={`/rooms/${r.id}`} className={`flex items-center justify-between px-4 py-3 hover:bg-surface-muted ${i < d.vacantRooms.length - 1 ? 'border-b border-line' : ''}`}>
                <span className="font-medium">Room {r.roomNumber}</span><span className="text-ink-soft">{formatINR(r.defaultRent)} / month</span>
              </Link>
            ))}
          </Card>
          <p className="text-center text-small text-ink-muted">Filling these rooms would add {formatINR(d.vacantRentPotential)} a month.</p>
        </>
      ) : null}
    </div>
  );
}

function OutstandingTab({ propertyId }: { propertyId: string }) {
  const q = useOutstandingReport(propertyId);
  const d = q.data;
  if (q.isLoading) return <SkeletonList count={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!d) return null;
  if (d.count === 0) return <EmptyState icon={CircleCheck} title="Nothing outstanding" message="Every tenant is paid up. New unpaid bills will show here." />;
  return (
    <div className="max-w-[720px] space-y-4">
      <Card className="space-y-1">
        <div className="text-small text-ink-soft">Total outstanding</div>
        <div className="text-display text-danger">{formatINR(d.total)}</div>
        <div className="text-small text-ink-muted">from {d.count} {d.count === 1 ? 'tenant' : 'tenants'}</div>
      </Card>
      <Card padded={false} className="overflow-hidden">
        {d.items.map((p, i) => (
          <Link key={p.tenantId} to={`/tenants/${p.tenantId}`} className={`flex min-h-16 items-center px-4 py-3 hover:bg-surface-muted ${i < d.items.length - 1 ? 'border-b border-line' : ''}`}>
            <div className="min-w-0 flex-1"><div className="font-medium">{p.fullName}</div><div className="text-small text-ink-soft">Room {p.roomNumber} · {p.overdueDays > 0 ? `${p.overdueDays}d overdue` : `due ${formatShortDate(p.dueDate)}`}</div></div>
            <span className="mr-1 text-heading text-danger">{formatINR(p.balance)}</span><Icon icon={ChevronRight} size={16} tone="muted" />
          </Link>
        ))}
      </Card>
    </div>
  );
}
