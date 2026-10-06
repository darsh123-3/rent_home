import { useLocalSearchParams, useRouter } from 'expo-router';
import { History, Pencil, Receipt, Banknote, UserPlus, UserRound } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { Badge, Button, Card, DetailRow, ErrorState, Header, Icon, Screen, SectionHeader, SkeletonList, Text } from '@/components/ui';
import { useRoom } from '@/features/rooms/api';
import { ROOM_STATUS } from '@/features/rooms/RoomCard';
import { AgreementBadge } from '@/features/tenants/AgreementBadge';
import { formatDate, formatINR, formatMonthShort } from '@/utils/format';

export default function RoomDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: room, isLoading, isError, error, refetch, isRefetching } = useRoom(id);

  const edit = (
    <Pressable onPress={() => router.push({ pathname: '/rooms/form', params: { id } })} accessibilityRole="button" accessibilityLabel="Edit room" hitSlop={8} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-muted">
      <Icon icon={Pencil} tone="ink" />
    </Pressable>
  );

  if (isLoading) return <Screen><Header title="Room" /><SkeletonList count={3} /></Screen>;
  if (isError || !room) return <Screen><Header title="Room" /><ErrorState error={error} onRetry={refetch} /></Screen>;

  const status = ROOM_STATUS[room.status];
  const tenant = room.currentTenant;
  return (
    <Screen edges={['top']} refreshing={isRefetching} onRefresh={refetch}>
      <Header title={`Room ${room.roomNumber}`} subtitle={room.property.name} right={edit} />

      <Card className="mt-2">
        <View className="mb-1 flex-row items-center justify-between">
          <Text variant="caption" tone="muted">STATUS</Text>
          <Badge label={status.label} tone={status.tone} />
        </View>
        <DetailRow label="Property" value={room.property.name} />
        <DetailRow label="Current Tenant" value={tenant?.fullName ?? 'None'} />
        {tenant && tenant.agreementStatus !== 'NONE' ? <View className="items-end border-b border-line py-2"><AgreementBadge agreement={tenant} compact /></View> : null}
        <DetailRow label="Monthly Rent" value={formatINR(room.monthlyRent)} />
        <DetailRow label="Pending" value={tenant ? (room.balance > 0 ? formatINR(room.balance) : 'Paid') : '-'} tone={room.balance > 0 ? 'danger' : 'ink'} />
        <DetailRow label="Electricity" value={room.electricityMode === 'METER' ? `Meter, ${formatINR(room.ratePerUnit)} / unit` : room.electricityMode === 'FIXED' ? `Fixed ${formatINR(room.fixedElectricity)}` : 'Not charged'} last />
      </Card>

      <View className="mt-4 gap-3">
        {tenant ? (
          <>
            <Button label="View Tenant" icon={UserRound} variant="secondary" onPress={() => router.push({ pathname: '/tenants/[id]', params: { id: tenant.id } } as never)} />
            <View className="flex-row gap-3">
              <View className="flex-1"><Button label="Generate Bill" icon={Receipt} onPress={() => router.push({ pathname: '/bills/new', params: { tenantId: tenant.id } } as never)} /></View>
              <View className="flex-1"><Button label="Record Payment" icon={Banknote} variant="secondary" onPress={() => router.push({ pathname: '/payments/new', params: { tenantId: tenant.id } } as never)} /></View>
            </View>
          </>
        ) : room.status === 'VACANT' ? (
          <Button label="Assign Tenant" icon={UserPlus} onPress={() => router.push({ pathname: '/tenants/new', params: { roomId: room.id } } as never)} />
        ) : null}
      </View>

      <SectionHeader title="Previous Tenants" />
      {room.previousTenants.length === 0 ? (
        <Card className="flex-row items-center gap-3">
          <Icon icon={History} tone="muted" />
          <Text tone="soft" className="flex-1">No previous tenants for this room yet.</Text>
        </Card>
      ) : (
        <Card padded={false}>
          {room.previousTenants.map((t, i) => (
            <Pressable key={t.assignmentId} onPress={() => router.push({ pathname: '/tenants/[id]', params: { id: t.tenantId } } as never)} className={`px-4 py-3 active:bg-surface-muted ${i < room.previousTenants.length - 1 ? 'border-b border-line' : ''}`}>
              <Text variant="bodyMedium">{t.fullName}</Text>
              <Text variant="secondary" tone="soft">{formatMonthShort(t.startDate)} to {t.endDate ? formatMonthShort(t.endDate) : 'present'} · {formatINR(t.agreedRent)} / month</Text>
              <Text variant="caption" tone="muted">Moved in {formatDate(t.startDate)}</Text>
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}
