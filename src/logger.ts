import pino from 'pino';

/**
 * Reads its level straight from the environment rather than importing config.
 *
 * config validates and fail-fasts on a missing bot token, and almost every
 * module imports the logger - going through config would make diagnostics like
 * `npm run probe` demand a Telegram token they never use.
 */
const level = process.env.LOG_LEVEL ?? 'info';
const isService = process.env.RUNNING_AS_SERVICE === '1';

export const logger = pino({
  level: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(level) ? level : 'info',
  // A service writes plain JSON to a file NSSM rotates; a terminal gets colour.
  ...(isService
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});
