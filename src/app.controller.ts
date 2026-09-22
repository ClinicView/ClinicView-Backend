import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService, HealthResponse, ReadinessResponse } from './app.service';
import { SkipAudit } from './modules/audit/audit.decorator';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get(['health', 'health/live'])
  @Header('Cache-Control', 'no-store')
  @SkipThrottle()
  @SkipAudit()
  @ApiOperation({ summary: 'Health check del backend' })
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }

  @Get('health/ready')
  @Header('Cache-Control', 'no-store')
  @SkipThrottle()
  @SkipAudit()
  @ApiOperation({ summary: 'Readiness: base de datos, storage e IA opcional; nunca ejecuta OCR' })
  async getReady(): Promise<ReadinessResponse> {
    const result = await this.appService.getReady();
    if (result.status !== 'ready') throw new ServiceUnavailableException(result);
    return result;
  }
}
