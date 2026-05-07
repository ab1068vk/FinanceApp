const fs = require('fs');
const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

const logDir = path.join(__dirname, '..', '..', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function sanitizeLogText(value) {
  return String(value)
    .replace(ansiEscapePattern, '')
    .replace(/[\r\n]/g, ' ');
}

function normalizeLogMessage(value, fallback = 'Log entry without message') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

const ensureMessageFormat = winston.format((info) => {
  info.message = normalizeLogMessage(info.message);
  return info;
});

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  ensureMessageFormat(),
  winston.format.json()
);

const transports = process.env.NODE_ENV === 'test'
  ? [new winston.transports.Console({ silent: true })]
  : [
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
    }),
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '30d',
    }),
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
    }),
  ];

if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...metadata }) => {
          const meta = Object.keys(metadata).length ? ` ${sanitizeLogText(JSON.stringify(metadata))}` : '';
          return `${sanitizeLogText(timestamp)} ${sanitizeLogText(level)}: ${sanitizeLogText(message)}${meta}`;
        })
      ),
    })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels: winston.config.npm.levels,
  format: jsonFormat,
  defaultMeta: { service: 'financeapp-backend' },
  transports,
  exitOnError: false,
});

module.exports = logger;
module.exports.sanitizeLogText = sanitizeLogText;
module.exports.normalizeLogMessage = normalizeLogMessage;
