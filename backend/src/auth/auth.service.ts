import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { DatabaseService, type DbUser } from '../db/database.service.js';

export interface PublicUser {
  id: number;
  email: string | null;
  name: string | null;
  picture: string | null;
  isAdmin: boolean;
}

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService implements OnModuleInit {
  private client!: OAuth2Client;
  private clientId!: string;
  private jwtSecret!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {}

  onModuleInit(): void {
    this.clientId = this.config.get<string>('GOOGLE_CLIENT_ID') ?? '';
    this.jwtSecret = this.config.get<string>('JWT_SECRET') ?? '';
    this.client = new OAuth2Client(this.clientId);
  }

  async loginWithGoogle(credential: string): Promise<DbUser> {
    if (!credential) throw new UnauthorizedException('Missing Google credential');
    const ticket = await this.client
      .verifyIdToken({ idToken: credential, audience: this.clientId })
      .catch(() => null);
    const payload = ticket?.getPayload();
    if (!payload?.sub) throw new UnauthorizedException('Invalid Google token');
    return this.db.upsertUser({
      googleSub: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    });
  }

  async register(email: string, password: string, name?: string): Promise<DbUser> {
    const e = (email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new BadRequestException('Invalid email');
    if (!password || password.length < 8)
      throw new BadRequestException('Password must be at least 8 characters');
    if (await this.db.getUserByEmail(e))
      throw new ConflictException('This email is already registered');
    const passwordHash = await bcrypt.hash(password, 10);
    return this.db.createPasswordUser({ email: e, name: name?.trim() || undefined, passwordHash });
  }

  async loginWithPassword(email: string, password: string): Promise<DbUser> {
    const e = (email ?? '').trim().toLowerCase();
    const user = await this.db.getUserByEmail(e);
    if (!user?.password_hash) throw new UnauthorizedException('Incorrect email or password');
    const ok = await bcrypt.compare(password ?? '', user.password_hash);
    if (!ok) throw new UnauthorizedException('Incorrect email or password');
    return user;
  }

  signSession(user: DbUser): string {
    return jwt.sign({ uid: user.id }, this.jwtSecret, { expiresIn: '30d' });
  }

  async userFromToken(token: string | undefined): Promise<DbUser | null> {
    if (!token) return null;
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as { uid: number };
      return await this.db.getUserById(decoded.uid);
    } catch {
      return null;
    }
  }

  toPublic(user: DbUser): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      isAdmin: this.isAdmin(user),
    };
  }

  /** Admins are configured out-of-band via the ADMIN_EMAILS env var (comma-separated), so the
   *  role can't be self-granted and needs no schema change — just deployment config. */
  isAdmin(user: Pick<DbUser, 'email'>): boolean {
    const email = user.email?.trim().toLowerCase();
    if (!email) return false;
    const admins = (this.config.get<string>('ADMIN_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return admins.includes(email);
  }

  get cookieMaxAge(): number {
    return SESSION_MAX_AGE_MS;
  }
}
