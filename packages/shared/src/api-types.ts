/** Shapes returned by the REST API, shared by the mobile and web apps. */
import type { AgreementStatus, BillStatus, ChargeType, DocumentType, ElectricityMode, PaymentMethod, RoomStatus, TenantStatus } from './index';

/** Rental agreement validity of a stay. Dates are YYYY-MM-DD; daysLeft is negative once expired. */
export interface AgreementInfo {
  agreementStartDate: string | null;
  agreementEndDate: string | null;
  agreementStatus: AgreementStatus;
  agreementDaysLeft: number | null;
}

export interface DepositReceipt {
  id: string;
  amount: number;
  receivedOn: string;
  method: PaymentMethod;
  note: string | null;
  createdAt: string;
}

/** Security deposit of a stay. `agreed` is the agreed amount; the rest is computed from the receipts. Never part of a bill total. */
export interface SecurityDepositSummary {
  assignmentId: string;
  agreed: number;
  totalReceived: number;
  pending: number;
  lastReceivedOn: string | null;
  receipts: DepositReceipt[];
}

export interface Property {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  description: string | null;
  billPrefix: string;
  dueDayOfMonth: number;
  defaultRatePerUnit: number;
  billFooterNote: string | null;
  upiId: string | null;
  /** Landlord phone printed under the address on bills. */
  contactPhone: string | null;
  roomCount?: number;
  occupiedCount?: number;
}

export interface Room {
  id: string;
  propertyId: string;
  roomNumber: string;
  floor: string | null;
  status: RoomStatus;
  defaultRent: number;
  electricityMode: ElectricityMode;
  ratePerUnit: number | null;
  fixedElectricity: number | null;
  notes: string | null;
  monthlyRent: number;
  balance: number;
  currentTenant: { id: string; fullName: string; phone: string; assignmentId: string } | null;
}

export interface RoomDetail extends Omit<Room, 'currentTenant'> {
  property: { id: string; name: string };
  currentTenant: ({ id: string; fullName: string; phone: string; assignmentId: string; startDate: string; securityDeposit: number } & AgreementInfo) | null;
  previousTenants: { assignmentId: string; tenantId: string; fullName: string; startDate: string; endDate: string | null; agreedRent: number }[];
}

export interface TenantListItem {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  status: TenantStatus;
  joiningDate: string;
  room: { id: string; roomNumber: string } | null;
  assignmentId: string | null;
  monthlyRent: number | null;
  balance: number;
  /** Agreement of the current stay; null for tenants without an active room. */
  agreement: AgreementInfo | null;
}

export interface RentHistoryEntry { id: string; amount: number; effectiveFrom: string }

export interface TenantDetail {
  id: string;
  propertyId: string;
  fullName: string;
  phone: string;
  alternatePhone: string | null;
  email: string | null;
  permanentAddress: string | null;
  currentAddress: string | null;
  emergencyContact: string | null;
  emergencyPhone: string | null;
  occupation: string | null;
  joiningDate: string;
  notes: string | null;
  status: TenantStatus;
  property: { id: string; name: string };
  outstanding: number;
  documentTypes: DocumentType[];
  currentAssignment: ({
    id: string;
    room: { id: string; roomNumber: string };
    startDate: string;
    agreedRent: number;
    securityDeposit: number;
    electricityMode: ElectricityMode;
    ratePerUnit: number | null;
    fixedElectricity: number | null;
    initialMeterReading: number | null;
    rents: RentHistoryEntry[];
  } & AgreementInfo) | null;
  lastAssignment: { id: string; room: { id: string; roomNumber: string }; startDate: string; endDate: string | null; agreedRent: number; securityDeposit: number } | null;
  roomHistory: {
    assignmentId: string;
    room: { id: string; roomNumber: string };
    startDate: string;
    endDate: string | null;
    agreedRent: number;
    securityDeposit: number;
    status: 'ACTIVE' | 'CLOSED';
    finalMeterReading: number | null;
    moveOutNotes: string | null;
  }[];
  /** Deposit of the current stay, or of the last one after moving out. */
  securityDeposit: SecurityDepositSummary | null;
}

export interface TenantDocumentItem {
  id: string;
  tenantId: string;
  type: DocumentType;
  label: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BillListItem {
  id: string;
  billNumber: string;
  billingPeriod: string;
  dueDate: string;
  status: BillStatus;
  totalDue: number;
  paidAmount: number;
  balance: number;
  carriedForwardToId: string | null;
  /** First and last day of the billing month (YYYY-MM-DD). */
  billPeriodStart: string;
  billPeriodEnd: string;
  tenant: { id: string; fullName: string };
  room: { id: string; roomNumber: string };
}

export interface BillItemRow {
  id: string;
  type: 'RENT' | 'ELECTRICITY' | 'CHARGE' | 'LATE_FEE' | 'DISCOUNT' | 'PREVIOUS_BALANCE';
  description: string;
  amount: number;
  meta: Record<string, any> | null;
}

/** Set when the payment was undone (recorded by mistake, or moved to a corrected bill). It no longer counts. */
export interface PaymentReversal { on: string; reason: string | null }

export interface PaymentRow {
  id: string;
  billId: string;
  amount: number;
  paymentDate: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  reversed: PaymentReversal | null;
}

export interface BillDetail {
  id: string;
  billNumber: string;
  billingPeriod: string;
  dueDate: string;
  status: BillStatus;
  storedStatus: BillStatus;
  rentAmount: number;
  electricityAmount: number;
  otherChargesAmount: number;
  lateFee: number;
  discount: number;
  previousBalance: number;
  totalDue: number;
  paidAmount: number;
  balance: number;
  notes: string | null;
  createdAt: string;
  /** India calendar day the bill was generated (YYYY-MM-DD). */
  issuedOn: string;
  billPeriodStart: string;
  billPeriodEnd: string;
  /** Received date of the payment that settled the bill; null while a balance is open. */
  paidInFullOn: string | null;
  /** The most recent payment, shown while the bill is part paid. */
  lastPayment: { amount: number; paymentDate: string } | null;
  /** Informational only: never part of the bill total. Null when no deposit receipt is recorded. */
  securityDeposit: { totalReceived: number; lastReceivedOn: string | null } | null;
  /** Agreement of the tenant's stay while it is active; null after moving out. */
  agreement: AgreementInfo | null;
  items: BillItemRow[];
  payments: PaymentRow[];
  tenant: { id: string; fullName: string; phone: string };
  room: { id: string; roomNumber: string };
  property: { id: string; name: string; address: string; city: string; state: string; pincode: string; contactPhone: string | null };
  carriedInto: { id: string; billNumber: string } | null;
  absorbed: { id: string; billNumber: string; billingPeriod: string }[];
}

export interface BillPreview {
  assignmentId: string;
  tenant: { id: string; fullName: string };
  room: { id: string; roomNumber: string };
  billingPeriod: string;
  suggestedPeriod: string;
  dueDate: string;
  rent: number;
  /** The tenant's rent for the month from the rent history; `rent` differs when it was changed for this bill. */
  standardRent: number;
  /** Unpaid earlier bills (and any opening balance) before the owner's adjustment. */
  carriedBalance: number;
  previousBalanceAdjustment: number;
  electricity: {
    mode: ElectricityMode;
    previousReading: number | null;
    currentReading: number | null;
    units: number;
    ratePerUnit: number | null;
    calculatedAmount: number;
    amount: number;
    isOverride: boolean;
    needsReading: boolean;
    /** The rate stored for this stay (a rate typed for one bill does not change it). */
    defaultRatePerUnit: number | null;
  };
  charges: { type: ChargeType; name: string; amount: number; note?: string }[];
  totals: { rent: number; electricity: number; otherCharges: number; lateFee: number; discount: number; subtotal: number; previousBalance: number; totalDue: number };
  carriedBills: { id: string; billNumber: string; billingPeriod: string; balance: number }[];
  openingBalance: number;
  recurringCharges: { id: string; type: ChargeType; name: string; amount: number }[];
}

export interface PaymentListItem {
  id: string;
  billId: string;
  amount: number;
  paymentDate: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  reversed: PaymentReversal | null;
  tenant: { id: string; fullName: string };
  bill: { id: string; billNumber: string; billingPeriod: string; room: { roomNumber: string } };
}

export interface OpenBill {
  id: string;
  billNumber: string;
  billingPeriod: string;
  dueDate: string;
  status: BillStatus;
  totalDue: number;
  paidAmount: number;
  balance: number;
  label: string;
}

export interface PendingPayment {
  tenantId: string;
  fullName: string;
  phone: string;
  roomNumber: string;
  balance: number;
  billId: string;
  billCount: number;
  dueDate: string;
  overdueDays: number;
}

export interface DashboardData {
  username: string;
  properties: { id: string; name: string; city: string; state: string }[];
  property: { id: string; name: string; city: string; state: string } | null;
  collection: { month: string; monthLabel: string; expected: number; collected: number; paymentCount: number; pending: number; collectionRate: number } | null;
  occupancy: { totalRooms: number; occupied: number; vacant: number; maintenance: number; occupancyPercent: number } | null;
  pendingPayments: (PendingPayment & { tenantStatus?: TenantStatus })[];
  pendingCount?: number;
  /** People who have moved out but still owe money, largest first. */
  formerTenantDues?: (PendingPayment & { tenantStatus: TenantStatus })[];
  kpis?: DashboardKpis;
  recentPayments?: RecentPayment[];
}

export interface DashboardKpis {
  /** What this month's bills are made of, excluding arrears carried in. */
  composition: { rent: number; electricity: number; other: number; bills: number };
  trend: { month: string; label: string; expected: number; collected: number }[];
  dues: {
    total: number;
    currentTenants: { amount: number; count: number };
    formerTenants: { amount: number; count: number; oldestDue: string | null };
    overdue: { amount: number; count: number };
    dueSoon: { amount: number; count: number };
  };
  rentRoll: { monthly: number; tenants: number };
  vacancy: { rooms: number; lostRent: number; rentableOccupancyPercent: number };
  last7Days: { amount: number; count: number };
  /** Active tenants with no bill yet for the current calendar month. */
  /** Active tenants with no bill yet for `month`. */
  toBill: { month: string; monthLabel: string; count: number; tenants: { tenantId: string; tenantName: string; roomNumber: string }[] };
}

export interface RecentPayment {
  id: string;
  amount: number;
  paymentDate: string;
  method: PaymentMethod;
  billId: string;
  tenantId: string;
  tenantName: string;
  roomNumber: string;
}

export interface CollectionReport {
  month: string;
  monthLabel: string;
  expected: number;
  collected: number;
  paymentCount: number;
  pending: number;
  collectionRate: number;
  byMethod: { method: PaymentMethod; amount: number; count: number }[];
  /** Charge lines billed in the month, by category: WATER, CLEANING, MNGL_GAS, INTERNET and OTHER (every other charge). */
  byCategory: { category: 'WATER' | 'CLEANING' | 'MNGL_GAS' | 'INTERNET' | 'OTHER'; label: string; amount: number; count: number }[];
  trend: { month: string; label: string; expected: number; collected: number }[];
}

export interface OccupancyReport {
  totalRooms: number;
  occupied: number;
  vacant: number;
  maintenance: number;
  occupancyPercent: number;
  rentableOccupancyPercent: number;
  vacantRooms: { id: string; roomNumber: string; defaultRent: number }[];
  vacantRentPotential: number;
}

export interface OutstandingReport {
  total: number;
  count: number;
  items: (PendingPayment & { tenantStatus: TenantStatus })[];
  stats?: {
    currentTenants: { amount: number; count: number };
    formerTenants: { amount: number; count: number; oldestDue: string | null };
    overdue: { amount: number; count: number };
    dueSoon: { amount: number; count: number };
  };
}

export interface ElectricityRow {
  billId: string;
  billNumber: string;
  month: string;
  roomNumber: string;
  amount: number;
  /** Readings, units and rate are known only for bills made from a meter reading. */
  previousReading: number | null;
  currentReading: number | null;
  units: number | null;
  ratePerUnit: number | null;
  /** The amount was typed in (faulty meter, imported record) rather than calculated. */
  adjusted: boolean;
}

export interface TenantElectricity {
  rows: ElectricityRow[];
  summary: { months: number; totalAmount: number; averageMonthly: number; totalUnits: number | null; latestRate: number | null; highest: { month: string; amount: number } | null };
}
