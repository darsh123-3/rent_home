import { DoorOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar, Badge, Card, Icon } from '@/components/ui';
import { formatINR } from '@/utils/format';
import type { TenantListItem } from '@rental/shared';
import { AgreementBadge } from './AgreementBadge';

export function TenantCard({ tenant }: { tenant: TenantListItem }) {
  const movedOut = tenant.status === 'MOVED_OUT';
  return (
    <Card padded={false}>
      <Link to={`/tenants/${tenant.id}`} className="flex gap-3 p-4">
        <Avatar name={tenant.fullName} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <span className="truncate text-heading">{tenant.fullName}</span>
            {movedOut ? <Badge label="Moved out" tone="neutral" /> : tenant.balance > 0 ? <Badge label="Pending" tone="danger" /> : <Badge label="Paid" tone="success" />}
          </div>
          <div className="flex items-center gap-1.5 text-small text-ink-soft"><Icon icon={DoorOpen} size={16} tone="muted" />{tenant.room ? `Room ${tenant.room.roomNumber}` : 'No room assigned'}</div>
          {!movedOut ? (
            <div className="flex items-center justify-between pt-1 text-small text-ink-soft">
              <span>{tenant.monthlyRent != null ? `${formatINR(tenant.monthlyRent)} / month` : '-'}</span>
              {tenant.balance > 0 ? <span className="font-semibold text-danger">{formatINR(tenant.balance)} pending</span> : null}
            </div>
          ) : null}
          {!movedOut ? <AgreementBadge agreement={tenant.agreement} compact /> : null}
        </div>
      </Link>
    </Card>
  );
}
