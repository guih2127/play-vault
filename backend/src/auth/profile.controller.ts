import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AuthGuard, type AuthedRequest } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CryptoService } from './crypto.service.js';
import { XboxAuthService } from './xbox-auth.service.js';
import { ConnectPsnDto } from './auth.dto.js';
import { DatabaseService } from '../db/database.service.js';

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';

@Controller('profile')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly xboxAuth: XboxAuthService,
  ) {}

  private get appUrl(): string {
    return this.config.get<string>('APP_URL') ?? 'http://localhost:5173';
  }

  @Get()
  async get(@Req() req: AuthedRequest) {
    const conn = await this.db.getConnections(req.user.id);
    return {
      user: this.auth.toPublic(req.user),
      connections: {
        psn: !!conn?.psn_npsso,
        steam: !!conn?.steam_id,
        xbox: !!conn?.xbox_rtoken,
      },
      steamId: conn?.steam_id ?? null,
      xboxGamertag: conn?.xbox_gamertag ?? null,
      xboxConfigured: this.xboxAuth.isConfigured(),
    };
  }

  @Post('psn')
  async connectPsn(@Req() req: AuthedRequest, @Body() body: ConnectPsnDto) {
    const npsso = (body.npsso ?? '').trim();
    if (!npsso) throw new BadRequestException('Enter your PSN NPSSO token');
    await this.db.setPsnNpsso(req.user.id, this.crypto.encrypt(npsso));
    return { ok: true };
  }

  @Delete('psn')
  async disconnectPsn(@Req() req: AuthedRequest) {
    await this.db.setPsnNpsso(req.user.id, null);
    return { ok: true };
  }

  @Delete('steam')
  async disconnectSteam(@Req() req: AuthedRequest) {
    await this.db.setSteamId(req.user.id, null);
    return { ok: true };
  }

  @Get('steam/login')
  steamLogin(@Res() res: Response) {
    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': `${this.appUrl}/api/profile/steam/callback`,
      'openid.realm': this.appUrl,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });
    res.redirect(`${STEAM_OPENID}?${params.toString()}`);
  }

  @Get('steam/callback')
  async steamCallback(
    @Req() req: AuthedRequest,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const steamId = await this.verifySteamOpenId(query);
    if (steamId) {
      await this.db.setSteamId(req.user.id, steamId);
      res.redirect(`${this.appUrl}/?connected=steam`);
    } else {
      res.redirect(`${this.appUrl}/?connected=steam_error`);
    }
  }

  @Get('xbox/login')
  xboxLogin(@Res() res: Response) {
    if (!this.xboxAuth.isConfigured()) {
      return res.redirect(`${this.appUrl}/?connected=xbox_error`);
    }
    res.redirect(this.xboxAuth.getAuthorizeUrl());
  }

  @Get('xbox/callback')
  async xboxCallback(
    @Req() req: AuthedRequest,
    @Query('code') code: string,
    @Res() res: Response,
  ) {
    if (!code) return res.redirect(`${this.appUrl}/?connected=xbox_error`);
    try {
      const session = await this.xboxAuth.exchangeCode(code);
      await this.db.setXbox(req.user.id, {
        rtoken: this.crypto.encrypt(session.refreshToken),
        xuid: session.xuid,
        gamertag: session.gamertag ?? null,
      });
      res.redirect(`${this.appUrl}/?connected=xbox`);
    } catch {
      res.redirect(`${this.appUrl}/?connected=xbox_error`);
    }
  }

  @Delete('xbox')
  async disconnectXbox(@Req() req: AuthedRequest) {
    await this.db.setXbox(req.user.id, null);
    return { ok: true };
  }

  private async verifySteamOpenId(query: Record<string, string>): Promise<string | null> {
    const claimed = query['openid.claimed_id'] ?? '';
    const match = claimed.match(/\/openid\/id\/(\d+)$/);
    if (!match) return null;

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (k.startsWith('openid.')) params.append(k, v);
    }
    params.set('openid.mode', 'check_authentication');

    try {
      const resp = await axios.post(STEAM_OPENID, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const valid = typeof resp.data === 'string' && resp.data.includes('is_valid:true');
      return valid ? match[1] : null;
    } catch {
      return null;
    }
  }
}
