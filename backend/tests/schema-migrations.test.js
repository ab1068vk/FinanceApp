const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-schema-migrations-32-bytes';
process.env.DB_PATH = path.join(__dirname, `test-schema-migrations-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD_HASH = '';

const {
  currentSchemaVersion,
  db,
  dbPath,
  recordSchemaVersion,
  runSchemaMigrations,
  schemaMigrations,
} = require('../database/db');

function tableExists(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore cleanup misses */ }
  }
});

describe('schema migration runner', () => {
  test('fresh DB with no schema_version row runs migrations and records the highest version', () => {
    db.prepare('DELETE FROM schema_version').run();

    expect(currentSchemaVersion()).toBe(0);

    const finalVersion = runSchemaMigrations(schemaMigrations);
    const highestVersion = Math.max(...schemaMigrations.map((migration) => migration.version));

    expect(finalVersion).toBe(highestVersion);
    expect(currentSchemaVersion()).toBe(highestVersion);
  });

  test('DB at version N runs only migrations above N', () => {
    recordSchemaVersion(2);
    const applied = [];

    const finalVersion = runSchemaMigrations([
      { version: 1, up: () => applied.push(1) },
      { version: 2, up: () => applied.push(2) },
      { version: 3, up: () => applied.push(3) },
      { version: 4, up: () => applied.push(4) },
    ]);

    expect(applied).toEqual([3, 4]);
    expect(finalVersion).toBe(4);
    expect(currentSchemaVersion()).toBe(4);
  });

  test('failed migration rolls back and does not advance schema version', () => {
    recordSchemaVersion(10);

    expect(() => runSchemaMigrations([
      {
        version: 11,
        up: () => {
          db.exec('CREATE TABLE migration_should_rollback (id INTEGER PRIMARY KEY)');
          throw new Error('migration failed');
        },
      },
    ])).toThrow('migration failed');

    expect(currentSchemaVersion()).toBe(10);
    expect(tableExists('migration_should_rollback')).toBe(false);
  });
});
