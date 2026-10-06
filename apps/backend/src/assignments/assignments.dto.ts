import { Type } from 'class-transformer';
import { ElectricityMode, PaymentMethod } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class AssignmentTermsDto {
  @IsUUID() roomId: string;
  @Matches(DATE, { message: 'Start date must be in YYYY-MM-DD format' }) startDate: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) agreedRent: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) securityDeposit?: number;
  @IsOptional() @IsEnum(ElectricityMode) electricityMode?: ElectricityMode;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) ratePerUnit?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) fixedElectricity?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) initialMeterReading?: number;
  /** Amount already owed before this system was used. It is added to the tenant's first bill. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) openingBalance?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  /** Rental agreement validity (not the move-out date). */
  @IsOptional() @Matches(DATE, { message: 'Agreement start date must be in YYYY-MM-DD format' }) agreementStartDate?: string;
  @IsOptional() @Matches(DATE, { message: 'Agreement end date must be in YYYY-MM-DD format' }) agreementEndDate?: string;
  /** Deposit already received at move-in: saved as the stay's first deposit receipt in the same transaction. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Deposit received must be an amount with at most 2 decimals' }) @Min(0) depositReceived?: number;
  @IsOptional() @Matches(DATE, { message: 'Deposit received date must be in YYYY-MM-DD format' }) depositReceivedOn?: string;
  @IsOptional() @IsEnum(PaymentMethod, { message: 'Choose a valid payment method' }) depositMethod?: PaymentMethod;
}

/** The deposit agreed for the stay (what the tenant should pay), separate from what was received. */
export class AgreedDepositDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Amount must have at most 2 decimals' }) @Min(0, { message: 'Agreed deposit cannot be negative' }) amount: number;
}

/** One instalment of the security deposit. */
export class DepositReceiptDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Amount must have at most 2 decimals' }) @IsPositive({ message: 'Deposit amount must be more than zero' }) amount: number;
  @Matches(DATE, { message: 'Received date must be in YYYY-MM-DD format' }) receivedOn: string;
  @IsEnum(PaymentMethod, { message: 'Choose a valid payment method' }) method: PaymentMethod;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class CreateAssignmentDto extends AssignmentTermsDto {
  @IsUUID() tenantId: string;
}

export class MoveOutDto {
  @Matches(DATE, { message: 'Move-out date must be in YYYY-MM-DD format' }) moveOutDate: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) finalMeterReading?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

/** Electricity terms for a tenant's stay. They apply to bills generated afterwards; existing bills are never touched. */
export class ChangeElectricityDto {
  @IsOptional() @IsEnum(ElectricityMode) electricityMode?: ElectricityMode;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) ratePerUnit?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) fixedElectricity?: number;
  /** Also make this the default rate of the room (for the next tenant). */
  @IsOptional() applyToRoom?: boolean;
}

export class ChangeRentDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount: number;
  /** Rent applies from the month containing this date. */
  @Matches(DATE, { message: 'Effective date must be in YYYY-MM-DD format' }) effectiveFrom: string;
}

