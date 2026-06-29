import { Global, Module } from '@nestjs/common';
import { IaClientService } from './ia-client.service';

@Global()
@Module({
  providers: [IaClientService],
  exports: [IaClientService],
})
export class IaClientModule {}
