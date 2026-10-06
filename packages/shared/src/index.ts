export const ROOM_STATUSES = ['OCCUPIED', 'VACANT', 'MAINTENANCE'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const TENANT_STATUSES = ['ACTIVE', 'MOVED_OUT'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const DOCUMENT_TYPES = ['AADHAAR', 'PAN', 'RENTAL_AGREEMENT', 'OTHER'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const ELECTRICITY_MODES = ['METER', 'FIXED', 'NONE'] as const;
export type ElectricityMode = (typeof ELECTRICITY_MODES)[number];

export const BILL_STATUSES = ['DRAFT', 'GENERATED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const PAYMENT_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CHARGE_TYPES = [
  'MAINTENANCE', 'WATER', 'CLEANING', 'INTERNET', 'PARKING', 'REPAIR', 'LATE_FEE', 'OTHER', 'MNGL_GAS',
] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

/** Monthly charges with their own line on every bill, in this order after electricity. */
export const MONTHLY_CHARGE_TYPES = ['WATER', 'CLEANING', 'MNGL_GAS', 'INTERNET'] as const;
export type MonthlyChargeType = (typeof MONTHLY_CHARGE_TYPES)[number];
export const isMonthlyCharge = (t: string): t is MonthlyChargeType => (MONTHLY_CHARGE_TYPES as readonly string[]).includes(t);

/** How each charge category is named on bills, forms and reports. CLEANING is shown as Housekeeping and INTERNET as WiFi. */
export const CHARGE_LABELS: Record<ChargeType, string> = {
  WATER: 'Water bill', CLEANING: 'Housekeeping', MNGL_GAS: 'MNGL fuel bill', INTERNET: 'WiFi connection',
  MAINTENANCE: 'Maintenance', PARKING: 'Parking', REPAIR: 'Repair', LATE_FEE: 'Late fee', OTHER: 'Other',
};

/** Rental agreement validity, computed by the API from the agreement dates and today's India date. */
export const AGREEMENT_STATUSES = ['VALID', 'EXPIRED', 'NOT_STARTED', 'NONE'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export interface ApiSuccess<T> { success: true; data: T; message?: string }
export interface ApiFailure { success: false; message: string; errors?: Record<string, string[]> }
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface Paginated<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }

export * from './api-types';
