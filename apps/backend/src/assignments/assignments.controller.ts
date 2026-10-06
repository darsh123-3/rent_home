import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuthUser, CurrentUser, ResponseMessage } from '../common/decorators';
import { AgreedDepositDto, ChangeElectricityDto, ChangeRentDto, CreateAssignmentDto, DepositReceiptDto, MoveOutDto } from './assignments.dto';
import { AssignmentsService } from './assignments.service';

@Controller('room-assignments')
export class AssignmentsController {
  constructor(private readonly service: AssignmentsService) {}

  @Post()
  @ResponseMessage('Tenant assigned to room')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateAssignmentDto) {
    return this.service.create(u.userId, dto);
  }

  @Post(':id/move-out')
  @HttpCode(200)
  @ResponseMessage('Tenant moved out. The room is now vacant.')
  moveOut(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveOutDto) {
    return this.service.moveOut(u.userId, id, dto);
  }

  @Post(':id/rent')
  @HttpCode(200)
  @ResponseMessage('Rent updated')
  changeRent(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeRentDto) {
    return this.service.changeRent(u.userId, id, dto);
  }

  @Post(':id/electricity')
  @HttpCode(200)
  @ResponseMessage('Electricity terms updated')
  changeElectricity(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeElectricityDto) {
    return this.service.changeElectricity(u.userId, id, dto);
  }

  @Get(':id/rent-history')
  rentHistory(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.rentHistory(u.userId, id);
  }

  /** Security deposit received for the stay: receipts plus agreed / total received / pending. */
  @Get(':id/deposits')
  deposits(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deposits(u.userId, id);
  }

  @Post(':id/agreed-deposit')
  @HttpCode(200)
  @ResponseMessage('Agreed deposit updated')
  setAgreedDeposit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AgreedDepositDto) {
    return this.service.setAgreedDeposit(u.userId, id, dto);
  }

  @Post(':id/deposits')
  @ResponseMessage('Deposit recorded')
  addDeposit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DepositReceiptDto) {
    return this.service.addDeposit(u.userId, id, dto);
  }

  @Delete(':id/deposits/:receiptId')
  @ResponseMessage('Deposit entry removed')
  removeDeposit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('receiptId', ParseUUIDPipe) receiptId: string) {
    return this.service.removeDeposit(u.userId, id, receiptId);
  }
}
