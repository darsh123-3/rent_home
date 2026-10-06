import { z } from 'zod';
import { today } from '@/utils/format';
import { optionalMoneyString, orUndefined, toNumber, toOptionalNumber } from '@/utils/validation';

const phone = z.string().trim().refine((v) => /^\+?[0-9]{10,15}$/.test(v.replace(/[\s-]/g, '')), 'Enter a valid phone number');
const optionalPhone = z.string().trim().refine((v) => v === '' || /^\+?[0-9]{10,15}$/.test(v.replace(/[\s-]/g, '')), 'Enter a valid phone number');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Select a date');
const optionalDate = z.string().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Select a date');

export const tenantFormSchema = z.object({
  // Personal
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  joiningDate: isoDate,
  occupation: z.string().trim().max(120),
  notes: z.string().trim().max(1000),
  // Contact
  phone,
  alternatePhone: optionalPhone,
  email: z.string().trim().refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address'),
  permanentAddress: z.string().trim().max(300),
  currentAddress: z.string().trim().max(300),
  emergencyContact: z.string().trim().max(120),
  emergencyPhone: optionalPhone,
  // Room & rent
  roomId: z.string(),
  startDate: z.string(),
  agreedRent: z.string().trim(),
  securityDeposit: optionalMoneyString,
  electricityMode: z.enum(['METER', 'FIXED', 'NONE']),
  ratePerUnit: optionalMoneyString,
  fixedElectricity: optionalMoneyString,
  initialMeterReading: optionalMoneyString,
  openingBalance: optionalMoneyString,
  // Deposit already received at move-in (saved as the first deposit entry) and the rental agreement dates
  depositReceived: optionalMoneyString,
  depositReceivedOn: optionalDate,
  agreementStartDate: optionalDate,
  agreementEndDate: optionalDate,
});
export type TenantForm = z.infer<typeof tenantFormSchema>;

export const emptyTenantForm: TenantForm = {
  fullName: '', joiningDate: '', occupation: '', notes: '', phone: '', alternatePhone: '', email: '', permanentAddress: '', currentAddress: '',
  emergencyContact: '', emergencyPhone: '', roomId: '', startDate: '', agreedRent: '', securityDeposit: '', electricityMode: 'METER',
  ratePerUnit: '', fixedElectricity: '', initialMeterReading: '', openingBalance: '', depositReceived: '', depositReceivedOn: '', agreementStartDate: '', agreementEndDate: '',
};

export const STEP_FIELDS: Record<string, (keyof TenantForm)[]> = {
  Personal: ['fullName', 'joiningDate', 'occupation', 'notes'],
  Contact: ['phone', 'alternatePhone', 'email', 'permanentAddress', 'currentAddress', 'emergencyContact', 'emergencyPhone'],
  Documents: [],
  Room: ['roomId'],
  'Rent & Deposit': ['startDate', 'agreedRent', 'securityDeposit', 'electricityMode', 'ratePerUnit', 'fixedElectricity', 'initialMeterReading', 'openingBalance', 'depositReceived', 'depositReceivedOn', 'agreementStartDate', 'agreementEndDate'],
  Review: [],
};

const strip = (p?: string) => (p ? p.replace(/[\s-]/g, '') : undefined);

export function tenantPayload(v: TenantForm, propertyId?: string) {
  return {
    fullName: v.fullName, phone: strip(v.phone), alternatePhone: strip(orUndefined(v.alternatePhone)), email: orUndefined(v.email),
    permanentAddress: orUndefined(v.permanentAddress), currentAddress: orUndefined(v.currentAddress), emergencyContact: orUndefined(v.emergencyContact),
    emergencyPhone: strip(orUndefined(v.emergencyPhone)), occupation: orUndefined(v.occupation), joiningDate: v.joiningDate, notes: orUndefined(v.notes),
    ...(propertyId ? { propertyId } : {}),
  };
}

export const assignmentPayload = (v: TenantForm) => ({
  roomId: v.roomId, startDate: v.startDate || v.joiningDate, agreedRent: toNumber(v.agreedRent), securityDeposit: toOptionalNumber(v.securityDeposit) ?? 0,
  electricityMode: v.electricityMode,
  ratePerUnit: v.electricityMode === 'METER' ? toOptionalNumber(v.ratePerUnit) : undefined,
  fixedElectricity: v.electricityMode === 'FIXED' ? toOptionalNumber(v.fixedElectricity) : undefined,
  initialMeterReading: v.electricityMode === 'METER' ? toOptionalNumber(v.initialMeterReading) : undefined,
  openingBalance: toOptionalNumber(v.openingBalance),
  depositReceived: toOptionalNumber(v.depositReceived),
  depositReceivedOn: toOptionalNumber(v.depositReceived) ? orUndefined(v.depositReceivedOn) : undefined,
  agreementStartDate: orUndefined(v.agreementStartDate),
  agreementEndDate: orUndefined(v.agreementEndDate),
});

/** Checks across fields that the schema cannot express (it is reused with pick and partial). */
export function assignmentFieldErrors(v: Pick<TenantForm, 'depositReceived' | 'depositReceivedOn' | 'agreementStartDate' | 'agreementEndDate'>) {
  const errors: { field: 'depositReceivedOn' | 'agreementEndDate'; message: string }[] = [];
  if (v.agreementStartDate && v.agreementEndDate && v.agreementEndDate < v.agreementStartDate) errors.push({ field: 'agreementEndDate', message: 'Agreement end date cannot be before the start date' });
  if (toOptionalNumber(v.depositReceived) && (v.depositReceivedOn ?? '') > today()) errors.push({ field: 'depositReceivedOn', message: 'Received date cannot be in the future' });
  return errors;
}
