import { Banknote, History, Pencil, Receipt, UserPlus, UserRound } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Card, DetailRow, ErrorState, Icon, LinkButton, SectionHeader, SkeletonList } from '@/components/ui';
import { Page } from '@/components/layout/Page';
import { useRoom } from '@/features/rooms/api';
import { AgreementBadge } from '@/features/tenants/AgreementBadge';
import { ROOM_STATUS } from '@/features/rooms/status';
import { formatDate, formatINR, formatMonthShort } from '@/utils/format';

export function RoomDetailPage() {
  const { id } = useParams();
  const { data: room, isLoading, isError, error, refetch } = useRoom(id);
  if (isLoading) return <Page title="Room" back><SkeletonList count={3} /></Page>;
  if (isError || !room) return <Page title="Room" back><ErrorState error={error} onRetry={() => void refetch()} /></Page>;
  const status = ROOM_STATUS[room.status];
  const tenant = room.currentTenant;
  return (
    <Page title={`Room ${room.roomNumber}`} subtitle={room.property.name} back="/rooms" actions={<Link to={`/rooms/${room.id}/edit`} aria-label="Edit room" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-muted"><Icon icon={Pencil} tone="ink" /></Link>}>
      <Card>
        <div className="mb-1 flex items-center justify-between"><span className="text-caption text-ink-muted">STATUS</span><Badge label={status.label} tone={status.tone} /></div>
        <DetailRow label="Property" value={room.property.name} />
        <DetailRow label="Current Tenant" value={tenant ? <span className="flex flex-col items-end gap-0.5">{tenant.fullName}<AgreementBadge agreement={tenant} compact /></span> : 'None'} />
        <DetailRow label="Monthly Rent" value={formatINR(room.monthlyRent)} />
        <DetailRow label="Pending" value={tenant ? (room.balance > 0 ? formatINR(room.balance) : 'Paid') : '-'} tone={room.balance > 0 ? 'danger' : undefined} />
        <DetailRow label="Electricity" value={room.electricityMode === 'METER' ? `Meter, ${formatINR(room.ratePerUnit)} / unit` : room.electricityMode === 'FIXED' ? `Fixed ${formatINR(room.fixedElectricity)}` : 'Not charged'} last />
      </Card>
      <div className="mt-4 space-y-3">
        {tenant ? (
          <>
            <LinkButton to={`/tenants/${tenant.id}`} icon={UserRound} variant="secondary">View Tenant</LinkButton>
            <div className="flex gap-3">
              <LinkButton to={`/bills/new?tenantId=${tenant.id}`} icon={Receipt}>Generate Bill</LinkButton>
              <LinkButton to={`/payments/new?tenantId=${tenant.id}`} icon={Banknote} variant="secondary">Record Payment</LinkButton>
            </div>
          </>
        ) : room.status === 'VACANT' ? <LinkButton to={`/tenants/new?roomId=${room.id}`} icon={UserPlus}>Assign Tenant</LinkButton> : null}
      </div>
      <SectionHeader title="Previous Tenants" />
      {room.previousTenants.length === 0 ? (
        <Card className="flex items-center gap-3"><Icon icon={History} tone="muted" /><span className="text-ink-soft">No previous tenants for this room yet.</span></Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          {room.previousTenants.map((t, i) => (
            <Link key={t.assignmentId} to={`/tenants/${t.tenantId}`} className={`block px-4 py-3 hover:bg-surface-muted ${i < room.previousTenants.length - 1 ? 'border-b border-line' : ''}`}>
              <div className="font-medium">{t.fullName}</div>
              <div className="text-small text-ink-soft">{formatMonthShort(t.startDate)} to {t.endDate ? formatMonthShort(t.endDate) : 'present'} · {formatINR(t.agreedRent)} / month</div>
              <div className="text-caption text-ink-muted">Moved in {formatDate(t.startDate)}</div>
            </Link>
          ))}
        </Card>
      )}
    </Page>
  );
}
