import { AlarmClock, Banknote, Building2, CalendarClock, ChevronRight, CircleCheck, DoorClosed, DoorOpen, FilePlus2, LogOut, Plus, Receipt, TrendingDown, UserPlus, Users, Wallet, Zap, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Badge, Card, EmptyState, ErrorState, Icon, LinkButton, ProgressBar, SectionHeader, SkeletonList } from '@/components/ui';
import { Page } from '@/components/layout/Page';
import { PropertySwitcher } from '@/components/layout/PropertySwitcher';
import { ownerName, useDashboard } from '@/features/dashboard';
import { METHOD_LABEL } from '@/features/payments/constants';
import { useProperty } from '@/features/properties/PropertyProvider';
import { TrendChart } from '@/features/reports/TrendChart';
import { cn } from '@/utils/cn';
import { formatINR, formatShortDate, greeting } from '@/utils/format';

const QUICK = [
  { to: '/tenants/new', label: 'Add Tenant', icon: UserPlus },
  { to: '/bills/new', label: 'Generate Bill', icon: Receipt },
  { to: '/payments/new', label: 'Record Payment', icon: Banknote },
  { to: '/rooms/new', label: 'Add Room', icon: DoorOpen },
];

type Tone = 'neutral' | 'danger' | 'warning' | 'success';
const TONE_TEXT: Record<Tone, string> = { neutral: 'text-ink', danger: 'text-danger', warning: 'text-warning', success: 'text-success' };
const TONE_BG: Record<Tone, string> = { neutral: 'bg-primary-soft', danger: 'bg-danger-soft', warning: 'bg-warning-soft', success: 'bg-success-soft' };
const TONE_ICON = { neutral: 'primary', danger: 'danger', warning: 'warning', success: 'success' } as const;

/** One headline number with a short explanation underneath. */
function Kpi({ label, value, sub, icon, tone = 'neutral', to }: { label: string; value: string; sub?: ReactNode; icon: LucideIcon; tone?: Tone; to?: string }) {
  return (
    <Card to={to} className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', TONE_BG[tone])}><Icon icon={icon} size={18} tone={TONE_ICON[tone]} /></span>
        <span className="text-small font-medium text-ink-soft">{label}</span>
      </div>
      <div className={cn('text-[22px] font-bold leading-7', TONE_TEXT[tone])}>{value}</div>
      {sub ? <div className="text-caption text-ink-muted">{sub}</div> : null}
    </Card>
  );
}

/** "Ramesh (Room 4), Sita (Room 2) +3 more": who still needs a bill. */
const toBillNames = (ts: { tenantName: string; roomNumber: string }[]) =>
  ts.slice(0, 3).map((t) => `${t.tenantName} (Room ${t.roomNumber})`).join(', ') + (ts.length > 3 ? ` +${ts.length - 3} more` : '');
const people = (n: number) => `${n} ${n === 1 ? 'tenant' : 'tenants'}`;

export function HomePage() {
  const { current, rememberedId, isLoading: loadingProps, isError: propsError, error: propsErr, refetch } = useProperty();
  // Starts straight away with the remembered property (the API falls back to the first one if it is gone), instead of waiting for the property list.
  const q = useDashboard(current?.id ?? rememberedId ?? undefined);
  const d = q.data;
  const loading = (loadingProps && !q.data) || ((!!current || !!rememberedId) && q.isLoading);
  const k = d?.kpis;

  const collection = d?.collection && (
    <Link to="/reports" className="block rounded-xl bg-primary p-5 text-white transition-colors hover:bg-primary-dark">
      <div className="text-small font-medium opacity-80">Money received in {d.collection.monthLabel}</div>
      <div className="mt-1 text-[34px] font-bold leading-[40px]">{formatINR(d.collection.collected)}</div>
      <div className="mb-4 text-small opacity-80">{d.collection.monthLabel} bills total {formatINR(d.collection.expected)}</div>
      <ProgressBar value={d.collection.collectionRate} />
      {k && k.composition.bills > 0 ? (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-caption opacity-90">
          <span>Rent {formatINR(k.composition.rent)}</span>
          <span>Electricity {formatINR(k.composition.electricity)}</span>
          {k.composition.other > 0 ? <span>Other {formatINR(k.composition.other)}</span> : null}
        </div>
      ) : null}
    </Link>
  );

  const kpiGrid = k && d?.occupancy && (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Kpi label="Total outstanding" value={formatINR(k.dues.total)} icon={Wallet} tone={k.dues.total > 0 ? 'danger' : 'success'} to="/reports?tab=outstanding"
        sub={k.dues.total > 0 ? `${formatINR(k.dues.currentTenants.amount)} current · ${formatINR(k.dues.formerTenants.amount)} former` : 'Everyone is paid up'} />
      <Kpi label="Overdue" value={formatINR(k.dues.overdue.amount)} icon={AlarmClock} tone={k.dues.overdue.amount > 0 ? 'danger' : 'success'} to="/reports?tab=outstanding"
        sub={k.dues.overdue.count ? `Past due date, ${people(k.dues.overdue.count)}` : 'Nothing past its due date'} />
      <Kpi label="Due in 7 days" value={formatINR(k.dues.dueSoon.amount)} icon={CalendarClock} tone={k.dues.dueSoon.amount > 0 ? 'warning' : 'neutral'}
        sub={k.dues.dueSoon.count ? people(k.dues.dueSoon.count) : 'No bills falling due this week'} />
      <Kpi label="Rent roll" value={formatINR(k.rentRoll.monthly)} icon={Users} sub={`Monthly rent from ${people(k.rentRoll.tenants)}`} to="/tenants" />
      <Kpi label="Occupancy" value={`${d.occupancy.occupancyPercent}%`} icon={DoorClosed} to="/reports?tab=occupancy"
        sub={d.occupancy.vacant > 0 ? `${d.occupancy.occupied} of ${d.occupancy.totalRooms} rooms · ${formatINR(k.vacancy.lostRent)} a month vacant` : `${d.occupancy.occupied} of ${d.occupancy.totalRooms} rooms let`} />
      <Kpi label="Collected, last 7 days" value={formatINR(k.last7Days.amount)} icon={TrendingDown} tone="success" to="/payments"
        sub={k.last7Days.count ? `${k.last7Days.count} ${k.last7Days.count === 1 ? 'payment' : 'payments'}` : 'No payments this week'} />
    </div>
  );

  const toBill = k && k.toBill.count > 0 && (
    <Link to={k.toBill.count === 1 ? `/bills/new?tenantId=${k.toBill.tenants[0].tenantId}` : '/bills/new'} className="mt-3 flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft p-4 hover:opacity-90">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white"><Icon icon={FilePlus2} tone="warning" /></span>
      <span className="min-w-0 flex-1"><span className="block font-semibold text-warning">{k.toBill.count} {k.toBill.count === 1 ? 'tenant has' : 'tenants have'} no {k.toBill.monthLabel} bill yet</span><span className="block text-small text-warning/90">{toBillNames(k.toBill.tenants)} · Tap to generate {k.toBill.count === 1 ? 'the bill' : 'bills'}</span></span>
      <Icon icon={ChevronRight} size={18} tone="warning" />
    </Link>
  );

  const trend = k && k.trend.some((p) => p.expected > 0 || p.collected > 0) && d?.collection && (
    <>
      <SectionHeader title="Last 6 months" action={<Link to="/reports" className="text-small font-medium text-primary">Reports</Link>} />
      <Card><TrendChart data={k.trend} highlight={d.collection.month} /></Card>
    </>
  );

  const former = d?.formerTenantDues && d.formerTenantDues.length > 0 && k && (
    <>
      <SectionHeader title="Moved out, still owe" action={<Link to="/tenants" className="text-small font-medium text-primary">All tenants</Link>} />
      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line bg-surface-muted px-4 py-2.5 text-small text-ink-soft">
          <Icon icon={LogOut} size={16} tone="muted" />
          <span><span className="font-semibold text-danger">{formatINR(k.dues.formerTenants.amount)}</span> from {people(k.dues.formerTenants.count)} who have left</span>
        </div>
        {d.formerTenantDues.map((p, i) => (
          <Link key={p.tenantId} to={`/tenants/${p.tenantId}`} className={cn('flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-muted', i < d.formerTenantDues!.length - 1 && 'border-b border-line')}>
            <Avatar name={p.fullName} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.fullName}</div>
              <div className="text-small text-ink-soft">Room {p.roomNumber} · due {formatShortDate(p.dueDate)}</div>
            </div>
            <span className="text-heading text-danger">{formatINR(p.balance)}</span><Icon icon={ChevronRight} size={16} tone="muted" />
          </Link>
        ))}
      </Card>
    </>
  );

  const current_ = d?.pendingPayments ?? [];
  const pending = d && (
    <>
      <SectionHeader title="Pending payments" action={d.pendingPayments.length ? <Link to="/reports?tab=outstanding" className="text-small font-medium text-primary">See all</Link> : undefined} />
      {current_.length === 0 ? (
        <Card className="flex items-center gap-3"><Icon icon={CircleCheck} tone="success" /><span className="text-ink-soft">No pending payments from current tenants.</span></Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          {current_.map((p, i) => (
            <Link key={p.tenantId} to={`/tenants/${p.tenantId}`} className={cn('flex min-h-16 items-center px-4 py-3 hover:bg-surface-muted', i < current_.length - 1 && 'border-b border-line')}>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.fullName}</div>
                <div className="text-small text-ink-soft">Room {p.roomNumber}{p.overdueDays > 0 ? ` · ${p.overdueDays} ${p.overdueDays === 1 ? 'day' : 'days'} overdue` : ''}</div>
              </div>
              <span className="mr-1 text-heading text-danger">{formatINR(p.balance)}</span><Icon icon={ChevronRight} size={16} tone="muted" />
            </Link>
          ))}
        </Card>
      )}
    </>
  );

  const recent = d?.recentPayments && d.recentPayments.length > 0 && (
    <>
      <SectionHeader title="Recent payments" action={<Link to="/payments" className="text-small font-medium text-primary">See all</Link>} />
      <Card padded={false} className="overflow-hidden">
        {d.recentPayments.map((p, i) => (
          <Link key={p.id} to={`/bills/${p.billId}`} className={cn('flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-surface-muted', i < d.recentPayments!.length - 1 && 'border-b border-line')}>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.tenantName}</div>
              <div className="text-small text-ink-soft">Room {p.roomNumber} · {METHOD_LABEL[p.method]} · {formatShortDate(p.paymentDate)}</div>
            </div>
            <span className="text-heading text-success">{formatINR(p.amount)}</span>
          </Link>
        ))}
      </Card>
    </>
  );

  const rooms = d?.occupancy && (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-small text-ink-muted">
      <Badge label={`${d.occupancy.occupied} occupied`} tone="success" />
      <Badge label={`${d.occupancy.vacant} vacant`} tone={d.occupancy.vacant ? 'warning' : 'neutral'} />
      {d.occupancy.maintenance > 0 ? <Badge label={`${d.occupancy.maintenance} under maintenance`} tone="neutral" /> : null}
      <span className="flex items-center gap-1 text-primary"><Icon icon={Zap} size={14} tone="primary" /><Link to="/rooms" className="font-medium">View rooms</Link></span>
    </div>
  );

  const quick = (
    <>
      <SectionHeader title="Quick actions" />
      <div className="grid grid-cols-4 gap-3">
        {QUICK.map((a) => (
          <Link key={a.to} to={a.to} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-line bg-surface p-3 text-center text-small font-medium hover:bg-surface-muted">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft"><Icon icon={a.icon} size={24} tone="primary" /></span>{a.label}
          </Link>
        ))}
      </div>
    </>
  );

  return (
    <Page wide>
      <div className="pb-3"><h1 className="text-title">{greeting()}, {ownerName(d?.username)}</h1><PropertySwitcher /></div>
      {loading ? <SkeletonList count={3} /> : propsError || q.isError ? <ErrorState error={propsErr ?? q.error} onRetry={() => { refetch(); void q.refetch(); }} />
        : !current && !loadingProps ? <EmptyState icon={Building2} title="Add your first property" message="Create a property to start adding rooms, tenants and bills." action={<LinkButton to="/properties/new" icon={Plus} full={false} className="px-6">Add Property</LinkButton>} />
        : d?.collection && d.occupancy ? (
          <div className="grid items-start gap-x-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div>
              {collection}
              {toBill}
              <SectionHeader title="At a glance" />
              {kpiGrid}
              {rooms}
              {trend}
            </div>
            <div>
              {former}
              {pending}
              {recent}
              {quick}
            </div>
          </div>
        ) : null}
    </Page>
  );
}
