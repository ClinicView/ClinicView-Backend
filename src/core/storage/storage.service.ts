import { createReadStream, mkdirSync, ReadStream } from 'fs';
import { readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StorageService implements OnModuleInit {
  private uploadDir: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.uploadDir = this.configService.get<string>('storage.uploadDir', './uploads');
    mkdirSync(this.uploadDir, { recursive: true });
  }

  async save(buffer: Buffer, filename: string, subdir?: string): Promise<string> {
    const dir = subdir ? join(this.uploadDir, subdir) : this.uploadDir;
    mkdirSync(dir, { recursive: true });
    const relativePath = subdir ? `${subdir}/${filename}` : filename;
    await writeFile(join(this.uploadDir, relativePath), buffer);
    return relativePath;
  }

  createReadStream(relativePath: string): ReadStream {
    return createReadStream(join(this.uploadDir, relativePath));
  }

  async readFile(relativePath: string): Promise<Buffer> {
    return readFile(join(this.uploadDir, relativePath));
  }

  async delete(relativePath: string): Promise<void> {
    try {
      await unlink(join(this.uploadDir, relativePath));
    } catch {
      // Archivo ya eliminado o nunca existió — no es un error
    }
  }
}
