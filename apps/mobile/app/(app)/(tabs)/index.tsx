import { useRouter } from 'expo-router';
import { AlarmClock, Building2, CalendarClock, ChevronRight, CircleCheck, DoorClosed, FilePlus2, LogOut, Plus, TrendingDown, Users, Wallet } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Card, EmptyState, ErrorState, Icon, ProgressBar, Screen, SectionHeader, SkeletonList, Text } from '@/components/ui';
import type { IconTone } from '@/components/ui/Icon';
import { ownerName, useDashboard } from '@/features/dashboard';
import { QuickActions } from '@/features/home/QuickActions';
import { METHOD_LABEL } from '@/features/payments/constants';
import { useProperty } from '@/features/properties/PropertyProvider';
import { PropertySwitcher } from '@/features/properties/PropertySwitcher';
import { TrendChart } from '@/features/reports/TrendChart';
import { Avatar } from '@/features/tenants/TenantCard';
import { useLayout } from '@/hooks/useLayout';
import { cn } from '@/utils/cn';
import { formatINR, formatShortDate, greeting } from '@/utils/format';

type Tone = 'neutral' | 'danger' | 'warning' | 'success';
const TEXT_TONE = { neutral: 'ink', danger: 'danger', warning: 'warning', success: 'success' } as const;
const ICON_TONE: Record<Tone, IconTone> = { neutral: 'primary', danger: 'danger', warning: 'warning', success: 'success' };
const BG: Record<Tone, string> = { neutral: 'bg-primary-soft', danger: 'bg-danger-soft', warning: 'bg-warning-soft', success: 'bg-success-soft' };
/** "Ramesh (Room 4), Sita (Room 2) +3 more": who still needs a bill. */
const toBillNames = (ts: { tenantName: string; roomNumber: string }[]) =>
  ts.slice(0, 3).map((t) => `${t.tenantName} (Room ${t.roomNumber})`).join(', ') + (ts.length > 3 ? ` +${ts.length - 3} more` : '');
const people = (n: number) => `${n} ${n === 1 ? 'tenant' : 'tenants'}`;

/** One headline number with a short explanation underneath. */
function Kpi({ label, value, sub, icon, tone = 'neutral', onPress }: { label: string; value: string; sub?: string; icon: LucideIcon; tone?: Tone; onPress?: () => void }) {
  return (
    <Card onPress={onPress} className="w-[48.5%] gap-1.5">
      <View className="flex-row items-center gap-2">
        <View className={cn('h-8 w-8 items-center justify-center rounded-md', BG[tone])}><Icon icon={icon} size={18} tone={ICON_TONE[tone]} /></View>
        <Text variant="secondaryMedium" tone="soft" className="flex-1" numberOfLines={2}>{label}</Text>
      </View>
      <Text variant="heading" tone={TEXT_TONE[tone]} style={{ fontSize: 22, lineHeight: 28 }}>{value}</Text>
      {sub ? <Text variant="caption" tone="muted">{sub}</Text> : null}
    </Card>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { columns } = useLayout();
  const split = columns >= 2; // large tablets: two columns
  const { current, isLoading: loadingProps, isError: propsError, error: propsErr, refetch: refetchProps } = useProperty();
  const q = useDashboard(current?.id);
  const d = q.data;
  const k = d?.kpis;
  const loading = loadingProps || (!!current && q.isLoading);
  const goOutstanding = () => router.push({ pathname: '/reports', params: { tab: 'outstanding' } });

  let left: ReactNode = null;
  let right: ReactNode = null;
  if (d?.collection && d.occupancy) {
    const c = d.collection;
    const o = d.occupancy;
    left = (
      <>
        <Pressable onPress={() => router.push('/reports')} accessibilityRole="button" className="rounded-xl bg-primary p-5 active:bg-primary-dark">
          <Text variant="secondaryMedium" tone="white" className="opacity-80">Money received in {c.monthLabel}</Text>
          <Text variant="display" tone="white" className="mt-1" style={{ fontSize: 34, lineHeight: 40 }}>{formatINR(c.collected)}</Text>
          <Text variant="secondary" tone="white" className="mb-4 opacity-80">{c.monthLabel} bills total {formatINR(c.expected)}</Text>
          <ProgressBar value={c.collectionRate} />
          {k && k.composition.bills > 0 ? (
            <Text variant="caption" tone="white" className="mt-3 opacity-90">
              Rent {formatINR(k.composition.rent)}  ·  Electricity {formatINR(k.composition.electricity)}{k.composition.other > 0 ? `  ·  Other ${formatINR(k.composition.other)}` : ''}
            </Text>
          ) : null}
        </Pressable>

        {k && k.toBill.count > 0 ? (
          <Pressable onPress={() => router.push(k.toBill.count === 1 ? { pathname: '/bills/new', params: { tenantId: k.toBill.tenants[0].tenantId } } : '/bills/new')} accessibilityRole="button" className="mt-3 flex-row items-center gap-3 rounded-lg border border-warning-soft bg-warning-soft p-4 active:opacity-80">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-white"><Icon icon={FilePlus2} tone="warning" /></View>
            <View className="flex-1">
              <Text variant="bodyMedium" tone="warning" className="font-semibold">{k.toBill.count} {k.toBill.count === 1 ? 'tenant has' : 'tenants have'} no {k.toBill.monthLabel} bill yet</Text>
              <Text variant="secondary" tone="warning">{toBillNames(k.toBill.tenants)} · Tap to generate {k.toBill.count === 1 ? 'the bill' : 'bills'}</Text>
            </View>
            <Icon icon={ChevronRight} size="sm" tone="warning" />
          </Pressable>
        ) : null}

        {k ? (
          <>
            <SectionHeader title="At a glance" />
            <View className="flex-row flex-wrap justify-between gap-y-3">
              <Kpi label="Total outstanding" value={formatINR(k.dues.total)} icon={Wallet} tone={k.dues.total > 0 ? 'danger' : 'success'} onPress={goOutstanding}
                sub={k.dues.total > 0 ? `${formatINR(k.dues.currentTenants.amount)} current · ${formatINR(k.dues.formerTenants.amount)} former` : 'Everyone is paid up'} />
              <Kpi label="Overdue" value={formatINR(k.dues.overdue.amount)} icon={AlarmClock} tone={k.dues.overdue.amount > 0 ? 'danger' : 'success'} onPress={goOutstanding}
                sub={k.dues.overdue.count ? `Past due date, ${people(k.dues.overdue.count)}` : 'Nothing past its due date'} />
              <Kpi label="Due in 7 days" value={formatINR(k.dues.dueSoon.amount)} icon={CalendarClock} tone={k.dues.dueSoon.amount > 0 ? 'warning' : 'neutral'}
                sub={k.dues.dueSoon.count ? people(k.dues.dueSoon.count) : 'No bills falling due this week'} />
              <Kpi label="Rent roll" value={formatINR(k.rentRoll.monthly)} icon={Users} sub={`Monthly rent from ${people(k.rentRoll.tenants)}`} onPress={() => router.push('/tenants')} />
              <Kpi label="Occupancy" value={`${o.occupancyPercent}%`} icon={DoorClosed} onPress={() => router.push({ pathname: '/reports', params: { tab: 'occupancy' } })}
                sub={o.vacant > 0 ? `${o.occupied} of ${o.totalRooms} rooms · ${formatINR(k.vacancy.lostRent)} a month vacant` : `${o.occupied} of ${o.totalRooms} rooms let`} />
              <Kpi label="Collected, last 7 days" value={formatINR(k.last7Days.amount)} icon={TrendingDown} tone="success" onPress={() => router.push('/payments')}
                sub={k.last7Days.count ? `${k.last7Days.count} ${k.last7Days.count === 1 ? 'payment' : 'payments'}` : 'No payments this week'} />
            </View>
            {k.trend.some((p) => p.expected > 0 || p.collected > 0) ? (
              <>
                <SectionHeader title="Last 6 months" actionLabel="Reports" onAction={() => router.push('/reports')} />
                <Card><TrendChart data={k.trend} highlight={c.month} /></Card>
              </>
            ) : null}
          </>
        ) : null}
      </>
    );

    const former = d.formerTenantDues ?? [];
    right = (
      <>
        {former.length > 0 && k ? (
          <>
            <SectionHeader title="Moved out, still owe" actionLabel="All tenants" onAction={() => router.push('/tenants')} />
            <Card padded={false}>
              <View className="flex-row items-center gap-2 rounded-t-lg border-b border-line bg-surface-muted px-4 py-2.5">
                <Icon icon={LogOut} size="sm" tone="muted" />
                <Text variant="secondary" tone="soft" className="flex-1"><Text variant="secondaryMedium" tone="danger">{formatINR(k.dues.formerTenants.amount)}</Text> from {people(k.dues.formerTenants.count)} who have left</Text>
              </View>
              {former.map((p, i) => (
                <Pressable key={p.tenantId} onPress={() => router.push({ pathname: '/tenants/[id]', params: { id: p.tenantId } })} accessibilityRole="button" className={`min-h-16 flex-row items-center gap-3 px-4 py-3 active:bg-surface-muted ${i < former.length - 1 ? 'border-b border-line' : ''}`}>
                  <Avatar name={p.fullName} size={36} />
                  <View className="flex-1">
                    <Text variant="bodyMedium" numberOfLines={1}>{p.fullName}</Text>
                    <Text variant="secondary" tone="soft">Room {p.roomNumber} · due {formatShortDate(p.dueDate)}</Text>
                  </View>
                  <Text variant="heading" tone="danger" className="mr-1">{formatINR(p.balance)}</Text>
                  <Icon icon={ChevronRight} tone="muted" size="sm" />
                </Pressable>
              ))}
            </Card>
          </>
        ) : null}

        <SectionHeader title="Pending Payments" actionLabel={d.pendingPayments.length ? 'See all' : undefined} onAction={goOutstanding} />
        {d.pendingPayments.length === 0 ? (
          <Card className="flex-row items-center gap-3"><Icon icon={CircleCheck} tone="success" /><Text tone="soft" className="flex-1">No pending payments from current tenants.</Text></Card>
        ) : (
          <Card padded={false}>
            {d.pendingPayments.map((p, i) => (
              <Pressable key={p.tenantId} onPress={() => router.push({ pathname: '/tenants/[id]', params: { id: p.tenantId } })} accessibilityRole="button" className={`min-h-16 flex-row items-center px-4 py-3 active:bg-surface-muted ${i < d.pendingPayments.length - 1 ? 'border-b border-line' : ''}`}>
                <View className="flex-1">
                  <Text variant="bodyMedium">{p.fullName}</Text>
                  <Text variant="secondary" tone="soft">Room {p.roomNumber}{p.overdueDays > 0 ? ` · ${p.overdueDays} ${p.overdueDays === 1 ? 'day' : 'days'} overdue` : ''}</Text>
                </View>
                <Text variant="heading" tone="danger" className="mr-1">{formatINR(p.balance)}</Text>
                <Icon icon={ChevronRight} tone="muted" size="sm" />
              </Pressable>
            ))}
          </Card>
        )}

        {d.recentPayments && d.recentPayments.length > 0 ? (
          <>
            <SectionHeader title="Recent payments" actionLabel="See all" onAction={() => router.push('/payments')} />
            <Card padded={false}>
              {d.recentPayments.map((p, i) => (
                <Pressable key={p.id} onPress={() => router.push({ pathname: '/bills/[id]', params: { id: p.billId } })} accessibilityRole="button" className={`min-h-14 flex-row items-center px-4 py-2.5 active:bg-surface-muted ${i < d.recentPayments!.length - 1 ? 'border-b border-line' : ''}`}>
                  <View className="flex-1 pr-3">
                    <Text variant="bodyMedium" numberOfLines={1}>{p.tenantName}</Text>
                    <Text variant="secondary" tone="soft">Room {p.roomNumber} · {METHOD_LABEL[p.method]} · {formatShortDate(p.paymentDate)}</Text>
                  </View>
                  <Text variant="heading" tone="success">{formatINR(p.amount)}</Text>
                </Pressable>
              ))}
            </Card>
          </>
        ) : null}

        <SectionHeader title="Quick Actions" />
        <QuickActions />
      </>
    );
  }

  return (
    <Screen wide refreshing={q.isRefetching} onRefresh={() => { refetchProps(); q.refetch(); }}>
      <View className="pb-3 pt-4">
        <Text variant="title">{greeting()}, {ownerName(d?.username)}</Text>
        <PropertySwitcher />
      </View>

      {loading ? (
        <View className="mt-2"><SkeletonList count={3} lines={3} /></View>
      ) : propsError || q.isError ? (
        <ErrorState error={propsErr ?? q.error} onRetry={() => { refetchProps(); q.refetch(); }} />
      ) : !current ? (
        <EmptyState icon={Building2} title="Add your first property" message="Create a property to start adding rooms, tenants and bills." actionLabel="Add Property" actionIcon={Plus} onAction={() => router.push('/properties/form')} />
      ) : left ? (
        split ? (
          <View className="flex-row items-start gap-6">
            <View className="flex-1">{left}</View>
            <View className="flex-1">{right}</View>
          </View>
        ) : (
          <>
            {left}
            {right}
          </>
        )
      ) : null}
    </Screen>
  );
}
