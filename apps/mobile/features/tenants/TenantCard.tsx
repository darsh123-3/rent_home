import { DoorOpen } from 'lucide-react-native';
import { View } from 'react-native';
import { Badge, Card, Icon, Text } from '@/components/ui';
import { formatINR, initials } from '@/utils/format';
import type { TenantListItem } from '@/types/api';
import { AgreementBadge } from './AgreementBadge';

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <View className="items-center justify-center rounded-full bg-primary-soft" style={{ width: size, height: size }}>
      <Text variant="bodyMedium" tone="primary" className="font-semibold" style={{ fontSize: size * 0.36 }}>{initials(name)}</Text>
    </View>
  );
}

export function TenantCard({ tenant, onPress }: { tenant: TenantListItem; onPress: () => void }) {
  const movedOut = tenant.status === 'MOVED_OUT';
  return (
    <Card onPress={onPress} className="flex-row gap-3">
      <Avatar name={tenant.fullName} />
      <View className="flex-1 gap-1">
        <View className="flex-row items-start justify-between gap-2">
          <Text variant="heading" className="flex-1" numberOfLines={1}>{tenant.fullName}</Text>
          {movedOut ? <Badge label="Moved out" tone="neutral" /> : tenant.balance > 0 ? <Badge label="Pending" tone="danger" /> : <Badge label="Paid" tone="success" />}
        </View>
        <View className="flex-row items-center gap-1.5">
          <Icon icon={DoorOpen} size="sm" tone="muted" />
          <Text variant="secondary" tone="soft">{tenant.room ? `Room ${tenant.room.roomNumber}` : 'No room assigned'}</Text>
        </View>
        {!movedOut ? (
          <View className="mt-1 flex-row items-center justify-between">
            <Text variant="secondary" tone="soft">{tenant.monthlyRent != null ? `${formatINR(tenant.monthlyRent)} / month` : '-'}</Text>
            {tenant.balance > 0 ? <Text variant="bodyMedium" tone="danger" className="font-semibold">{formatINR(tenant.balance)} pending</Text> : null}
          </View>
        ) : null}
        {!movedOut ? <AgreementBadge agreement={tenant.agreement} compact /> : null}
      </View>
    </Card>
  );
}
