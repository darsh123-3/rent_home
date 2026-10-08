import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, ResponseMessage } from '../common/decorators';
import { CancelBillDto, CreateBillDto, ListBillsQuery, PreviewBillDto, RecurringChargeDto } from './bills.dto';
import { BillsService } from './bills.service';

@Controller()
export class BillsController {
  constructor(private readonly service: BillsService) {}

  @Get('bills')
  list(@CurrentUser() u: AuthUser, @Query() q: ListBillsQuery) {
    return this.service.list(u.userId, q);
  }

  /** Server-side calculation for the Generate Bill screen. Nothing is saved. */
  @Post('bills/preview')
  @HttpCode(200)
  preview(@CurrentUser() u: AuthUser, @Body() dto: PreviewBillDto) {
    return this.service.preview(u.userId, dto);
  }

  @Post('bills')
  @ResponseMessage('Bill generated successfully')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateBillDto) {
    return this.service.create(u.userId, dto);
  }

  @Get('bills/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(u.userId, id);
  }

  /** Generated on demand from the stored bill, so the PDF always matches the database. */
  @Get('bills/:id/pdf')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  async pdf(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('download') download?: string, @Query('format') format?: string) {
    const { buffer, fileName } = await this.service.pdf(u.userId, id, format === 'invoice' ? 'invoice' : format === 'statement' ? 'statement' : 'premium');
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `${download === '1' ? 'attachment' : 'inline'}; filename="${fileName}"`,
      length: buffer.length,
    });
  }

  /** The bill as a JPEG picture, generated from the same PDF so both always match. */
  @Get('bills/:id/image')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async image(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('download') download?: string) {
    const { buffer, fileName } = await this.service.image(u.userId, id);
    return new StreamableFile(buffer, {
      type: 'image/jpeg',
      disposition: `${download === '1' ? 'attachment' : 'inline'}; filename="${fileName}"`,
      length: buffer.length,
    });
  }

  /** Edits a bill: the old bill is cancelled and a corrected one for the same month is created, in one step. */
  @Post('bills/:id/revise')
  @ResponseMessage('Bill updated')
  revise(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateBillDto) {
    return this.service.revise(u.userId, id, dto);
  }

  @Post('bills/:id/cancel')
  @HttpCode(200)
  @ResponseMessage('Bill cancelled')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelBillDto) {
    return this.service.cancel(u.userId, id, dto.reason);
  }

  @Delete('bills/:id')
  @ResponseMessage('Bill deleted')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(u.userId, id);
  }

  @Get('room-assignments/:id/charges')
  charges(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listCharges(u.userId, id);
  }

  @Post('room-assignments/:id/charges')
  @ResponseMessage('Recurring charge added')
  addCharge(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecurringChargeDto) {
    return this.service.addCharge(u.userId, id, dto);
  }

  @Delete('room-assignments/:id/charges/:chargeId')
  @ResponseMessage('Recurring charge removed')
  removeCharge(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('chargeId', ParseUUIDPipe) chargeId: string) {
    return this.service.removeCharge(u.userId, id, chargeId);
  }
}