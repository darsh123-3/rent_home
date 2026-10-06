import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { NormalizePhone } from '../common/transforms';

export class CreatePropertyDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsString() @IsNotEmpty() @MaxLength(300) address: string;
  @IsString() @IsNotEmpty() @MaxLength(80) city: string;
  @IsString() @IsNotEmpty() @MaxLength(80) state: string;
  @IsString() @Matches(/^[0-9]{6}$/, { message: 'Pincode must be 6 digits' }) pincode: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class UpdatePropertyDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) state?: string;
  @IsOptional() @IsString() @Matches(/^[0-9]{6}$/, { message: 'Pincode must be 6 digits' }) pincode?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;

  // Bill settings
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9]{1,8}$/, { message: 'Bill prefix must be 1-8 letters or numbers' }) billPrefix?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(28) dueDayOfMonth?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000) defaultRatePerUnit?: number;
  @IsOptional() @IsString() @MaxLength(300) billFooterNote?: string;
  /** UPI ID for the "scan to pay" QR on bills (name@bank). Send an empty string to remove it. */
  @IsOptional() @IsString() @Matches(/^$|^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,32}$/, { message: 'Enter a valid UPI ID such as name@bank' }) upiId?: string;
  /** Landlord phone printed under the address on bills. Send an empty string to remove it. */
  @IsOptional() @NormalizePhone() @IsString() @Matches(/^$|^\+?[0-9]{10,15}$/, { message: 'Enter a valid phone number (10 to 15 digits)' }) contactPhone?: string;
}
