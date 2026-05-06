const { db } = require('../../database/db');
const logger = require('./logger');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const DEFAULT_PREFS = {
  budget_overspend: true,
  large_transaction: true,
  recurring_transaction: true,
  admin_announcement: true,
  password_changed: true,
  unknown_device_login: true,
};

function nowIso() {
  return new Date().toISOString();
}

function preferenceEnabled(userId, type) {
  const key = Object.prototype.hasOwnProperty.call(DEFAULT_PREFS, type) ? type : null;
  if (!key) return true;
  const row = db.prepare('SELECT enabled FROM notification_preferences WHERE user_id = ? AND type = ?').get(userId, key);
  return row ? Boolean(row.enabled) : DEFAULT_PREFS[key];
}

function upsertDefaultPreferences(userId) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO notification_preferences (user_id, type, enabled, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  const now = nowIso();
  Object.entries(DEFAULT_PREFS).forEach(([type, enabled]) => insert.run(userId, type, enabled ? 1 : 0, now));
}

async function sendPushNotification(userId, title, body, data = {}) {
  const type = data.type || 'general';
  if (!preferenceEnabled(userId, type)) {
    logger.info('Push notification skipped by user preference', { userId, type });
    return { skipped: true, reason: 'preference' };
  }

  const tokens = db.prepare('SELECT id, token FROM push_tokens WHERE user_id = ?').all(userId);
  if (!tokens.length) return { sent: 0, tickets: [] };

  const messages = tokens.map((row) => ({
    to: row.token,
    sound: 'default',
    title,
    body,
    data,
  }));

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    throw new Error(`Expo Push API failed with status ${response.status}`);
  }

  const payload = await response.json();
  const tickets = Array.isArray(payload.data) ? payload.data : [];
  tickets.forEach((ticket, index) => {
    if (ticket?.status !== 'error') return;
    const token = tokens[index];
    logger.warn('Expo push ticket error', { userId, tokenId: token?.id, details: ticket.details, message: ticket.message });
    if (ticket.details?.error === 'DeviceNotRegistered' && token) {
      db.prepare('DELETE FROM push_tokens WHERE id = ?').run(token.id);
    }
  });

  return { sent: messages.length, tickets };
}

module.exports = {
  DEFAULT_PREFS,
  upsertDefaultPreferences,
  sendPushNotification,
};
