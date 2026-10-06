import { View } from 'react-native';
import { Card, Icon, Text } from '@/components/ui';
import type { PaymentListItem } from '@/types/api';
import { formatINR, formatMonthShort, formatShortDate } from '@/utils/format';
import { METHODS, METHOD_LABEL } from './constants';

export function PaymentRow({ payment, showTenant = true, onPress }: { payment: PaymentListItem; showTenant?: boolean; onPress?: () => void }) {
  const method = METHODS.find((m) => m.value === payment.method)!;
  return (
    <Card onPress={onPress} className="flex-row items-center gap-3">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft"><Icon icon={method.icon} tone="primary" /></View>
      <View className="flex-1">
        <Text variant="bodyMedium" numberOfLines={1}>{showTenant ? payment.tenant.fullName : `${formatMonthShort(payment.bill.billingPeriod)} bill`}</Text>
        <Text variant="secondary" tone="soft" numberOfLines={1}>
          {METHOD_LABEL[payment.method]} · Room {payment.bill.room.roomNumber}{payment.reference ? ` · ${payment.reference}` : ''}
        </Text>
      </View>
      <View className="items-end">
        <Text variant="heading" tone="success">{formatINR(payment.amount)}</Text>
        <Text variant="caption" tone="muted">Received {formatShortDate(payment.paymentDate)}</Text>
      </View>
    </Card>
  );
}
