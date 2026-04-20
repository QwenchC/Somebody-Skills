import winston from 'winston';

const { combine, timestamp, colorize, printf } = winston.format;

const sbsFormat = printf(({ level, message, timestamp: ts }) => {
  return `${ts} [${level}] ${message}`;
});

export function createLogger(level = 'info'): winston.Logger {
  return winston.createLogger({
    level,
    format: combine(
      timestamp({ format: 'HH:mm:ss' }),
      colorize(),
      sbsFormat
    ),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({
        filename: 'sbs-debug.log',
        level: 'debug',
        format: combine(timestamp(), winston.format.json()),
      }),
    ],
  });
}

export type Logger = winston.Logger;
