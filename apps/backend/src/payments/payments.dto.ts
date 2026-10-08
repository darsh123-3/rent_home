import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PaginationQuery } from '../common/pagination';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class RecordPaymentDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive({ message: 'Payment amount must be more than zero' }) amount: number;
  @Matches(DATE, { message: 'Payment date must be in YYYY-MM-DD format' }) paymentDate: string;
  @IsEnum(PaymentMethod, { message: 'Choose a valid payment method' }) method: PaymentMethod;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

/** Tenant-level payment: applied to the tenant's current unpaid bill. */
export class RecordTenantPaymentDto extends RecordPaymentDto {
  @IsUUID() tenantId: string;
}

export class ListPaymentsQuery extends PaginationQuery {
  @IsOptional() @IsUUID() propertyId?: string;
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @IsOptional() @Matches(DATE, { message: 'From date must be in YYYY-MM-DD format' }) from?: string;
  @IsOptional() @Matches(DATE, { message: 'To date must be in YYYY-MM-DD format' }) to?: string;
}

export class ReversePaymentDto {
  @IsString() @MaxLength(200) @Matches(/\S/, { message: 'Enter a reason, e.g. "Recorded twice"' }) reason: string;
}
