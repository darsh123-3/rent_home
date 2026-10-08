import { Link } from 'react-router-dom';
import { Card, Icon } from '@/components/ui';
import type { PaymentListItem } from '@rental/shared';
import { formatINR, formatMonthShort, formatShortDate } from '@/utils/format';
import { METHODS, METHOD_LABEL } from './constants';

export function PaymentRow({ payment, showTenant = true }: { payment: PaymentListItem; showTenant?: boolean }) {
  const method = METHODS.find((m) => m.value === payment.method)!;
  return (
    <Card padded={false}>
      <Link to={`/bills/${payment.billId}`} className="flex items-center gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft"><Icon icon={method.icon} tone="primary" /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{showTenant ? payment.tenant.fullName : `${formatMonthShort(payment.bill.billingPeriod)} bill`}</div>
          <div className="truncate text-small text-ink-soft">{METHOD_LABEL[payment.method]} · Room {payment.bill.room.roomNumber}{payment.reference ? ` · ${payment.reference}` : ''}</div>
        </div>
        <div className="text-right">
          <div className={`text-heading ${payment.reversed ? 'text-ink-muted line-through' : 'text-success'}`}>{formatINR(payment.amount)}</div>
          <div className={`text-caption ${payment.reversed ? 'text-danger' : 'text-ink-muted'}`}>{payment.reversed ? 'Reversed' : `Received ${formatShortDate(payment.paymentDate)}`}</div>
        </div>
      </Link>
    </Card>
  );
}
