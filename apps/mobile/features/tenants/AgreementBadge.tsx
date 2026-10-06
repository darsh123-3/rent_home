import { CircleCheck, CircleX, Clock } from 'lucide-react-native';
import { View } from 'react-native';
import { Icon, Text } from '@/components/ui';
import type { AgreementInfo } from '@/types/api';
import { formatDate } from '@/utils/format';

/**
 * Rental agreement validity: a green tick while valid (the end date included), red once the end date has passed,
 * grey before it starts. Shape and text carry the meaning, not only the colour. Nothing for stays without an end date.
 */
export function AgreementBadge({ agreement, compact }: { agreement: AgreementInfo | null | undefined; compact?: boolean }) {
  if (!agreement || agreement.agreementStatus === 'NONE') return null;
  const { agreementStatus: status, agreementStartDate: start, agreementEndDate: end } = agreement;
  const view =
    status === 'VALID' ? { icon: CircleCheck, tone: 'success' as const, text: `Agreement valid till ${formatDate(end)}`, short: `Valid till ${formatDate(end)}` }
      : status === 'EXPIRED' ? { icon: CircleX, tone: 'danger' as const, text: `Agreement expired on ${formatDate(end)}`, short: `Expired ${formatDate(end)}` }
        : { icon: Clock, tone: 'muted' as const, text: `Agreement starts ${formatDate(start)}`, short: `Starts ${formatDate(start)}` };
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={view.text} className="flex-row items-center gap-1.5">
      <Icon icon={view.icon} size="sm" tone={view.tone} />
      <Text variant="secondaryMedium" tone={view.tone === 'muted' ? 'soft' : view.tone}>{compact ? view.short : view.text}</Text>
    </View>
  );
}
