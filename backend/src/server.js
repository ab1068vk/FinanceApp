const dotenv = require('dotenv');
const logger = require('./utils/logger');
const { assertJwtSecret } = require('./utils/security');
const { processRecurringTransactions } = require('./utils/recurringProcessor');
const { reconcileAccountBalances } = require('./utils/accountBalance');
const { runDatabaseBackup } = require('./utils/backup');

dotenv.config();

function validateEnvironment() {
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  process.env.PORT = process.env.PORT || (process.env.NODE_ENV === 'test' ? '0' : '3000');
  process.env.REQUIRE_CSRF = process.env.REQUIRE_CSRF || 'true';
  process.env.DELETED_USER_ARCHIVE_DAYS = process.env.DELETED_USER_ARCHIVE_DAYS || '90';
  process.env.BACKUP_HOUR = process.env.BACKUP_HOUR || '3';
  process.env.BACKUP_RETAIN_DAYS = process.env.BACKUP_RETAIN_DAYS || '7';

  if (process.env.NODE_ENV === 'test') {
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
  }

  const errors = [];
  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DB_PATH', 'PORT', 'NODE_ENV', 'REQUIRE_CSRF', 'DELETED_USER_ARCHIVE_DAYS'];
  required.forEach((name) => {
    if (!process.env[name]) errors.push(`${name} is required`);
  });

  if (process.env.JWT_SECRET) {
    try {
      assertJwtSecret(process.env.JWT_SECRET);
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (process.env.JWT_REFRESH_SECRET && Buffer.byteLength(process.env.JWT_REFRESH_SECRET, 'utf8') < 32) {
    errors.push('JWT_REFRESH_SECRET must be at least 32 bytes of high-entropy data');
  }

  if (!['development', 'test', 'production'].includes(process.env.NODE_ENV)) {
    errors.push('NODE_ENV must be one of development, test, or production');
  }

  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    errors.push('PORT must be an integer between 0 and 65535');
  }

  const csrf = String(process.env.REQUIRE_CSRF).toLowerCase();
  if (!['true', 'false'].includes(csrf)) {
    errors.push('REQUIRE_CSRF must be true or false');
  }

  const archiveDays = Number(process.env.DELETED_USER_ARCHIVE_DAYS);
  if (!Number.isInteger(archiveDays) || archiveDays < 1) {
    errors.push('DELETED_USER_ARCHIVE_DAYS must be a positive integer');
  }

  String(process.env.MOBILE_APP_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean).forEach((origin) => {
    try {
      new URL(origin);
    } catch {
      errors.push(`MOBILE_APP_ORIGIN contains an invalid URL: ${origin}`);
    }
  });

  if (process.env.SMTP_HOST) {
    const smtpPort = Number(process.env.SMTP_PORT || 587);
    if (!Number.isInteger(smtpPort) || smtpPort <= 0 || smtpPort > 65535) {
      errors.push('SMTP_PORT must be an integer between 1 and 65535 when SMTP_HOST is set');
    }
    if ((process.env.SMTP_USER && !process.env.SMTP_PASS) || (!process.env.SMTP_USER && process.env.SMTP_PASS)) {
      errors.push('SMTP_USER and SMTP_PASS must be provided together');
    }
    if (!process.env.EMAIL_FROM && !process.env.SMTP_FROM && !process.env.SMTP_USER) {
      errors.push('EMAIL_FROM, SMTP_FROM, or SMTP_USER is required when SMTP_HOST is set');
    }
  }

  if (errors.length) {
    logger.error('Invalid backend environment configuration', { errors });
    throw new Error(`Invalid backend environment configuration: ${errors.join('; ')}`);
  }
}

validateEnvironment();

const app = require('./app');
const { db, purgeDeletedUserArchives } = require('../database/db');
const { INSTANCE_ID, runWithJobLock } = require('./utils/jobLocks');

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const REFRESH_TOKEN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DELETED_USER_ARCHIVE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RECURRING_TRANSACTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const BALANCE_RECONCILE_INTERVAL_MS = Number(process.env.BALANCE_RECONCILE_INTERVAL_MS) || 6 * 60 * 60 * 1000;
const JOB_LOCKS = {
  refreshTokenCleanup: { name: 'refresh-token-cleanup', ttlMs: REFRESH_TOKEN_CLEANUP_INTERVAL_MS * 2 },
  deletedUserArchiveCleanup: { name: 'deleted-user-archive-cleanup', ttlMs: DELETED_USER_ARCHIVE_CLEANUP_INTERVAL_MS * 2 },
  recurringTransactions: { name: 'recurring-transaction-processing', ttlMs: RECURRING_TRANSACTION_INTERVAL_MS * 2 },
  balanceReconciliation: { name: 'account-balance-reconciliation', ttlMs: BALANCE_RECONCILE_INTERVAL_MS * 2 },
  databaseBackup: { name: 'database-backup', ttlMs: BACKUP_CHECK_INTERVAL_MS * 2 },
};

function configuredInstanceCount() {
  const raw = process.env.INSTANCE_COUNT || process.env.WEB_CONCURRENCY || process.env.pm2_instances;
  const count = Number(raw);
  return Number.isFinite(count) ? count : 1;
}

if (configuredInstanceCount() > 1) {
  logger.warn('Multiple backend instances configured; scheduled jobs will coordinate through SQLite job locks', {
    instanceId: INSTANCE_ID,
    instanceCount: configuredInstanceCount(),
  });
}

function cleanupRefreshTokens() {
  const now = new Date().toISOString();
  const refresh = db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(now);
  const blocklist = db.prepare('DELETE FROM access_token_blocklist WHERE expires_at <= ?').run(now);
  logger.info('Token cleanup completed', {
    refreshTokensDeleted: refresh.changes,
    accessTokenBlocklistDeleted: blocklist.changes,
  });
}

const refreshTokenCleanupTimer = setInterval(() => {
  void runScheduledJob(JOB_LOCKS.refreshTokenCleanup, cleanupRefreshTokens, 'Refresh token cleanup failed');
}, REFRESH_TOKEN_CLEANUP_INTERVAL_MS);
refreshTokenCleanupTimer.unref();

void runScheduledJob(JOB_LOCKS.deletedUserArchiveCleanup, purgeDeletedUserArchives, 'Deleted user archive cleanup failed');

const deletedUserArchiveCleanupTimer = setInterval(() => {
  void runScheduledJob(JOB_LOCKS.deletedUserArchiveCleanup, purgeDeletedUserArchives, 'Deleted user archive cleanup failed');
}, DELETED_USER_ARCHIVE_CLEANUP_INTERVAL_MS);
deletedUserArchiveCleanupTimer.unref();

void runScheduledJob(JOB_LOCKS.recurringTransactions, processRecurringTransactions, 'Recurring transaction processor failed');

const recurringTransactionTimer = setInterval(() => {
  void runScheduledJob(JOB_LOCKS.recurringTransactions, processRecurringTransactions, 'Recurring transaction processor failed');
}, RECURRING_TRANSACTION_INTERVAL_MS);
recurringTransactionTimer.unref();

function runBalanceReconciliation() {
  const autoRepair = String(process.env.BALANCE_RECONCILE_AUTO_REPAIR || 'false').toLowerCase() === 'true';
  const maxAutoRepairCents = Math.max(Math.round(Number(process.env.BALANCE_RECONCILE_MAX_AUTO_REPAIR || 0) * 100), 0);
  return reconcileAccountBalances({
    autoRepair,
    maxAutoRepairCents,
    source: 'scheduled-job',
  });
}

void runScheduledJob(JOB_LOCKS.balanceReconciliation, runBalanceReconciliation, 'Account balance reconciliation failed');

const balanceReconcileTimer = setInterval(() => {
  void runScheduledJob(JOB_LOCKS.balanceReconciliation, runBalanceReconciliation, 'Account balance reconciliation failed');
}, BALANCE_RECONCILE_INTERVAL_MS);
balanceReconcileTimer.unref();

let lastBackupDate = null;
function backupDue(now = new Date()) {
  const backupHour = Math.min(Math.max(Number(process.env.BACKUP_HOUR || 3), 0), 23);
  const today = now.toISOString().slice(0, 10);
  return now.getHours() === backupHour && lastBackupDate !== today;
}

async function runBackupIfDue() {
  if (!backupDue()) return;
  await runScheduledJob(JOB_LOCKS.databaseBackup, async () => {
    await runDatabaseBackup();
    lastBackupDate = new Date().toISOString().slice(0, 10);
  }, 'SQLite backup failed');
}

async function runScheduledJob(lockConfig, job, errorMessage) {
  try {
    return await runWithJobLock(lockConfig.name, { ttlMs: lockConfig.ttlMs }, job);
  } catch (error) {
    logger.error(errorMessage, { error: error.message, jobName: lockConfig.name, instanceId: INSTANCE_ID });
    return { acquired: false, error };
  }
}

void runBackupIfDue();
const backupTimer = setInterval(() => {
  void runBackupIfDue();
}, BACKUP_CHECK_INTERVAL_MS);
backupTimer.unref();

const server = app.listen(PORT, () => {
  logger.info('FinanceApp backend started', { port: PORT, environment: NODE_ENV });
  if (NODE_ENV !== 'test') {
    console.log(`FinanceApp backend listening on port ${PORT} (${NODE_ENV})`);
  }
});

function errorDetails(error) {
  if (!error) return {};
  return {
    error_message: error.message || String(error),
    stack: error.stack,
  };
}

function shutdown(reason, error, exitCode = 1) {
  const log = exitCode === 0 ? logger.info.bind(logger) : logger.error.bind(logger);
  log(reason || 'Server shutdown requested', errorDetails(error));
  clearInterval(refreshTokenCleanupTimer);
  clearInterval(deletedUserArchiveCleanupTimer);
  clearInterval(recurringTransactionTimer);
  clearInterval(balanceReconcileTimer);
  clearInterval(backupTimer);

  server.close(() => {
    try {
      if (db.open) db.close();
    } catch (closeError) {
      logger.error('Failed to close database during shutdown', { error: closeError.message });
    }
    process.exit(exitCode);
  });

  const forceExitTimer = setTimeout(() => process.exit(exitCode), 5000);
  forceExitTimer.unref();
}

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error
    ? reason
    : new Error(reason === undefined ? 'Promise rejected without a reason' : String(reason));
  logger.error('Unhandled promise rejection', errorDetails(error));
});

process.on('uncaughtException', (error) => {
  shutdown('Uncaught exception', error);
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM received', null, 0);
});

process.on('SIGINT', () => {
  shutdown('SIGINT received', null, 0);
});

module.exports = server;
