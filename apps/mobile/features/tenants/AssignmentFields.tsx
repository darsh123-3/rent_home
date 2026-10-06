import { Check, DoorOpen } from 'lucide-react-native';
import { useEffect } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { Pressable, View } from 'react-native';
import { Card, DateField, EmptyState, Icon, MoneyField, SegmentedControl, Skeleton, Text, TextField } from '@/components/ui';
import { useProperty } from '@/features/properties/PropertyProvider';
import { useRooms } from '@/features/rooms/api';
import { cn } from '@/utils/cn';
import { formatINR, today } from '@/utils/format';
import type { Room } from '@/types/api';
import type { TenantForm } from './schemas';

/** Lists vacant rooms of the active property for selection. Pass `selectedRoomId` to keep a room visible. */
export function RoomPicker() {
  const { control, setValue } = useFormContext<TenantForm>();
  const { current } = useProperty();
  const q = useRooms({ propertyId: current?.id, status: 'VACANT' });
  const rooms: Room[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  const roomId = useWatch({ control, name: 'roomId' });

  // Selecting a room pre-fills rent and electricity from the room's defaults.
  useEffect(() => {
    const room = rooms.find((r) => r.id === roomId);
    if (room) {
      setValue('agreedRent', String(room.defaultRent), { shouldValidate: false });
      setValue('electricityMode', room.electricityMode);
      setValue('ratePerUnit', String(room.ratePerUnit ?? current?.defaultRatePerUnit ?? ''));
      setValue('fixedElectricity', room.fixedElectricity != null ? String(room.fixedElectricity) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, q.data]);

  if (q.isLoading) return <View className="gap-3"><Skeleton height={64} radius={16} /><Skeleton height={64} radius={16} /></View>;
  if (rooms.length === 0) return <EmptyState icon={DoorOpen} title="No vacant rooms" message="All rooms are occupied or under maintenance. You can still save the tenant and assign a room later." />;
  return (
    <Controller
      control={control}
      name="roomId"
      render={({ field }) => (
        <View className="gap-2.5">
          {rooms.map((r) => {
            const selected = field.value === r.id;
            return (
              <Pressable key={r.id} onPress={() => field.onChange(selected ? '' : r.id)} accessibilityRole="radio" accessibilityState={{ selected }}>
                <Card className={cn('flex-row items-center gap-3', selected && 'border-primary bg-primary-soft')}>
                  <View className={cn('h-10 w-10 items-center justify-center rounded-md', selected ? 'bg-primary' : 'bg-surface-muted')}>
                    <Icon icon={selected ? Check : DoorOpen} tone={selected ? 'white' : 'soft'} />
                  </View>
                  <View className="flex-1">
                    <Text variant="heading">Room {r.roomNumber}</Text>
                    <Text variant="secondary" tone="soft">{formatINR(r.defaultRent)} / month{r.floor ? ` · ${r.floor}` : ''}</Text>
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
    />
  );
}

export function RentFields({ showMoveIn = true }: { showMoveIn?: boolean }) {
  const { control, setValue } = useFormContext<TenantForm>();
  const mode = useWatch({ control, name: 'electricityMode' });
  const joiningDate = useWatch({ control, name: 'joiningDate' });
  const depositReceived = useWatch({ control, name: 'depositReceived' });
  return (
    <View className="gap-4">
      {showMoveIn ? (
        <Controller control={control} name="startDate" render={({ field, fieldState }) => (
          <DateField label="Move-in Date" value={field.value || joiningDate} onChange={field.onChange} error={fieldState.error?.message} />
        )} />
      ) : null}
      <MoneyField control={control} name="agreedRent" label="Monthly Rent" />
      <MoneyField control={control} name="securityDeposit" label="Agreed Security Deposit" hint="Optional" />
      <MoneyField control={control} name="depositReceived" label="Deposit Received" hint="Optional. Amount already received" />
      {depositReceived && Number(depositReceived) > 0 ? (
        <Controller control={control} name="depositReceivedOn" render={({ field, fieldState }) => (
          <DateField label="Received On" value={field.value || today()} onChange={field.onChange} maximumDate={new Date()} error={fieldState.error?.message} />
        )} />
      ) : null}
      <Controller control={control} name="agreementStartDate" render={({ field, fieldState }) => (
        <DateField label="Agreement Start Date (optional)" value={field.value || undefined} onChange={field.onChange} error={fieldState.error?.message} />
      )} />
      <Controller control={control} name="agreementEndDate" render={({ field, fieldState }) => (
        <DateField label="Agreement End Date (optional)" value={field.value || undefined} onChange={field.onChange} error={fieldState.error?.message} />
      )} />
      <View className="gap-1.5">
        <Text variant="label" tone="soft">Electricity</Text>
        <SegmentedControl value={mode} onChange={(v) => setValue('electricityMode', v)} options={[{ value: 'METER', label: 'Meter' }, { value: 'FIXED', label: 'Fixed' }, { value: 'NONE', label: 'None' }]} />
      </View>
      {mode === 'METER' ? (
        <>
          <MoneyField control={control} name="ratePerUnit" label="Rate per Unit" />
          <TextField control={control} name="initialMeterReading" label="Opening Meter Reading" placeholder="0" keyboardType="decimal-pad" hint="The reading on the day the tenant moves in" />
        </>
      ) : null}
      {mode === 'FIXED' ? <MoneyField control={control} name="fixedElectricity" label="Fixed Monthly Electricity" /> : null}
      <MoneyField control={control} name="openingBalance" label="Outstanding from before" hint="Optional. Amount already owed before using this app; it is added to the first bill." />
    </View>
  );
}
