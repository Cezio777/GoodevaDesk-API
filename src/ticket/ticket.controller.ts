import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { Organization } from '@prisma/client';
import { ApiKeyGuard } from '../auth/api-key/api-key.guard';
import { CurrentOrganization } from '../auth/api-key/current-organization.decorator';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { TicketService } from './ticket.service';

@Controller('tickets')
@UseGuards(ApiKeyGuard)
export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  @Post()
  create(@Body() dto: CreateTicketDto, @CurrentOrganization() org: Organization) {
    return this.ticketService.create(dto, org.id);
  }

  @Get()
  findAll(
    @CurrentOrganization() org: Organization,
    @Query() query: ListTicketsQueryDto = {} as ListTicketsQueryDto,
  ) {
    return this.ticketService.findAll(org.id, query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentOrganization() org: Organization) {
    return this.ticketService.findOne(id, org.id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketStatusDto,
    @CurrentOrganization() org: Organization,
  ) {
    return this.ticketService.updateStatus(id, org.id, dto.status);
  }
}