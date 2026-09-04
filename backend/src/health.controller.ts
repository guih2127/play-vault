import { Controller, Get } from '@nestjs/common';

/** Liveness probe for the host (Render etc.). Served at /api/health (open, no auth). */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
