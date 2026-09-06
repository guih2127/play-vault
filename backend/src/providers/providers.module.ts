import { Module } from '@nestjs/common';
import { GAME_PROVIDERS } from './game-provider.interface.js';
import { PsnProvider } from './psn/psn.provider.js';
import { SteamProvider } from './steam/steam.provider.js';
import { XboxProvider } from './xbox/xbox.provider.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  providers: [
    PsnProvider,
    SteamProvider,
    XboxProvider,
    {
      provide: GAME_PROVIDERS,
      useFactory: (psn: PsnProvider, steam: SteamProvider, xbox: XboxProvider) => [
        psn,
        steam,
        xbox,
      ],
      inject: [PsnProvider, SteamProvider, XboxProvider],
    },
  ],
  exports: [GAME_PROVIDERS],
})
export class ProvidersModule {}
