import { Type } from 'class-transformer';
import { TenantStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { AssignmentTermsDto } from '../assignments/assignments.dto';
import { NormalizePhone, PHONE_REGEX, Trim } from '../common/transforms';
import { PaginationQuery } from '../common/pagination';

const PHONE_MSG = 'Enter a valid phone number (10 to 15 digits)';

export class TenantFieldsDto {
  @Trim() @IsString() @IsNotEmpty({ message: 'Full name is required' }) @MaxLength(120) fullName: string;
  @NormalizePhone() @Matches(PHONE_REGEX, { message: PHONE_MSG }) phone: string;
  @IsOptional() @NormalizePhone() @Matches(PHONE_REGEX, { message: PHONE_MSG }) alternatePhone?: string;
  @IsOptional() @Trim() @IsEmail({}, { message: 'Enter a valid email address' }) email?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) permanentAddress?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) currentAddress?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(120) emergencyContact?: string;
  @IsOptional() @NormalizePhone() @Matches(PHONE_REGEX, { message: PHONE_MSG }) emergencyPhone?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(120) occupation?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Joining date must be in YYYY-MM-DD format' }) joiningDate: string;
  @IsOptional() @Trim() @IsString() @MaxLength(1000) notes?: string;
}

export class CreateTenantDto extends TenantFieldsDto {
  /** Required when no room assignment is supplied; otherwise derived from the room. */
  @IsOptional() @IsUUID() propertyId?: string;
  @IsOptional() @ValidateNested() @Type(() => AssignmentTermsDto) assignment?: AssignmentTermsDto;
}

export class UpdateTenantDto {
  @IsOptional() @Trim() @IsString() @IsNotEmpty() @MaxLength(120) fullName?: string;
  @IsOptional() @NormalizePhone() @Matches(PHONE_REGEX, { message: PHONE_MSG }) phone?: string;
  @IsOptional() @NormalizePhone() @Matches(PHONE_REGEX, { message: PHONE_MSG }) alternatePhone?: string;
  @IsOptional() @Trim() @IsEmail({}, { message: 'Enter a valid email address' }) email?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) permanentAddress?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) currentAddress?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(120) emergencyContact?: string;
  @IsOptional() @NormalizePhone() @Matches(PHONE_REGEX, { message: PHONE_MSG }) emergencyPhone?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(120) occupation?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Joining date must be in YYYY-MM-DD format' }) joiningDate?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(1000) notes?: string;
  /** Agreement dates of the active stay. An empty string clears the date. */
  @IsOptional() @Matches(/^$|^\d{4}-\d{2}-\d{2}$/, { message: 'Agreement start date must be in YYYY-MM-DD format' }) agreementStartDate?: string;
  @IsOptional() @Matches(/^$|^\d{4}-\d{2}-\d{2}$/, { message: 'Agreement end date must be in YYYY-MM-DD format' }) agreementEndDate?: string;
}

export class ListTenantsQuery extends PaginationQuery {
  @IsOptional() @IsUUID() propertyId?: string;
  @IsOptional() @IsEnum(TenantStatus) status?: TenantStatus;
  /** 'true': only tenants who owe money (including people who have moved out). */
  @IsOptional() @IsIn(['true', 'false']) dues?: string;
}
