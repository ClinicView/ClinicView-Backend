import { Injectable } from '@nestjs/common';

export interface HealthResponse {
  status: 'ok';
  timestamp: string;
  version: string;
}

@Injectable()
export class AppService {
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
    };
  }
}
