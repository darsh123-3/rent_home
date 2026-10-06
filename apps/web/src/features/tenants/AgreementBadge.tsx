import { CircleCheck, CircleX, Clock } from 'lucide-react';
import { Icon } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/format';
import type { AgreementInfo } from '@rental/shared';

/**
 * Rental agreement validity: a green tick while valid (the end date included), red once the end date has passed,
 * grey before it starts. Shape and text carry the meaning, not only the colour. Nothing for stays without an end date.
 */
export function AgreementBadge({ agreement, compact, className }: { agreement: AgreementInfo | null | undefined; compact?: boolean; className?: string }) {
  if (!agreement || agreement.agreementStatus === 'NONE') return null;
  const { agreementStatus: status, agreementStartDate: start, agreementEndDate: end } = agreement;
  const view =
    status === 'VALID' ? { icon: CircleCheck, tone: 'success' as const, text: `Agreement valid till ${formatDate(end)}`, short: `Valid till ${formatDate(end)}` }
      : status === 'EXPIRED' ? { icon: CircleX, tone: 'danger' as const, text: `Agreement expired on ${formatDate(end)}`, short: `Expired ${formatDate(end)}` }
        : { icon: Clock, tone: 'muted' as const, text: `Agreement starts ${formatDate(start)}`, short: `Starts ${formatDate(start)}` };
  return (
    <span role="img" aria-label={view.text} title={view.text}
      className={cn('inline-flex items-center gap-1.5 text-small font-medium', view.tone === 'success' ? 'text-success' : view.tone === 'danger' ? 'text-danger' : 'text-ink-soft', className)}>
      <Icon icon={view.icon} size={compact ? 16 : 18} tone={view.tone} />
      <span aria-hidden="true">{compact ? view.short : view.text}</span>
    </span>
  );
}
