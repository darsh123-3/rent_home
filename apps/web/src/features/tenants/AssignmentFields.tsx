import { Check, DoorOpen } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { Card, DateInput, EmptyState, Field, Icon, Input, MoneyInput, Segmented, Skeleton } from '@/components/ui';
import { useProperty } from '@/features/properties/PropertyProvider';
import { useRooms } from '@/features/rooms/api';
import { cn } from '@/utils/cn';
import { formatINR, today } from '@/utils/format';
import type { Room } from '@rental/shared';
import type { TenantForm } from './schemas';

/** Vacant rooms of the active property. Picking one pre-fills rent and electricity from the room's defaults. */
export function RoomPicker() {
  const { control, setValue } = useFormContext<TenantForm>();
  const { current } = useProperty();
  const q = useRooms({ propertyId: current?.id, status: 'VACANT' });
  const rooms: Room[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  const roomId = useWatch({ control, name: 'roomId' });

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

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>;
  if (rooms.length === 0) return <EmptyState icon={DoorOpen} title="No vacant rooms" message="All rooms are occupied or under maintenance. You can still save the tenant and assign a room later." />;
  return (
    <Controller control={control} name="roomId" render={({ field }) => (
      <div role="radiogroup" className="grid gap-2.5 sm:grid-cols-2">
        {rooms.map((r) => {
          const selected = field.value === r.id;
          return (
            <button key={r.id} type="button" role="radio" aria-checked={selected} onClick={() => field.onChange(selected ? '' : r.id)} className="text-left">
              <Card className={cn('flex items-center gap-3', selected && 'border-primary bg-primary-soft')}>
                <span className={cn('flex h-10 w-10 items-center justify-center rounded-md', selected ? 'bg-primary' : 'bg-surface-muted')}><Icon icon={selected ? Check : DoorOpen} tone={selected ? 'white' : 'soft'} /></span>
                <span><span className="block text-heading">Room {r.roomNumber}</span><span className="block text-small text-ink-soft">{formatINR(r.defaultRent)} / month{r.floor ? ` · ${r.floor}` : ''}</span></span>
              </Card>
            </button>
          );
        })}
      </div>
    )} />
  );
}

export function RentFields({ showMoveIn = true }: { showMoveIn?: boolean }) {
  const { control, register, formState: { errors } } = useFormContext<TenantForm>();
  const mode = useWatch({ control, name: 'electricityMode' });
  const depositReceived = useWatch({ control, name: 'depositReceived' });
  return (
    <div className="space-y-4">
      {showMoveIn ? <DateInput label="Move-in Date" error={errors.startDate?.message} {...register('startDate')} /> : null}
      <MoneyInput label="Monthly Rent" error={errors.agreedRent?.message} {...register('agreedRent')} />
      <MoneyInput label="Agreed Security Deposit" hint="Optional" error={errors.securityDeposit?.message} {...register('securityDeposit')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyInput label="Deposit Received" hint="Optional. Amount already received" error={errors.depositReceived?.message} {...register('depositReceived')} />
        {depositReceived && Number(depositReceived) > 0 ? <DateInput label="Received On" max={today()} error={errors.depositReceivedOn?.message} {...register('depositReceivedOn')} /> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <DateInput label="Agreement Start Date" hint="Optional" error={errors.agreementStartDate?.message} {...register('agreementStartDate')} />
        <DateInput label="Agreement End Date" hint="Optional. Shows a green tick until this date" error={errors.agreementEndDate?.message} {...register('agreementEndDate')} />
      </div>
      <Field label="Electricity">
        <Controller control={control} name="electricityMode" render={({ field }) => <Segmented value={field.value} onChange={field.onChange} options={[{ value: 'METER', label: 'Meter' }, { value: 'FIXED', label: 'Fixed' }, { value: 'NONE', label: 'None' }]} />} />
      </Field>
      {mode === 'METER' ? (
        <>
          <MoneyInput label="Rate per Unit" error={errors.ratePerUnit?.message} {...register('ratePerUnit')} />
          <Input label="Opening Meter Reading" placeholder="0" inputMode="decimal" hint="The reading on the day the tenant moves in" error={errors.initialMeterReading?.message} {...register('initialMeterReading')} />
        </>
      ) : null}
      {mode === 'FIXED' ? <MoneyInput label="Fixed Monthly Electricity" error={errors.fixedElectricity?.message} {...register('fixedElectricity')} /> : null}
      <MoneyInput label="Outstanding from before" hint="Optional. Amount already owed before using this app; it is added to the first bill." error={errors.openingBalance?.message} {...register('openingBalance')} />
    </div>
  );
}
