import { Module } from '@nestjs/common';
import { GlobalSearchController } from './global-search.controller';
import { GlobalSearchService } from './global-search.service';
import { GlobalSearchRepository } from './repositories/global-search.repository';

@Module({
  controllers: [GlobalSearchController],
  providers: [GlobalSearchService, GlobalSearchRepository],
})
export class GlobalSearchModule {}
