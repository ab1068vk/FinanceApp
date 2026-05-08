const { db } = require('../../database/db');

const PRUNE_INTERVAL_MS = 60_000;
let lastPruneTime = 0;

// WARNING: This Map is an in-memory process-local cache of blocked JTIs.
// The database remains the source of truth, but deployments using separate
// databases per instance still need a shared store for reliable invalidation.
const blockedJtis = new Map();

function pruneExpiredBlockedTokens(now = Date.now()) {
  const currentTime = Date.now();
  if (currentTime - lastPruneTime < PRUNE_INTERVAL_MS) return;

  for (const [jti, expiresAtMs] of blockedJtis.entries()) {
    if (expiresAtMs <= now) blockedJtis.delete(jti);
  }

  try {
    db.prepare('DELETE FROM access_token_blocklist WHERE expires_at <= ?').run(new Date(now).toISOString());
  } catch {
    // Reads fail closed in isAccessTokenBlocked; pruning is best-effort.
  }

  lastPruneTime = currentTime;
}

function blockAccessToken(jti, expiresAtSeconds) {
  if (!jti || !expiresAtSeconds) return;
  const expiresAtMs = expiresAtSeconds * 1000;
  if (expiresAtMs <= Date.now()) return;
  const expiresAt = new Date(expiresAtMs).toISOString();
  pruneExpiredBlockedTokens();
  blockedJtis.set(jti, expiresAtMs);
  db.prepare(`
    INSERT INTO access_token_blocklist (jti, expires_at, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(jti) DO UPDATE SET expires_at = excluded.expires_at
  `).run(jti, expiresAt, new Date().toISOString());
}

function isAccessTokenBlocked(jti) {
  if (!jti) return false;
  pruneExpiredBlockedTokens();
  const cachedExpiry = blockedJtis.get(jti);
  if (cachedExpiry && cachedExpiry > Date.now()) return true;

  try {
    const row = db.prepare('SELECT expires_at FROM access_token_blocklist WHERE jti = ? AND expires_at > ?')
      .get(jti, new Date().toISOString());
    if (!row) return false;
    blockedJtis.set(jti, new Date(row.expires_at).getTime());
    return true;
  } catch {
    return true;
  }
}

module.exports = {
  blockAccessToken,
  isAccessTokenBlocked,
  pruneExpiredBlockedTokens,
};
