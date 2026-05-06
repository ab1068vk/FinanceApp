const fs = require('fs');
const path = require('path');
const { db } = require('../../database/db');
const logger = require('./logger');

let lastBackupTimestamp = null;

function backupDir() {
  return path.resolve(__dirname, '..', '..', process.env.BACKUP_DIR || './backups');
}

function retainDays() {
  const days = Number(process.env.BACKUP_RETAIN_DAYS || 7);
  return Number.isFinite(days) && days > 0 ? days : 7;
}

async function runDatabaseBackup() {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `financeapp-${timestamp}.sqlite`);
  await db.backup(target);
  lastBackupTimestamp = new Date().toISOString();

  const cutoff = Date.now() - retainDays() * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(dir)) {
    if (!/^financeapp-.*\.sqlite$/.test(name)) continue;
    const filePath = path.join(dir, name);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) fs.unlinkSync(filePath);
  }

  logger.info('SQLite backup completed', { target, lastBackupTimestamp });
  return { target, timestamp: lastBackupTimestamp };
}

function getLastBackupTimestamp() {
  return lastBackupTimestamp;
}

module.exports = {
  runDatabaseBackup,
  getLastBackupTimestamp,
};
