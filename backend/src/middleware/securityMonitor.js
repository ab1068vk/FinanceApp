const crypto = require('crypto');
const { db } = require('../../database/db');
const logger = require('../utils/logger');
const { serializeAuditValue } = require('../utils/audit');
const { clientIp } = require('../utils/clientIp');

const patterns = [
  { type: 'xss', pattern: /<\s*script\b|javascript:|onerror\s*=|onload\s*=|<\s*img\b|<\s*iframe\b/i },
  { type: 'sql_injection', pattern: /(\bunion\b(?:\s|\/\*.*?\*\/)+\bselect\b|\bor\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+|\bdrop\b\s+\btable\b|\bwaitfor\b\s+\bdelay\b|0x[0-9a-f]{8,}|--|;\s*(select|insert|update|delete|drop)\b)/i },
  { type: 'path_traversal', pattern: /\.\.[/\\]|%2e%2e/i },
  { type: 'command_injection', pattern: /(\|\||&&|;\s*(cat|ls|curl|wget|powershell|cmd|bash)\b)/i },
];
const STRIKE_WINDOW_MS = Number(process.env.SECURITY_STRIKE_WINDOW_MS) || 10 * 60 * 1000;
const STRIKE_LIMIT = Number(process.env.SECURITY_STRIKE_LIMIT) || 5;
const BLOCK_MS = Number(process.env.SECURITY_BLOCK_MS) || 10 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function stateFromRow(row) {
  if (!row) return null;
  return {
    count: row.count || 0,
    firstSeen: new Date(row.first_seen).getTime(),
    blockedUntil: row.blocked_until ? new Date(row.blocked_until).getTime() : 0,
  };
}

function getStrikeState(ip) {
  return stateFromRow(db.prepare('SELECT * FROM security_ip_blocks WHERE ip = ?').get(ip));
}

function persistStrikeState(ip, state, reason = null) {
  const firstSeen = new Date(state.firstSeen).toISOString();
  const blockedUntil = state.blockedUntil ? new Date(state.blockedUntil).toISOString() : null;
  db.prepare(`
    INSERT INTO security_ip_blocks (ip, count, first_seen, blocked_until, reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ip) DO UPDATE SET
      count = excluded.count,
      first_seen = excluded.first_seen,
      blocked_until = excluded.blocked_until,
      reason = COALESCE(excluded.reason, security_ip_blocks.reason),
      updated_at = excluded.updated_at
  `).run(ip, state.count, firstSeen, blockedUntil, reason, nowIso(), nowIso());
}

function preview(value) {
  return String(value).slice(0, 500);
}

function walk(value, path = []) {
  const findings = [];
  if (typeof value === 'string') {
    for (const check of patterns) {
      if (check.pattern.test(value)) {
        findings.push({ attack_type: check.type, input_path: path.join('.') || 'root', input_preview: preview(value) });
      }
    }
    return findings;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => findings.push(...walk(item, [...path, String(index)])));
    return findings;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => findings.push(...walk(item, [...path, key])));
  }
  return findings;
}

function recordSecurityEvent(req, findings) {
  if (!findings.length) return;

  const payload = {
    request_id: req.id,
    method: req.method,
    path: req.originalUrl,
    findings,
  };

  try {
    db.prepare(`
      INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at)
      VALUES (?, NULL, 'SECURITY_ATTACK_ATTEMPT', 'security', NULL, NULL, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      serializeAuditValue(payload),
      clientIp(req),
      req.get('user-agent') || null,
      nowIso()
    );
  } catch (error) {
    logger.error('Failed to record security event', { error: error.message });
  }

  logger.warn('Potential attack input detected', {
    method: req.method,
    path: req.originalUrl,
    requestId: req.id,
    ip: clientIp(req),
    findings,
  });
}

function updateStrikeState(ip) {
  const now = Date.now();
  const current = getStrikeState(ip) || { count: 0, firstSeen: now, blockedUntil: 0 };
  if (current.blockedUntil > now) return current;

  const next = now - current.firstSeen > STRIKE_WINDOW_MS
    ? { count: 1, firstSeen: now, blockedUntil: 0 }
    : { ...current, count: current.count + 1 };

  if (next.count >= STRIKE_LIMIT) {
    next.blockedUntil = now + BLOCK_MS;
  }

  persistStrikeState(ip, next, next.blockedUntil > now ? 'security-monitor' : null);
  return next;
}

function hasHighConfidenceFinding(findings) {
  return findings.some((finding) => (
    finding.attack_type === 'path_traversal'
    || (finding.attack_type === 'sql_injection' && /\bdrop\b\s+\btable\b/i.test(finding.input_preview))
    || finding.attack_type === 'command_injection'
  ));
}

function securityMonitor(req, res, next) {
  const ip = clientIp(req) || 'unknown';
  const existing = getStrikeState(ip);
  if (existing?.blockedUntil > Date.now()) {
    return res.status(429).json({ error: 'Too many invalid requests' });
  }

  const findings = [
    ...walk(req.body, ['body']),
    ...walk(req.query, ['query']),
    ...walk(req.params, ['params']),
  ];
  recordSecurityEvent(req, findings);
  if (findings.length) {
    const state = updateStrikeState(ip);
    if (hasHighConfidenceFinding(findings) || state.blockedUntil > Date.now()) {
      return res.status(429).json({ error: 'Too many invalid requests' });
    }
    return res.status(400).json({ error: 'Request contains invalid characters' });
  }
  return next();
}

function listSecurityBlocks() {
  const now = Date.now();
  return db.prepare('SELECT * FROM security_ip_blocks ORDER BY updated_at DESC, created_at DESC').all().map((row) => ({
    ip: row.ip,
    count: row.count,
    first_seen: row.first_seen,
    blocked_until: row.blocked_until,
    is_blocked: row.blocked_until ? new Date(row.blocked_until).getTime() > now : false,
    reason: row.reason,
  }));
}

function blockSecurityIp(ip, durationMs = BLOCK_MS) {
  const now = Date.now();
  const state = getStrikeState(ip) || { count: STRIKE_LIMIT, firstSeen: now, blockedUntil: 0 };
  const next = { ...state, count: Math.max(state.count, STRIKE_LIMIT), blockedUntil: now + durationMs };
  persistStrikeState(ip, next, 'admin-block');
  return {
    ip,
    count: next.count,
    first_seen: new Date(next.firstSeen).toISOString(),
    blocked_until: new Date(next.blockedUntil).toISOString(),
    is_blocked: true,
  };
}

function clearSecurityIp(ip) {
  return db.prepare('DELETE FROM security_ip_blocks WHERE ip = ?').run(ip).changes > 0;
}

module.exports = {
  blockSecurityIp,
  clearSecurityIp,
  listSecurityBlocks,
  securityMonitor,
};
