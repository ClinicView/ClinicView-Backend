import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService — cliente Prisma gestionado por el ciclo de vida de NestJS.
 * Se conecta en onModuleInit y se desconecta en onModuleDestroy.
 * Inyectable en cualquier módulo porque PrismaModule es @Global().
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
