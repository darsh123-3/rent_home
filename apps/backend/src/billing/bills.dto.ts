import { Type } from 'class-transformer';
import { BillStatus, ChargeType } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { PaginationQuery } from '../common/pagination';

const money = { maxDecimalPlaces: 2 } as const;

export class ElectricityDto {
  @IsOptional() @Type(() => Number) @IsNumber(money) @Min(0) currentReading?: number;
  /** Only needed when the meter was replaced or the stored previous reading is wrong. */
  @IsOptional() @Type(() => Number) @IsNumber(money) @Min(0) previousReading?: number;
  @IsOptional() @Type(() => Number) @IsNumber(money) @Min(0) ratePerUnit?: number;
  /** Manual amount replacing the calculation (e.g. faulty meter). */
  @IsOptional() @Type(() => Number) @IsNumber(money) @Min(0) overrideAmount?: number;
}

export class BillChargeDto {
  @IsEnum(ChargeType, { message: 'Unknown charge type' }) type: ChargeType;
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  /** 0 leaves the line off the bill (a monthly charge not due this month). */
  @Type(() => Number) @IsNumber(money, { message: 'Charge amount must have at most 2 decimals' }) @Min(0, { message: 'Charge amount cannot be negative' }) amount: number;
  /** Small print under the line, e.g. MNGL units or reading. */
  @IsOptional() @IsString() @MaxLength(60) note?: string;
}

/** Amounts here are inputs only; the server recalculates and stores its own totals. */
export class PreviewBillDto {
  @IsOptional() @IsUUID() assignmentId?: string;
  /** Preview only: the bill being edited. It is left out of the duplicate checks and its carried-in balances count again. */
  @IsOptional() @IsUUID() replacingBillId?: string;
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, { message: 'Billing month must look like 2026-09' }) billingPeriod?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Due date must be in YYYY-MM-DD format' }) dueDate?: string;
  @IsOptional() @ValidateNested() @Type(() => ElectricityDto) electricity?: ElectricityDto;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => BillChargeDto) charges?: BillChargeDto[];
  @IsOptional() @Type(() => Number) @IsNumber(money) @Min(0) lateFee?: number;
  @IsOptional() @Type(() => Number) @IsNumber(money) @Min(0) discount?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

/** Same payload as the preview; the billing month is checked as required in the service. */
export class CreateBillDto extends PreviewBillDto {}

export class CancelBillDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class ListBillsQuery extends PaginationQuery {
  @IsOptional() @IsUUID() propertyId?: string;
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsEnum(BillStatus) status?: BillStatus;
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Month must look like 2026-09' }) month?: string;
}

export class RecurringChargeDto {
  @IsEnum(ChargeType) type: ChargeType;
  @IsString() @IsNotEmpty() @MaxLength(60) name: string;
  @Type(() => Number) @IsNumber(money) @IsPositive() amount: number;
}
