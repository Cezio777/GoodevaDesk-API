import { Module } from '@nestjs/common';
import { AiService } from './ai.service';

@Module({
  providers: [AiService],
  exports: [AiService], // Menambahkan exports agar bisa dipanggil dari luar
})
export class AiModule {}