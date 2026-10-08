import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronRight, CircleCheck, DoorOpen } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Card, DetailRow, EmptyState, ErrorState, Header, Icon, MonthStepper, ProgressBar, Screen, SectionHeader, SegmentedControl, SkeletonList, StatCard, Text } from '@/components/ui';
import { useCollectionReport, useDashboard, useOccupancyReport, useOutstandingReport } from '@/features/dashboard';
import { METHOD_LABEL } from '@/features/payments/constants';
import { useProperty } from '@/features/properties/PropertyProvider';
import { TrendChart } from '@/features/reports/TrendChart';
import { formatINR, formatShortDate, monthStart, toYM } from '@/utils/format';

type Tab = 'collection' | 'occupancy' | 'outstanding';

export default function ReportsScreen() {
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'collection');
  const { current } = useProperty();
  // Open on the month the dashboard resolved (the latest month with bills), not an empty current month.
  const dash = useDashboard(current?.id);
  const initialMonth = dash.data?.collection?.month;
  return (
    <Screen wide edges={['top', 'bottom']}>
      <Header title="Reports" subtitle={current?.name} />
      <View className="mb-4">
        <SegmentedControl value={tab} onChange={setTab} options={[{ value: 'collection', label: 'Collection' }, { value: 'occupancy', label: 'Occupancy' }, { value: 'outstanding', label: 'Outstanding' }]} />
      </View>
      {!current ? <EmptyState icon={DoorOpen} title="No property yet" message="Reports appear once you have a property with rooms and bills." /> : tab === 'collection' ? <CollectionTab key={initialMonth ?? 'pending'} propertyId={current.id} initialMonth={initialMonth} /> : tab === 'occupancy' ? <OccupancyTab propertyId={current.id} /> : <OutstandingTab propertyId={current.id} />}
    </Screen>
  );
}

function CollectionTab({ propertyId, initialMonth }: { propertyId: string; initialMonth?: string }) {
  const [month, setMonth] = useState(initialMonth ?? toYM(monthStart()));
  const q = useCollectionReport(propertyId, month);
  const d = q.data;
  return (
    <View className="gap-4">
      <MonthStepper value={month} onChange={setMonth} />
      {q.isLoading ? <SkeletonList count={2} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : d ? (
        <>
          <View className="rounded-xl bg-primary p-5">
            <Text variant="secondaryMedium" tone="white" className="opacity-80">Paid for {d.monthLabel} bills</Text>
            <Text variant="display" tone="white" style={{ fontSize: 34, lineHeight: 40 }} className="mt-1">{formatINR(d.forBills.paid)}</Text>
            <Text variant="secondary" tone="white" className="mb-4 opacity-80">of {formatINR(d.forBills.total)} · {formatINR(d.forBills.remaining)} still to collect</Text>
            <ProgressBar value={d.forBills.rate} />
          </View>
          <View className="flex-row gap-3">
            <StatCard value={formatINR(d.forBills.total)} label={`${d.monthLabel} bills`} />
            <StatCard value={formatINR(d.collected)} label={`Received in ${d.monthLabel}`} />
          </View>
          <Card className="gap-1">
            <Text variant="secondary" tone="soft">Total pending from tenants</Text>
            <Text variant="title" tone={d.pending > 0 ? 'danger' : 'success'}>{formatINR(d.pending)}</Text>
            <Text variant="caption" tone="muted">Includes balances carried over from earlier months.</Text>
          </Card>

          {d.byCategory?.some((c) => c.amount > 0) ? (
            <>
              <SectionHeader title={`Charges billed for ${d.monthLabel}`} />
              <Card>
                {d.byCategory.map((c, i) => <DetailRow key={c.category} label={`${c.label}${c.count ? ` (${c.count})` : ''}`} value={c.amount > 0 ? formatINR(c.amount) : '-'} last={i === d.byCategory.length - 1} />)}
              </Card>
            </>
          ) : null}

          <SectionHeader title="Last 6 months" />
          <Card><TrendChart data={d.trend} highlight={d.month} /></Card>

          {d.byMethod.length > 0 ? (
            <>
              <SectionHeader title="How tenants paid" />
              <Card>
                {d.byMethod.map((m, i) => <DetailRow key={m.method} label={`${METHOD_LABEL[m.method]} (${m.count})`} value={formatINR(m.amount)} last={i === d.byMethod.length - 1} />)}
              </Card>
            </>
          ) : (
            <Text tone="muted" className="text-center">No payments were recorded in {d.monthLabel}.</Text>
          )}
        </>
      ) : null}
    </View>
  );
}

function OccupancyTab({ propertyId }: { propertyId: string }) {
  const q = useOccupancyReport(propertyId);
  const d = q.data;
  if (q.isLoading) return <SkeletonList count={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!d) return null;
  if (d.totalRooms === 0) return <EmptyState icon={DoorOpen} title="No rooms yet" message="Add rooms to see occupancy." />;
  const seg = (n: number) => `${(n / d.totalRooms) * 100}%` as const;
  return (
    <View className="gap-4">
      <Card className="gap-4">
        <View className="flex-row items-end justify-between">
          <View>
            <Text variant="secondary" tone="soft">Occupancy</Text>
            <Text variant="display" style={{ fontSize: 40, lineHeight: 46 }}>{d.occupancyPercent}%</Text>
          </View>
          <Text tone="soft">{d.occupied} of {d.totalRooms} rooms</Text>
        </View>
        <View className="h-3 flex-row overflow-hidden rounded-full bg-surface-muted">
          <View className="bg-primary" style={{ width: seg(d.occupied) }} />
          <View className="bg-warning" style={{ width: seg(d.vacant) }} />
          <View className="bg-ink-muted" style={{ width: seg(d.maintenance) }} />
        </View>
        <View className="flex-row justify-between">
          {[['bg-primary', 'Occupied', d.occupied], ['bg-warning', 'Vacant', d.vacant], ['bg-ink-muted', 'Maintenance', d.maintenance]].map(([c, l, n]) => (
            <View key={l as string} className="flex-row items-center gap-1.5"><View className={`h-2.5 w-2.5 rounded-sm ${c}`} /><Text variant="secondary" tone="soft">{l} {n}</Text></View>
          ))}
        </View>
      </Card>
      <View className="flex-row gap-3">
        <StatCard value={String(d.totalRooms)} label="Total rooms" />
        <StatCard value={String(d.vacant)} label="Vacant" />
      </View>
      {d.vacantRooms.length > 0 ? (
        <>
          <SectionHeader title="Vacant rooms" />
          <Card padded={false}>
            {d.vacantRooms.map((r, i) => (
              <View key={r.id} className={`flex-row items-center justify-between px-4 py-3 ${i < d.vacantRooms.length - 1 ? 'border-b border-line' : ''}`}>
                <Text variant="bodyMedium">Room {r.roomNumber}</Text>
                <Text tone="soft">{formatINR(r.defaultRent)} / month</Text>
              </View>
            ))}
          </Card>
          <Text variant="secondary" tone="muted" className="text-center">Filling these rooms would add {formatINR(d.vacantRentPotential)} a month.</Text>
        </>
      ) : null}
    </View>
  );
}

function OutstandingTab({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const q = useOutstandingReport(propertyId);
  const d = q.data;
  if (q.isLoading) return <SkeletonList count={3} lines={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!d) return null;
  if (d.count === 0) return <EmptyState icon={CircleCheck} title="Nothing outstanding" message="Every tenant is paid up. New unpaid bills will show here." />;
  return (
    <View className="gap-4">
      <Card className="gap-1">
        <Text variant="secondary" tone="soft">Total outstanding</Text>
        <Text variant="display" tone="danger">{formatINR(d.total)}</Text>
        <Text variant="secondary" tone="muted">from {d.count} {d.count === 1 ? 'tenant' : 'tenants'}</Text>
      </Card>
      <Card padded={false}>
        {d.items.map((p, i) => (
          <Pressable key={p.tenantId} onPress={() => router.push({ pathname: '/tenants/[id]', params: { id: p.tenantId } })} accessibilityRole="button" className={`min-h-16 flex-row items-center px-4 py-3 active:bg-surface-muted ${i < d.items.length - 1 ? 'border-b border-line' : ''}`}>
            <View className="flex-1">
              <Text variant="bodyMedium">{p.fullName}</Text>
              <Text variant="secondary" tone="soft">Room {p.roomNumber} · {p.overdueDays > 0 ? `${p.overdueDays}d overdue` : `due ${formatShortDate(p.dueDate)}`}</Text>
            </View>
            <Text variant="heading" tone="danger" className="mr-1">{formatINR(p.balance)}</Text>
            <Icon icon={ChevronRight} size="sm" tone="muted" />
          </Pressable>
        ))}
      </Card>
    </View>
  );
}
