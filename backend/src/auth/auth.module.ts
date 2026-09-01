import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { ProfileController } from './profile.controller.js';
import { AuthGuard } from './auth.guard.js';
import { CryptoService } from './crypto.service.js';

@Module({
  controllers: [AuthController, ProfileController],
  providers: [AuthService, AuthGuard, CryptoService],
  exports: [AuthService, AuthGuard, CryptoService],
})
export class AuthModule {}
