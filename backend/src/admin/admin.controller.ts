import {
  BadRequestException,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../db/database.service.js';
import { GamesService } from '../games/games.service.js';
import { SyncService } from '../sync/sync.service.js';

// Admin-only routes. Membership is decided by AuthService.isAdmin (the ADMIN_EMAILS env var),
// never by anything the user can set, so these can't be reached by ordinary accounts.
@Controller('admin')
@UseGuards(AuthGuard)
export class AdminController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: DatabaseService,
    private readonly games: GamesService,
    private readonly sync: SyncService,
  ) {}

  /** Trigger a full sync for any user (mirrors the self-sync in GamesController). */
  @Post('users/:id/sync')
  async syncUser(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (!this.auth.isAdmin(req.user)) throw new ForbiddenException('Admins only');
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric <= 0) {
      throw new BadRequestException('Invalid user id');
    }
    const user = await this.db.getUserById(numeric);
    if (!user) throw new NotFoundException('User not found');
    const result = await this.sync.sync(user.id);
    await this.games.backfillPsnBeatenDates(user.id);
    return result;
  }
}
