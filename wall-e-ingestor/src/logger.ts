// Structured JSON logger with level gate and child loggers.
import { config } from './config.js';

// 'notice' shares info rank — valid LOG_LEVEL threshold only, no .notice() method.
const LEVELS = { error: 0, warn: 1, info: 2, notice: 2, debug: 3 } as const;

const base = { service: 'wall-e-ingestor', environment: config.environment };

export interface Logger {
  error(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

function makeLogger(bound: Record<string, unknown>): Logger {
  const threshold = LEVELS[config.logLevel] ?? LEVELS.info;
  const emit = (level: keyof typeof LEVELS, message: string, fields?: Record<string, unknown>) => {
    if (LEVELS[level] > threshold) return;
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      ...base,
      ...bound,
      ...fields,
    }));
  };
  return {
    error: (message, fields) => emit('error', message, fields),
    warn:  (message, fields) => emit('warn',  message, fields),
    info:  (message, fields) => emit('info',  message, fields),
    debug: (message, fields) => emit('debug', message, fields),
    child: (fields) => makeLogger({ ...bound, ...fields }),
  };
}

export const logger = makeLogger({});
