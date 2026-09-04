import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { GamesService } from './games.service.js';
import { SyncService } from '../sync/sync.service.js';
import { SearchService } from '../search/search.service.js';
import { MetaService } from '../meta/meta.service.js';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';
import {
  BacklogDto,
  BacklogPriorityDto,
  BeatenDto,
  ManualGameDto,
  ManualHoursDto,
  PlayingDto,
  RatingDto,
} from './games.dto.js';

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
  getDashboard(@Req() req: AuthedRequest) {
    return this.games.getDashboard(req.user.id);
  }

  @Get('games')
  getGames(@Req() req: AuthedRequest) {
    return this.games.getGames(req.user.id);
  }

  @Get('providers')
  getProviders(@Req() req: AuthedRequest) {
    return this.games.getProviderStatuses(req.user.id);
  }

  @Get('trophies')
  getTrophies(@Req() req: AuthedRequest) {
    return this.games.getAllTrophies(req.user.id);
  }

  @Post('sync')
  async runSync(@Req() req: AuthedRequest) {
    const result = await this.sync.sync(req.user.id);
    await this.games.backfillPsnBeatenDates(req.user.id);
    return result;
  }

  @Post('games/backfill-beaten-dates')
  backfillBeatenDates(@Req() req: AuthedRequest) {
    return this.games.backfillPsnBeatenDates(req.user.id);
  }

  @Post('games/beaten')
  async setBeaten(@Req() req: AuthedRequest, @Body() body: BeatenDto) {
    await this.games.setBeaten(req.user.id, body.key, !!body.beaten);
    return { ok: true };
  }

  @Post('games/playing')
  async setPlaying(@Req() req: AuthedRequest, @Body() body: PlayingDto) {
    await this.games.setPlaying(req.user.id, body.key, !!body.playing);
    return { ok: true };
  }

  @Post('games/rating')
  async setRating(@Req() req: AuthedRequest, @Body() body: RatingDto) {
    await this.games.setRating(req.user.id, body.key, Number(body.rating) || 0);
    return { ok: true };
  }

  @Post('manual')
  addManual(@Req() req: AuthedRequest, @Body() body: ManualGameDto) {
    return this.games.addManualGame(req.user.id, body);
  }

  @Post('manual/:id/hours')
  async updateManualHours(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: ManualHoursDto,
  ) {
    const ok = await this.games.updateManualGameHours(
      req.user.id,
      Number(id),
      Number(body.hours) || 0,
    );
    if (!ok) throw new NotFoundException('Manual game not found');
    return { ok: true };
  }

  @Delete('manual/:id')
  async deleteManual(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.games.deleteManualGame(req.user.id, Number(id));
    return { ok: true };
  }

  @Get('backlog')
  getBacklog(@Req() req: AuthedRequest) {
    return this.games.getBacklog(req.user.id);
  }

  @Post('backlog')
  addBacklog(@Req() req: AuthedRequest, @Body() body: BacklogDto) {
    return this.games.addBacklogGame(req.user.id, body);
  }

  @Post('backlog/:id/priority')
  async setBacklogPriority(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: BacklogPriorityDto,
  ) {
    await this.games.setBacklogPriority(req.user.id, Number(id), Number(body.priority));
    return { ok: true };
  }

  @Post('backlog/:id/start')
  startBacklog(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.games.startBacklogGame(req.user.id, Number(id));
  }

  @Delete('backlog/:id')
  async deleteBacklog(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.games.deleteBacklogGame(req.user.id, Number(id));
    return { ok: true };
  }
}
