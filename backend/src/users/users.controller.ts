import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { GamesService } from '../games/games.service.js';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService, type DbUser } from '../db/database.service.js';

// All routes here are read-only: they expose other users' public profiles and game data.
// There are deliberately NO write routes — mutations live in GamesController/ProfileController
// and are always scoped to `req.user.id`, so editing another user's data is impossible by construction.
@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    private readonly games: GamesService,
    private readonly auth: AuthService,
    private readonly db: DatabaseService,
  ) {}

  @Get()
  async list(@Req() req: AuthedRequest) {
    const users = await this.db.listUsers();
    return users.map((u) => ({
      ...this.auth.toPublic(u),
      createdAt: u.created_at,
      isSelf: u.id === req.user.id,
    }));
  }

  @Get(':id')
  async profile(@Param('id') id: string) {
    const user = await this.requireUser(id);
    const conn = await this.db.getConnections(user.id);
    return {
      user: this.auth.toPublic(user),
      createdAt: user.created_at,
      connections: { psn: !!conn?.psn_npsso, steam: !!conn?.steam_id },
    };
  }

  @Get(':id/dashboard')
  async dashboard(@Param('id') id: string) {
    const user = await this.requireUser(id);
    return this.games.getDashboard(user.id);
  }

  @Get(':id/games')
  async gamesList(@Param('id') id: string) {
    const user = await this.requireUser(id);
    return this.games.getGames(user.id);
  }

  @Get(':id/trophies')
  async trophies(@Param('id') id: string) {
    const user = await this.requireUser(id);
    return this.games.getAllTrophies(user.id);
  }

  @Get(':id/backlog')
  async backlog(@Param('id') id: string) {
    const user = await this.requireUser(id);
    return this.games.getBacklog(user.id);
  }

  @Get(':id/providers')
  async providers(@Param('id') id: string) {
    const user = await this.requireUser(id);
    return this.games.getProviderStatuses(user.id);
  }

  private async requireUser(id: string): Promise<DbUser> {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric <= 0) {
      throw new BadRequestException('Invalid user id');
    }
    const user = await this.db.getUserById(numeric);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
