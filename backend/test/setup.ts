import { Logger } from '@nestjs/common';

// Keep the test reporter output clean — silence Nest's application logger.
Logger.overrideLogger(false);
