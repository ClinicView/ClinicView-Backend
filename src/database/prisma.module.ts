import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PrismaModule — módulo global de acceso a datos.
 * Al ser @Global(), cualquier módulo del backend puede inyectar PrismaService
 * sin necesidad de importar PrismaModule explícitamente.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
