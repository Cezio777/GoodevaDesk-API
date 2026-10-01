import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { createHash } from 'crypto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service'; // Import AiService
import { RedisService } from '../redis/redis.service';

interface CachedAnalysis {
  category: string;
  suggested_reply: string;
}

@Injectable()
export class TicketService {
  private readonly logger = new Logger(TicketService.name);
  private readonly CACHE_TTL_SECONDS = 86400; // 1 hari

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly redisService: RedisService,
  ) {}

  private normalize(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private buildCacheKey(organizationId: string, subject: string, message: string): string {
    const raw = `${this.normalize(subject)}\u0000${this.normalize(message)}`;
    const hash = createHash('sha256').update(raw).digest('hex');
    return `ticket_cache:${organizationId}:${hash}`;
  }

  private async readCache(key: string): Promise<CachedAnalysis | null> {
    const raw = await this.redisService.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedAnalysis;
    } catch {
      return null; // data cache rusak, anggap miss
    }
  }

  async create(createTicketDto: CreateTicketDto, organizationId: string) {
    const { customer_email, subject, message } = createTicketDto;
    const cacheKey = this.buildCacheKey(organizationId, subject, message);

    let category: string | null = null;
    let suggestedReply: string | null = null;

    const cached = await this.readCache(cacheKey);

    if (cached) {
      this.logger.log(`Cache HIT: ${cacheKey}`);
      category = cached.category;
      suggestedReply = cached.suggested_reply;
    } else {
    this.logger.log(`Cache MISS: ${cacheKey}`);
    try {
      const aiResult = await this.aiService.analyzeTicket(subject, message);
      category = aiResult?.category ?? null;
      suggestedReply = aiResult?.suggested_reply ?? null;
    } catch (err) {
      this.logger.error(`LLM gagal, tiket tetap disimpan: ${(err as Error).message}`);
    }

    if (category && suggestedReply) {
      await this.redisService.set(cacheKey, JSON.stringify({ category, suggested_reply: suggestedReply }), this.CACHE_TTL_SECONDS);
    }
  }

    return this.prisma.ticket.create({
      data: {
        customer_email,
        subject,
        message,
        organization_id: organizationId,
        category,
        suggested_reply: suggestedReply,
      },
    });
  }

  async findAll(organizationId: string, query: ListTicketsQueryDto) {
    const { status, category, page = 1, limit = 20 } = query;

    const where: Prisma.TicketWhereInput = {
      organization_id: organizationId,
      ...(status && { status }),
      ...(category && { category }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return { data, meta: { total, page, limit, total_pages: Math.ceil(total / limit) } };
  }

  async findOne(id: string, organizationId: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, organization_id: organizationId },
    });
    
    if (!ticket) {
      throw new NotFoundException('Tiket tidak ditemukan atau Anda tidak memiliki akses');
    }
    
    return ticket;
  }

  async updateStatus(id: string, organizationId: string, status: TicketStatus) {
    // Satu query atomik yang sudah ter-scope ke organisasi
    const { count } = await this.prisma.ticket.updateMany({
      where: { id, organization_id: organizationId },
      data: { status },
    });
    if (count === 0) {
      throw new NotFoundException('Tiket tidak ditemukan atau Anda tidak memiliki akses');
    }
    return this.findOne(id, organizationId);
  }
}