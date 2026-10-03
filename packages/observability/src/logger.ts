import { pino, type Logger, type LoggerOptions } from 'pino';
import { REDACTED, pinoRedactPaths } from './redaction.js';

export interface LoggerConfig {
  service: string;
  version: string;
  level?: LoggerOptions['level'];
  /** Destination stream, for tests. Defaults to stdout. */
  destination?: pino.DestinationStream;
}

/** Structured JSON logger with mandatory redaction. Never log request/response bodies. */
export function createLogger(config: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level: config.level ?? 'info',
    base: { service: config.service, version: config.version },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'message',
    // Client network identifiers are personal data; request logs keep method, path and status only.
    redact: {
      paths: [...pinoRedactPaths(), 'req.remoteAddress', 'req.remotePort'],
      censor: REDACTED,
    },
    formatters: { level: (label) => ({ level: label }) },
  };
  return config.destination ? pino(options, config.destination) : pino(options);
}

export type { Logger } from 'pino';
