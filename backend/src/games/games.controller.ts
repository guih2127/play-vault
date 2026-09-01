import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { GamesService } from './games.service.js';
import { SyncService } from '../sync/sync.service.js';
import { SearchService } from '../search/search.service.js';
import { MetaService } from '../meta/meta.service.js';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';

@Controller()
@UseGuards(AuthGuard)
export class GamesController {
  constructor(
    private readonly games: GamesService,
    private readonly sync: SyncService,
    private readonly search: SearchService,
    private readonly meta: MetaService,
  ) {}

  @Get('search')
  searchGames(@Query('q') q: string) {
    return this.search.search(q ?? '');
  }

  @Get('search/all')
  searchAllGames(@Query('q') q: string) {
    return this.search.searchAll(q ?? '');
  }

  @Get('meta')
  getMeta(@Query('key') key: string, @Query('title') title: string) {
    return this.meta.getMeta(key ?? '', title ?? '');
  }

  @Get('dashboard')
  getDashboard() {
    return this.games.getDashboard();
  }

  @Get('games')
  getGames() {
    return this.games.getGames();
  }

  @Get('providers')
  getProviders() {
    return this.games.getProviderStatuses();
  }

  @Get('trophies')
  getTrophies() {
    return this.games.getAllTrophies();
  }

  @Post('sync')
  async runSync(@Req() req: AuthedRequest) {
    const result = await this.sync.sync(req.user.id);
    this.games.backfillPsnBeatenDates();
    return result;
  }

  @Post('games/backfill-beaten-dates')
  backfillBeatenDates() {
    return this.games.backfillPsnBeatenDates();
  }

  @Post('games/beaten')
  setBeaten(@Body() body: { key: string; beaten: boolean }) {
    this.games.setBeaten(body.key, !!body.beaten);
    return { ok: true };
  }

  @Post('games/playing')
  setPlaying(@Body() body: { key: string; playing: boolean }) {
    this.games.setPlaying(body.key, !!body.playing);
    return { ok: true };
  }

  @Post('games/rating')
  setRating(@Body() body: { key: string; rating: number }) {
    this.games.setRating(body.key, Number(body.rating) || 0);
    return { ok: true };
  }

  @Post('manual')
  addManual(
    @Body()
    body: {
      title?: string;
      platform?: string;
      hours?: number;
      coverUrl?: string;
      beaten?: boolean;
    },
  ) {
    return this.games.addManualGame(body);
  }

  @Delete('manual/:id')
  deleteManual(@Param('id') id: string) {
    this.games.deleteManualGame(Number(id));
    return { ok: true };
  }

  @Get('backlog')
  getBacklog() {
    return this.games.getBacklog();
  }

  @Post('backlog')
  addBacklog(
    @Body()
    body: {
      title?: string;
      platform?: string;
      coverUrl?: string;
      priority?: number;
      notes?: string;
    },
  ) {
    return this.games.addBacklogGame(body);
  }

  @Post('backlog/:id/priority')
  setBacklogPriority(@Param('id') id: string, @Body() body: { priority: number }) {
    this.games.setBacklogPriority(Number(id), Number(body.priority));
    return { ok: true };
  }

  @Post('backlog/:id/start')
  startBacklog(@Param('id') id: string) {
    return this.games.startBacklogGame(Number(id));
  }

  @Delete('backlog/:id')
  deleteBacklog(@Param('id') id: string) {
    this.games.deleteBacklogGame(Number(id));
    return { ok: true };
  }
}
