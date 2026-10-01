import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private keepAliveTimer?: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL tidak diset, cache dinonaktifkan');
      return;
    }

    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      commandTimeout: 3000,
      keepAlive: 5000,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });

    this.client.on('error', (err) =>
      this.logger.warn(`Redis error: ${err.message}`),
    );

    // Ping tiap 20 detik agar koneksi tidak dianggap menganggur
    this.keepAliveTimer = setInterval(() => {
      this.client?.ping().catch(() => undefined);
    }, 20000);
    this.keepAliveTimer.unref();
  }

  async onModuleDestroy() {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    await this.client?.quit().catch(() => undefined);
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.warn(
        `Cache GET gagal, fallback ke LLM: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds = 3600): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`Cache SET gagal: ${(err as Error).message}`);
    }
  }
}