import { Module } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { TicketController } from './ticket.controller';
import { AiModule } from '../ai/ai.module'; // Import AiModule
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule,AiModule], // Masukkan ke dalam array imports
  controllers: [TicketController],
  providers: [TicketService],
})
export class TicketModule {}