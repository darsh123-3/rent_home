import { useLocalSearchParams, useRouter } from 'expo-router';
import { DoorOpen, LogOut, MessageCircle, Pencil, Phone, TrendingUp, UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Badge, Button, Card, Chip, DetailRow, ErrorState, Header, Icon, Screen, SectionHeader, SkeletonList, Text } from '@/components/ui';
import { BillsSection } from '@/features/bills/BillsSection';
import { DocumentsSection } from '@/features/documents/DocumentsSection';
import { PaymentsSection } from '@/features/payments/PaymentsSection';
import { AgreementBadge } from '@/features/tenants/AgreementBadge';
import { useTenant } from '@/features/tenants/api';
import { ChangeRentSheet } from '@/features/tenants/ChangeRentSheet';
import { ElectricityHistory } from '@/features/tenants/ElectricityHistory';
import { ElectricitySheet } from '@/features/tenants/ElectricitySheet';
import { callPhone, openWhatsApp } from '@/features/tenants/contact';
import { SecurityDepositSection } from '@/features/tenants/SecurityDepositSection';
import { Avatar } from '@/features/tenants/TenantCard';
import { formatDate, formatINR, formatMonthShort } from '@/utils/format';

const SECTIONS = ['Overview', 'Documents', 'Bills', 'Payments', 'Electricity', 'Room History'] as const;
type Section = (typeof SECTIONS)[number];

export default function TenantProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: t, isLoading, isError, error, refetch, isRefetching } = useTenant(id);
  const [section, setSection] = useState<Section>('Overview');
  const [rentOpen, setRentOpen] = useState(false);
  const [elecOpen, setElecOpen] = useState(false);

  if (isLoading) return <Screen><Header title="Tenant" /><SkeletonList count={3} /></Screen>;
  if (isError || !t) return <Screen><Header title="Tenant" /><ErrorState error={error} onRetry={refetch} /></Screen>;

  const a = t.currentAssignment;
  const summary = a ?? t.lastAssignment;
  const edit = (
    <Pressable onPress={() => router.push({ pathname: '/tenants/edit', params: { id } })} accessibilityRole="button" accessibilityLabel="Edit tenant" hitSlop={8} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-muted">
      <Icon icon={Pencil} tone="ink" />
    </Pressable>
  );

  return (
    <Screen refreshing={isRefetching} onRefresh={refetch}>
      <Header title="Tenant" right={edit} />

      <Card className="items-center gap-1 py-5">
        <Avatar name={t.fullName} size={64} />
        <Text variant="title" className="mt-2 text-center">{t.fullName}</Text>
        <Text tone="soft">{a ? `Room ${a.room.roomNumber}` : 'No room assigned'} · {t.property.name}</Text>
        {t.status === 'MOVED_OUT' ? <View className="mt-1"><Badge label="Moved out" tone="neutral" /></View> : null}
        {a ? <View className="mt-1"><AgreementBadge agreement={a} /></View> : null}
        {t.phone ? (
          <View className="mt-4 w-full flex-row gap-3">
            <View className="flex-1"><Button label="Call" icon={Phone} variant="secondary" onPress={() => callPhone(t.phone)} /></View>
            <View className="flex-1"><Button label="WhatsApp" icon={MessageCircle} variant="secondary" onPress={() => openWhatsApp(t.phone)} /></View>
          </View>
        ) : (
          <View className="mt-4 w-full"><Button label="Add phone number" icon={Phone} variant="secondary" onPress={() => router.push({ pathname: '/tenants/edit', params: { id } })} /></View>
        )}
      </Card>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-4 flex-grow-0" contentContainerClassName="gap-2">
        {SECTIONS.map((s) => <Chip key={s} label={s} selected={section === s} onPress={() => setSection(s)} />)}
      </ScrollView>

      {section === 'Overview' ? (
        <>
          <Card className="mt-4">
            <DetailRow label="Monthly Rent" value={summary ? formatINR(summary.agreedRent) : '-'} />
            <DetailRow label="Agreed security deposit" value={summary ? formatINR(summary.securityDeposit) : '-'} />
            {a ? <DetailRow label="Agreement" value={a.agreementStartDate || a.agreementEndDate ? `${a.agreementStartDate ? formatDate(a.agreementStartDate) : '...'} to ${a.agreementEndDate ? formatDate(a.agreementEndDate) : '...'}` : 'Dates not added'} /> : null}
            {a ? (
              <DetailRow label="Electricity" value={a.electricityMode === 'METER' ? `${formatINR(a.ratePerUnit)} / unit` : a.electricityMode === 'FIXED' ? `Fixed ${formatINR(a.fixedElectricity)}` : 'Not charged'} />
            ) : null}
            {a ? <Pressable onPress={() => setElecOpen(true)} accessibilityRole="button" hitSlop={8} className="-mt-1 mb-1 self-end"><Text variant="secondaryMedium" tone="primary">Change electricity rate</Text></Pressable> : null}
            <DetailRow label="Outstanding" value={t.outstanding > 0 ? formatINR(t.outstanding) : 'Nil'} tone={t.outstanding > 0 ? 'danger' : 'success'} />
            <DetailRow label="Move-in" value={formatDate(summary?.startDate ?? t.joiningDate)} last />
          </Card>

          <View className="mt-4 gap-3">
            {a ? (
              <View className="flex-row gap-3">
                <View className="flex-1"><Button label="Change Rent" icon={TrendingUp} variant="secondary" onPress={() => setRentOpen(true)} /></View>
                <View className="flex-1"><Button label="Move Out" icon={LogOut} variant="danger" onPress={() => router.push({ pathname: '/tenants/move-out', params: { id: t.id } })} /></View>
              </View>
            ) : t.status === 'ACTIVE' || t.status === 'MOVED_OUT' ? (
              <Button label="Assign Room" icon={UserPlus} onPress={() => router.push({ pathname: '/tenants/assign', params: { id: t.id } })} />
            ) : null}
          </View>

          {t.securityDeposit ? <SecurityDepositSection deposit={t.securityDeposit} /> : null}

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
              <Card padded={false}>
                {a.rents.map((r, i) => (
                  <View key={r.id} className={`flex-row items-center justify-between px-4 py-3 ${i < a.rents.length - 1 ? 'border-b border-line' : ''}`}>
                    <Text tone="soft">From {formatMonthShort(r.effectiveFrom)}</Text>
                    <Text variant="bodyMedium">{formatINR(r.amount)}</Text>
                  </View>
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
        <View className="mt-4 gap-3">
          {t.roomHistory.length === 0 ? (
            <Card className="flex-row items-center gap-3"><Icon icon={DoorOpen} tone="muted" /><Text tone="soft" className="flex-1">This tenant has not been assigned a room yet.</Text></Card>
          ) : (
            t.roomHistory.map((h) => (
              <Card key={h.assignmentId} className="gap-1">
                <View className="flex-row items-center justify-between">
                  <Text variant="heading">Room {h.room.roomNumber}</Text>
                  <Badge label={h.status === 'ACTIVE' ? 'Current' : 'Closed'} tone={h.status === 'ACTIVE' ? 'success' : 'neutral'} />
                </View>
                <Text tone="soft">{formatDate(h.startDate)} to {h.endDate ? formatDate(h.endDate) : 'Present'}</Text>
                <Text variant="secondary" tone="soft">{formatINR(h.agreedRent)} / month · Agreed deposit {formatINR(h.securityDeposit)}</Text>
                {h.moveOutNotes ? <Text variant="secondary" tone="muted">{h.moveOutNotes}</Text> : null}
              </Card>
            ))
          )}
        </View>
      ) : null}

      {a ? <ElectricitySheet key={`${a.id}-${a.ratePerUnit}-${a.electricityMode}`} visible={elecOpen} onClose={() => setElecOpen(false)} assignmentId={a.id} mode={a.electricityMode} ratePerUnit={a.ratePerUnit} fixedElectricity={a.fixedElectricity} /> : null}
      {a ? <ChangeRentSheet visible={rentOpen} onClose={() => setRentOpen(false)} assignmentId={a.id} currentRent={a.agreedRent} startDate={a.startDate} /> : null}
    </Screen>
  );
}
