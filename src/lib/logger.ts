import pino from 'pino';
import type { LoggingConfig } from '../types/index.js';

let logger: pino.Logger | null = null;

export function createLogger(config: LoggingConfig): pino.Logger {
  const options: pino.LoggerOptions = {
    level: config.level,
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
  };

  // Use pino-pretty for development
  if (config.pretty) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  // Production: JSON logging
  return pino(options);
}

export function initLogger(config: LoggingConfig): void {
  logger = createLogger(config);
}

export function getLogger(): pino.Logger {
  if (!logger) {
    // Default logger if not initialized
    logger = pino({
      level: 'info',
    });
  }
  return logger;
}

// Create child logger with context
export function createChildLogger(context: Record<string, unknown>): pino.Logger {
  return getLogger().child(context);
}
