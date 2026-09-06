import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { ProfileController } from './profile.controller.js';
import { AuthGuard } from './auth.guard.js';
import { CryptoService } from './crypto.service.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { XboxAuthService } from './xbox-auth.service.js';

@Module({
  controllers: [AuthController, ProfileController],
  providers: [AuthService, AuthGuard, CryptoService, RateLimitGuard, XboxAuthService],
  exports: [AuthService, AuthGuard, CryptoService, XboxAuthService],
})
export class AuthModule {}
