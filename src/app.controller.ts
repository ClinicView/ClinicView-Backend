import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService, HealthResponse } from './app.service';
import { SkipAudit } from './modules/audit/audit.decorator';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @SkipThrottle()
  @SkipAudit()
  @ApiOperation({ summary: 'Health check del backend' })
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }
}
