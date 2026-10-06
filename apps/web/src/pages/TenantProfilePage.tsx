import { DoorOpen, LogOut, MessageCircle, Pencil, Phone, Trash2, TrendingUp, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { friendlyError } from '@/api/client';
import { Avatar, Badge, Card, Chip, ChipRow, ConfirmDialog, DetailRow, Notice, ErrorState, Icon, LinkButton, SectionHeader, SkeletonList } from '@/components/ui';
import { Page } from '@/components/layout/Page';
import { BillsSection } from '@/features/bills/BillsSection';
import { DocumentsSection } from '@/features/documents/DocumentsSection';
import { PaymentsSection } from '@/features/payments/PaymentsSection';
import { useDeleteTenant, useTenant } from '@/features/tenants/api';
import { ChangeRentModal } from '@/features/tenants/ChangeRentModal';
import { ElectricityHistory } from '@/features/tenants/ElectricityHistory';
import { AgreementBadge } from '@/features/tenants/AgreementBadge';
import { ElectricityModal } from '@/features/tenants/ElectricityModal';
import { SecurityDepositCard } from '@/features/tenants/SecurityDepositCard';
import { telUrl, whatsappUrl } from '@/features/tenants/contact';
import { formatDate, formatINR, formatMonthShort } from '@/utils/format';

const SECTIONS = ['Overview', 'Documents', 'Bills', 'Payments', 'Electricity', 'Room History'] as const;
type Section = (typeof SECTIONS)[number];

export function TenantProfilePage() {
  const { id } = useParams();
  const { data: t, isLoading, isError, error, refetch } = useTenant(id);
  const [section, setSection] = useState<Section>('Overview');
  const [rentOpen, setRentOpen] = useState(false);
  const [elecOpen, setElecOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const navigate = useNavigate();
  const del = useDeleteTenant(id ?? '');

  if (isLoading) return <Page title="Tenant" back="/tenants"><SkeletonList count={3} /></Page>;
  if (isError || !t) return <Page title="Tenant" back="/tenants"><ErrorState error={error} onRetry={() => void refetch()} /></Page>;

  const a = t.currentAssignment;
  const summary = a ?? t.lastAssignment;
  return (
    <Page title="Tenant" back="/tenants" actions={<Link to={`/tenants/${t.id}/edit`} aria-label="Edit tenant" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-muted"><Icon icon={Pencil} tone="ink" /></Link>}>
      <Card className="flex flex-col items-center gap-1 py-5">
        <Avatar name={t.fullName} size={64} />
        <h2 className="mt-2 text-center text-title">{t.fullName}</h2>
        <p className="text-ink-soft">{a ? `Room ${a.room.roomNumber}` : 'No room assigned'} · {t.property.name}</p>
        {t.status === 'MOVED_OUT' ? <div className="mt-1"><Badge label="Moved out" tone="neutral" /></div> : null}
        {a ? <AgreementBadge agreement={a} className="mt-1" /> : null}
        <div className="mt-4 flex w-full gap-3">
          {t.phone ? (
            <>
              <a href={telUrl(t.phone)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-md border border-line-strong font-semibold hover:bg-surface-muted"><Icon icon={Phone} tone="ink" />Call</a>
              <a href={whatsappUrl(t.phone)} target="_blank" rel="noopener noreferrer" className="flex h-12 flex-1 items-center justify-center gap-2 rounded-md border border-line-strong font-semibold hover:bg-surface-muted"><Icon icon={MessageCircle} tone="ink" />WhatsApp</a>
            </>
          ) : <LinkButton to={`/tenants/${t.id}/edit`} icon={Phone} variant="secondary">Add phone number</LinkButton>}
        </div>
      </Card>

      <div className="mt-4"><ChipRow>{SECTIONS.map((s) => <Chip key={s} label={s} selected={section === s} onClick={() => setSection(s)} />)}</ChipRow></div>

      {section === 'Overview' ? (
        <>
          <Card className="mt-4">
            <DetailRow label="Monthly Rent" value={summary ? formatINR(summary.agreedRent) : '-'} />
            <DetailRow label="Agreed security deposit" value={summary ? formatINR(summary.securityDeposit) : '-'} />
            {a ? <DetailRow label="Agreement" value={a.agreementStartDate || a.agreementEndDate ? `${a.agreementStartDate ? formatDate(a.agreementStartDate) : '...'} to ${a.agreementEndDate ? formatDate(a.agreementEndDate) : '...'}` : 'Dates not added'} /> : null}
            {a ? (
              <div className="flex min-h-11 items-center justify-between gap-4 border-b border-line py-2.5">
                <span className="text-ink-soft">Electricity</span>
                <span className="flex items-center gap-3 text-right font-medium">
                  {a.electricityMode === 'METER' ? `${formatINR(a.ratePerUnit)} / unit` : a.electricityMode === 'FIXED' ? `Fixed ${formatINR(a.fixedElectricity)}` : 'Not charged'}
                  <button type="button" onClick={() => setElecOpen(true)} className="text-small font-medium text-primary">Change</button>
                </span>
              </div>
            ) : null}
            <DetailRow label="Outstanding" value={t.outstanding > 0 ? formatINR(t.outstanding) : 'Nil'} tone={t.outstanding > 0 ? 'danger' : 'success'} />
            <DetailRow label="Move-in" value={formatDate(summary?.startDate ?? t.joiningDate)} last />
          </Card>
          <div className="mt-4 space-y-3">
            {a ? (
              <div className="flex gap-3">
                <button type="button" onClick={() => setRentOpen(true)} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-line-strong font-semibold hover:bg-surface-muted"><Icon icon={TrendingUp} tone="ink" />Change Rent</button>
                <LinkButton to={`/tenants/${t.id}/move-out`} icon={LogOut} variant="danger">Move Out</LinkButton>
              </div>
            ) : (
              <>
                <LinkButton to={`/tenants/${t.id}/assign`} icon={UserPlus}>Assign Room</LinkButton>
                <button type="button" onClick={() => { setDeleteError(null); setDeleting(true); }} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-danger font-semibold text-danger hover:bg-surface-muted"><Icon icon={Trash2} tone="danger" />Delete Tenant</button>
                {deleteError ? <Notice tone="danger">{deleteError}</Notice> : null}
              </>
            )}
          </div>
          {t.securityDeposit ? <SecurityDepositCard deposit={t.securityDeposit} canAdd /> : null}
          <SectionHeader title="Contact" />
          <Card>
            <DetailRow label="Phone" value={t.phone || 'Not added'} />
            {t.alternatePhone ? <DetailRow label="Alternate" value={t.alternatePhone} /> : null}
            <DetailRow label="Email" value={t.email ?? '-'} />
            <DetailRow label="Occupation" value={t.occupation ?? '-'} />
            <DetailRow label="Emergency" value={t.emergencyContact ? `${t.emergencyContact}${t.emergencyPhone ? ` · ${t.emergencyPhone}` : ''}` : '-'} />
            <DetailRow label="Current address" value={t.currentAddress ?? '-'} />
            <DetailRow label="Permanent address" value={t.permanentAddress ?? '-'} last={!t.notes} />
            {t.notes ? <DetailRow label="Notes" value={t.notes} last /> : null}
          </Card>
          {a && a.rents.length > 0 ? (
            <>
              <SectionHeader title="Rent History" />
              <Card padded={false} className="overflow-hidden">
                {a.rents.map((r, i) => (
                  <div key={r.id} className={`flex items-center justify-between px-4 py-3 ${i < a.rents.length - 1 ? 'border-b border-line' : ''}`}><span className="text-ink-soft">From {formatMonthShort(r.effectiveFrom)}</span><span className="font-medium">{formatINR(r.amount)}</span></div>
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : null}

      {section === 'Documents' ? <DocumentsSection tenantId={t.id} /> : null}
      {section === 'Electricity' ? <ElectricityHistory tenantId={t.id} currentRate={a?.electricityMode === 'METER' ? a.ratePerUnit : null} /> : null}
      {section === 'Payments' ? <PaymentsSection tenantId={t.id} canPay={t.outstanding > 0} /> : null}
      {section === 'Bills' ? <BillsSection tenantId={t.id} canBill={!!t.currentAssignment} /> : null}

      {section === 'Room History' ? (
        <div className="mt-4 space-y-3">
          {t.roomHistory.length === 0 ? <Card className="flex items-center gap-3"><Icon icon={DoorOpen} tone="muted" /><span className="text-ink-soft">This tenant has not been assigned a room yet.</span></Card> : t.roomHistory.map((h) => (
            <Card key={h.assignmentId} className="space-y-1">
              <div className="flex items-center justify-between"><span className="text-heading">Room {h.room.roomNumber}</span><Badge label={h.status === 'ACTIVE' ? 'Current' : 'Closed'} tone={h.status === 'ACTIVE' ? 'success' : 'neutral'} /></div>
              <div className="text-ink-soft">{formatDate(h.startDate)} to {h.endDate ? formatDate(h.endDate) : 'Present'}</div>
              <div className="text-small text-ink-soft">{formatINR(h.agreedRent)} / month · Agreed deposit {formatINR(h.securityDeposit)}</div>
              {h.moveOutNotes ? <div className="text-small text-ink-muted">{h.moveOutNotes}</div> : null}
            </Card>
          ))}
        </div>
      ) : null}

      <ConfirmDialog open={deleting} title={`Delete ${t.fullName}?`} confirmLabel="Delete tenant" destructive loading={del.isPending}
        message="The tenant is removed from your lists. Their past bills and payments stay in your records and reports. This cannot be undone from the app."
        onConfirm={async () => { try { await del.mutateAsync(); setDeleting(false); navigate('/tenants', { replace: true }); } catch (e) { setDeleting(false); setDeleteError(friendlyError(e)); } }}
        onCancel={() => setDeleting(false)} />
      {a && elecOpen ? <ElectricityModal open onClose={() => setElecOpen(false)} assignmentId={a.id} mode={a.electricityMode} ratePerUnit={a.ratePerUnit} fixedElectricity={a.fixedElectricity} /> : null}
      {a && rentOpen ? <ChangeRentModal open onClose={() => setRentOpen(false)} assignmentId={a.id} currentRent={a.agreedRent} startDate={a.startDate} /> : null}
    </Page>
  );
}