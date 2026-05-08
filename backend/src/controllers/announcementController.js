const { db } = require('../../database/db');
const { pagination, paginationMeta } = require('../utils/pagination');
const { serializeMoney } = require('../utils/money');

function getActiveAnnouncements(req, res, next) {
  try {
    const now = new Date().toISOString();
    const { page, limit, offset } = pagination(req);
    const total = db.prepare(`
      SELECT COUNT(*) AS count
      FROM announcements a
      LEFT JOIN announcement_dismissals d
        ON d.announcement_id = a.id
       AND d.user_id = ?
      WHERE a.is_active = 1
        AND d.announcement_id IS NULL
        AND (a.starts_at IS NULL OR a.starts_at <= ?)
        AND (a.ends_at IS NULL OR a.ends_at >= ?)
    `).get(req.user.id, now, now).count;
    const rows = db.prepare(`
      SELECT a.id, a.title, a.body, a.starts_at, a.ends_at, a.created_at, a.updated_at
      FROM announcements a
      LEFT JOIN announcement_dismissals d
        ON d.announcement_id = a.id
       AND d.user_id = ?
      WHERE a.is_active = 1
        AND d.announcement_id IS NULL
        AND (a.starts_at IS NULL OR a.starts_at <= ?)
        AND (a.ends_at IS NULL OR a.ends_at >= ?)
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, now, now, limit, offset);
    return res.json({ data: serializeMoney(rows), pagination: paginationMeta(page, limit, total) });
  } catch (error) {
    return next(error);
  }
}

function dismissAnnouncement(req, res, next) {
  try {
    const announcement = db.prepare('SELECT id FROM announcements WHERE id = ?').get(req.params.id);
    if (!announcement) return res.status(404).json({ error: 'Announcement not found' });
    db.prepare(`
      INSERT OR REPLACE INTO announcement_dismissals (announcement_id, user_id, dismissed_at)
      VALUES (?, ?, ?)
    `).run(req.params.id, req.user.id, new Date().toISOString());
    return res.json({ success: true, id: req.params.id });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getActiveAnnouncements, dismissAnnouncement };
