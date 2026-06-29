import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

/**
 * HashingService — infraestructura de hashing de contraseñas (bcrypt).
 * Centralizado en core/security para que users y auth lo consuman sin duplicar lógica.
 * Factor de coste fijo en 12 rondas; ajustar solo si el hardware lo justifica.
 */
@Injectable()
export class HashingService {
  private static readonly ROUNDS = 12;

  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, HashingService.ROUNDS);
  }

  async compare(plain: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plain, hashed);
  }
}
