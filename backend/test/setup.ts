import { Logger } from '@nestjs/common';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep the test reporter output clean — silence Nest's application logger.
Logger.overrideLogger(false);

// Point ServeStaticModule at the real built frontend, resolved from this file's location so it
// doesn't depend on the working directory. Runs before the test files import AppModule.
process.env.STATIC_DIR ??= join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'frontend',
  'dist',
);
