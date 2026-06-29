import { Global, Module } from '@nestjs/common';
import { HashingService } from './hashing.service';

/**
 * HashingModule — @Global para que cualquier módulo pueda inyectar HashingService
 * sin importar este módulo explícitamente.
 * Registrado en AppModule.
 */
@Global()
@Module({
  providers: [HashingService],
  exports: [HashingService],
})
export class HashingModule {}
