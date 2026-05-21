const crypto = require('crypto');
const os = require('os');
const { db } = require('../../database/db');
const logger = require('./logger');

const INSTANCE_ID = process.env.INSTANCE_ID || `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;

function isoNow(now = new Date()) {
  return new Date(now).toISOString();
}

function ensureJobLocksTable(database = db) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS job_locks (
      job_name TEXT PRIMARY KEY,
      locked_at TEXT NOT NULL,
      instance_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_locks_locked_at ON job_locks(locked_at);
  `);
}

function tryAcquireJobLock(jobName, { ttlMs, instanceId = INSTANCE_ID, now = new Date(), database = db } = {}) {
  if (!jobName) throw new Error('jobName is required');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttlMs must be a positive number');

  ensureJobLocksTable(database);
  const lockedAt = isoNow(now);
  const staleBefore = isoNow(new Date(new Date(now).getTime() - ttlMs));

  return database.transaction(() => {
    database.prepare('DELETE FROM job_locks WHERE job_name = ? AND locked_at < ?').run(jobName, staleBefore);
    const result = database.prepare(`
      INSERT OR IGNORE INTO job_locks (job_name, locked_at, instance_id)
      VALUES (?, ?, ?)
    `).run(jobName, lockedAt, instanceId);
    return result.changes === 1;
  })();
}

function releaseJobLock(jobName, { instanceId = INSTANCE_ID, database = db } = {}) {
  if (!jobName) throw new Error('jobName is required');
  const result = database.prepare('DELETE FROM job_locks WHERE job_name = ? AND instance_id = ?').run(jobName, instanceId);
  return result.changes === 1;
}

async function runWithJobLock(jobName, { ttlMs, instanceId = INSTANCE_ID, database = db } = {}, job) {
  if (typeof job !== 'function') throw new Error('job must be a function');
  const acquired = tryAcquireJobLock(jobName, { ttlMs, instanceId, database });
  if (!acquired) {
    logger.warn('Scheduled job skipped because another instance holds the lock', { jobName, instanceId });
    return { acquired: false };
  }

  try {
    const result = await job();
    return { acquired: true, result };
  } finally {
    releaseJobLock(jobName, { instanceId, database });
  }
}

module.exports = {
  INSTANCE_ID,
  ensureJobLocksTable,
  releaseJobLock,
  runWithJobLock,
  tryAcquireJobLock,
};
