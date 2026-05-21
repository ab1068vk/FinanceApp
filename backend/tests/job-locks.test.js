const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-job-locks-suite-32';
process.env.DB_PATH = path.join(__dirname, `test-job-locks-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const { db, dbPath } = require('../database/db');
const {
  releaseJobLock,
  runWithJobLock,
  tryAcquireJobLock,
} = require('../src/utils/jobLocks');

beforeEach(() => {
  db.prepare('DELETE FROM job_locks').run();
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('job locks', () => {
  test('acquires and releases a lock for a single owner', () => {
    expect(tryAcquireJobLock('token-cleanup', { ttlMs: 1000, instanceId: 'instance-a' })).toBe(true);
    expect(tryAcquireJobLock('token-cleanup', { ttlMs: 1000, instanceId: 'instance-b' })).toBe(false);
    expect(releaseJobLock('token-cleanup', { instanceId: 'instance-b' })).toBe(false);
    expect(releaseJobLock('token-cleanup', { instanceId: 'instance-a' })).toBe(true);
    expect(tryAcquireJobLock('token-cleanup', { ttlMs: 1000, instanceId: 'instance-b' })).toBe(true);
  });

  test('steals stale locks after the configured ttl', () => {
    db.prepare('INSERT INTO job_locks (job_name, locked_at, instance_id) VALUES (?, ?, ?)')
      .run('backup', '2026-05-20T00:00:00.000Z', 'dead-instance');

    const acquired = tryAcquireJobLock('backup', {
      ttlMs: 60 * 60 * 1000,
      instanceId: 'live-instance',
      now: new Date('2026-05-20T03:00:00.000Z'),
    });

    expect(acquired).toBe(true);
    expect(db.prepare('SELECT instance_id FROM job_locks WHERE job_name = ?').get('backup')).toEqual({ instance_id: 'live-instance' });
  });

  test('runWithJobLock allows only one concurrent owner to execute work', async () => {
    let releaseWork;
    let runCount = 0;
    let firstRun;
    const firstStarted = new Promise((resolve) => {
      firstRun = runWithJobLock('recurring-transactions', { ttlMs: 1000, instanceId: 'instance-a' }, async () => {
        runCount += 1;
        resolve();
        await new Promise((resolveWork) => { releaseWork = resolveWork; });
      });
    });

    await firstStarted;
    const secondRun = await runWithJobLock('recurring-transactions', { ttlMs: 1000, instanceId: 'instance-b' }, async () => {
      runCount += 1;
    });

    expect(secondRun).toEqual({ acquired: false });
    expect(runCount).toBe(1);

    releaseWork();
    await expect(firstRun).resolves.toEqual({ acquired: true, result: undefined });
    expect(db.prepare('SELECT COUNT(*) AS count FROM job_locks WHERE job_name = ?').get('recurring-transactions').count).toBe(0);
  });
});
