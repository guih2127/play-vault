import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SyncService } from '../sync/sync.service.js';
import { SearchService } from '../search/search.service.js';
import { MetaService } from '../meta/meta.service.js';
import { GamesController } from './games.controller.js';
import { GamesService } from './games.service.js';

@Module({
  imports: [ProvidersModule, AuthModule],
  controllers: [GamesController],
  providers: [GamesService, SyncService, SearchService, MetaService],
})
export class GamesModule {}
