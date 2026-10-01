import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // 1. Import ConfigModule
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TicketModule } from './ticket/ticket.module';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './ai/ai.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // 2. Aktifkan secara global
    TicketModule, 
    PrismaModule, 
    AiModule, RedisModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}