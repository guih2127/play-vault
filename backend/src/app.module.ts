import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './db/database.module.js';
import { GamesModule } from './games/games.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, AuthModule, GamesModule],
  controllers: [HealthController],
})
export class AppModule {}
