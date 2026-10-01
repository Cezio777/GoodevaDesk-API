import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException('API Key tidak ditemukan di header permintaan');
    }

    const organization = await this.prisma.organization.findUnique({
      where: { api_key: apiKey },
    });

    if (!organization) {
      throw new UnauthorizedException('API Key tidak valid');
    }

    request.organization = organization;
    return true;
  }
}