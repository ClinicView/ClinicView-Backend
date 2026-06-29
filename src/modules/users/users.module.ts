import { Module } from '@nestjs/common';
import { UsersRepository } from './repositories/users.repository';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * UsersModule — cuentas y datos del personal de salud.
 * PrismaService y HashingService se inyectan vía módulos globales (no hace falta importarlos).
 * Exporta UsersService para que el módulo auth lo consuma.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
