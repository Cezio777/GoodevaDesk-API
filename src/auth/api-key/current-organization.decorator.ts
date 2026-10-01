import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Organization } from '@prisma/client';

export const CurrentOrganization = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Organization =>
    ctx.switchToHttp().getRequest().organization,
);