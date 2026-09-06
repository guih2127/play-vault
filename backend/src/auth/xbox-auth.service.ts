import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const OAUTH_AUTHORIZE = 'https://login.live.com/oauth20_authorize.srf';
const OAUTH_TOKEN = 'https://login.live.com/oauth20_token.srf';
const XBL_AUTH = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTH = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const PROFILE = 'https://profile.xboxlive.com';
const SCOPE = 'XboxLive.signin offline_access';

/** The result of the full OAuth -> XBL -> XSTS token exchange, ready to call Xbox Live APIs. */
export interface XboxSession {
  /** Value for the `Authorization` header on Xbox Live calls: `XBL3.0 x=<uhs>;<xstsToken>`. */
  authHeader: string;
  xuid: string;
  gamertag?: string;
  /** The (possibly rotated) Microsoft refresh token to persist for next time. */
  refreshToken: string;
}

/**
 * Handles Microsoft's OAuth login and the Xbox Live token chain (XBL user token -> XSTS token)
 * needed to read a user's own games and achievements. One Azure "Live SDK" app is shared by the
 * whole deployment (MICROSOFT_CLIENT_ID/SECRET); each user's refresh token is stored per-user.
 */
@Injectable()
export class XboxAuthService {
  private readonly logger = new Logger(XboxAuthService.name);

  constructor(private readonly config: ConfigService) {}

  private get clientId(): string | undefined {
    return this.config.get<string>('MICROSOFT_CLIENT_ID')?.trim() || undefined;
  }

  private get clientSecret(): string | undefined {
    return this.config.get<string>('MICROSOFT_CLIENT_SECRET')?.trim() || undefined;
  }

  private get appUrl(): string {
    return this.config.get<string>('APP_URL') ?? 'http://localhost:5173';
  }

  private get redirectUri(): string {
    return `${this.appUrl}/api/profile/xbox/callback`;
  }

  isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  /** URL to send the browser to so the user can authorize with their Microsoft account. */
  getAuthorizeUrl(): string {
    const params = new URLSearchParams({
      client_id: this.clientId ?? '',
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: SCOPE,
      // Force account selection so a wrong signed-in account can be switched.
      prompt: 'select_account',
    });
    return `${OAUTH_AUTHORIZE}?${params.toString()}`;
  }

  /** Exchange the OAuth callback code for a refresh token, then resolve the Xbox identity. */
  async exchangeCode(code: string): Promise<XboxSession> {
    const token = await this.postToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });
    if (!token.refresh_token) {
      throw new Error('Microsoft did not return a refresh token (is offline_access granted?)');
    }
    return this.resolveXbox(token.access_token, token.refresh_token);
  }

  /** Refresh an existing session from a stored refresh token (used on every sync). */
  async getSessionFromRefreshToken(refreshToken: string): Promise<XboxSession> {
    const token = await this.postToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    // Microsoft may or may not rotate the refresh token; keep the newest, fall back to the old one.
    return this.resolveXbox(token.access_token, token.refresh_token || refreshToken);
  }

  private async postToken(
    extra: Record<string, string>,
  ): Promise<{ access_token: string; refresh_token?: string }> {
    const body = new URLSearchParams({
      client_id: this.clientId ?? '',
      client_secret: this.clientSecret ?? '',
      scope: SCOPE,
      ...extra,
    });
    const { data } = await axios.post(OAUTH_TOKEN, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    return data;
  }

  /** Run the XBL user-token + XSTS exchange and fetch the gamertag. */
  private async resolveXbox(accessToken: string, refreshToken: string): Promise<XboxSession> {
    const xblToken = await this.authenticateXbl(accessToken);
    const { token: xstsToken, uhs, xuid } = await this.authorizeXsts(xblToken);
    const authHeader = `XBL3.0 x=${uhs};${xstsToken}`;
    const gamertag = await this.fetchGamertag(authHeader, xuid);
    return { authHeader, xuid, gamertag, refreshToken };
  }

  private async authenticateXbl(accessToken: string): Promise<string> {
    const { data } = await axios.post(
      XBL_AUTH,
      {
        Properties: {
          AuthMethod: 'RPS',
          SiteName: 'user.auth.xboxlive.com',
          RpsTicket: `d=${accessToken}`,
        },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT',
      },
      { headers: { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' }, timeout: 15000 },
    );
    return data.Token as string;
  }

  private async authorizeXsts(
    xblToken: string,
  ): Promise<{ token: string; uhs: string; xuid: string }> {
    const { data } = await axios.post(
      XSTS_AUTH,
      {
        Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
        RelyingParty: 'http://xboxlive.com',
        TokenType: 'JWT',
      },
      { headers: { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' }, timeout: 15000 },
    );
    const claims = data?.DisplayClaims?.xui?.[0] ?? {};
    return { token: data.Token as string, uhs: claims.uhs as string, xuid: claims.xid as string };
  }

  private async fetchGamertag(authHeader: string, xuid: string): Promise<string | undefined> {
    try {
      const { data } = await axios.get(
        `${PROFILE}/users/xuid(${xuid})/profile/settings?settings=Gamertag`,
        {
          headers: {
            Authorization: authHeader,
            'x-xbl-contract-version': '3',
            'Accept-Language': 'en-US',
          },
          timeout: 15000,
        },
      );
      const settings: Array<{ id: string; value: string }> =
        data?.profileUsers?.[0]?.settings ?? [];
      return settings.find((s) => s.id === 'Gamertag')?.value;
    } catch {
      return undefined;
    }
  }
}
