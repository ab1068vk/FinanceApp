const crypto = require('crypto');
const { db } = require('../../database/db');
const { serializeAuditValue } = require('../utils/audit');
const { clientIp } = require('../utils/clientIp');
const { pagination, paginationMeta } = require('../utils/pagination');
const { serializeMoney } = require('../utils/money');

function nowIso() { return new Date().toISOString(); }
function audit(req, action, entityType, entityId, oldValue = null, newValue = null) {
  db.prepare(`INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(), req.user.id, action, entityType, entityId,
    serializeAuditValue(oldValue),
    serializeAuditValue(newValue),
    clientIp(req), req.get('user-agent') || null, nowIso()
  );
}

function normalizeCategoryName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function categoryNameExists(userId, name, type, excludeId = null) {
  return db.prepare(`
    SELECT id
    FROM categories
    WHERE user_id = ?
      AND name = ? COLLATE NOCASE
      AND type = ?
      AND (? IS NULL OR id != ?)
    LIMIT 1
  `).get(userId, name, type, excludeId, excludeId);
}

function getCategories(req, res, next) {
  try {
    const { page, limit, offset } = pagination(req);
    const rows = db.prepare(`
      SELECT * FROM categories
      WHERE (user_id IS NULL OR user_id = ?)
        AND is_active = 1
      ORDER BY type ASC,
        CASE WHEN user_id = ? THEN 0 ELSE 1 END ASC,
        is_default DESC,
        sort_order ASC,
        name ASC
    `).all(req.user.id, req.user.id);
    const seen = new Set();
    const categories = rows.filter((category) => {
      const key = `${category.type}:${normalizeCategoryName(category.name).toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((left, right) => {
      if (left.type !== right.type) return String(left.type).localeCompare(String(right.type));
      if ((right.is_default || 0) !== (left.is_default || 0)) return (right.is_default || 0) - (left.is_default || 0);
      if ((left.sort_order || 0) !== (right.sort_order || 0)) return (left.sort_order || 0) - (right.sort_order || 0);
      return String(left.name).localeCompare(String(right.name));
    });
    const total = categories.length;
    const data = categories.slice(offset, offset + limit);
    return res.json({ data: serializeMoney(data), pagination: paginationMeta(page, limit, total) });
  } catch (error) { return next(error); }
}

function createCategory(req, res, next) {
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM categories WHERE user_id = ? AND type = ?').get(req.user.id, req.body.type);
    const name = normalizeCategoryName(req.body.name);
    if (categoryNameExists(req.user.id, name, req.body.type)) return res.status(409).json({ error: 'Category already exists' });
    const category = {
      id: crypto.randomUUID(), user_id: req.user.id, name, icon: req.body.icon || null,
      color: req.body.color || null, type: req.body.type, is_default: 0, is_system: 0, is_active: 1,
      sort_order: maxOrder.max_order + 10, created_at: nowIso(),
    };
    db.transaction(() => {
      db.prepare(`INSERT INTO categories (id, user_id, name, icon, color, type, is_default, is_system, is_active, sort_order, created_at)
        VALUES (@id, @user_id, @name, @icon, @color, @type, @is_default, @is_system, @is_active, @sort_order, @created_at)`).run(category);
      audit(req, 'CATEGORY_CREATED', 'category', category.id, null, category);
    })();
    return res.status(201).json(serializeMoney(category));
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Category already exists' });
    return next(error);
  }
}

function updateCategory(req, res, next) {
  try {
    const oldCategory = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!oldCategory) return res.status(404).json({ error: 'Category not found' });
    const allowed = ['name', 'icon', 'color', 'type'];
    const updates = {};
    for (const field of allowed) if (Object.prototype.hasOwnProperty.call(req.body, field)) updates[field] = field === 'name' ? normalizeCategoryName(req.body[field]) : req.body[field];
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No allowed fields provided' });
    const nextName = Object.prototype.hasOwnProperty.call(updates, 'name') ? updates.name : oldCategory.name;
    const nextType = Object.prototype.hasOwnProperty.call(updates, 'type') ? updates.type : oldCategory.type;
    if (categoryNameExists(req.user.id, nextName, nextType, req.params.id)) return res.status(409).json({ error: 'Category already exists' });
    const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
    let newCategory;
    db.transaction(() => {
      db.prepare(`UPDATE categories SET ${setSql} WHERE id = @id AND user_id = @user_id`).run({ ...updates, id: req.params.id, user_id: req.user.id });
      newCategory = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      audit(req, 'CATEGORY_UPDATED', 'category', req.params.id, oldCategory, newCategory);
    })();
    return res.json(serializeMoney(newCategory));
  } catch (error) { return next(error); }
}

function reorderCategories(req, res, next) {
  try {
    const ids = req.body.category_ids;
    let rows;
    let categories;
    db.transaction(() => {
      rows = db.prepare('SELECT * FROM categories WHERE user_id = ? AND id IN (' + ids.map(() => '?').join(',') + ')').all(req.user.id, ...ids);
      if (rows.length !== ids.length) throw Object.assign(new Error('Only owned custom categories can be reordered'), { statusCode: 400 });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const update = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ? AND user_id = ?');
      ids.forEach((id, index) => update.run((index + 1) * 10, id, req.user.id));
      categories = ids.map((id, index) => ({ ...byId.get(id), sort_order: (index + 1) * 10 }));
      audit(req, 'CATEGORY_REORDERED', 'category', req.user.id, rows, categories);
    })();
    return res.json(serializeMoney(categories));
  } catch (error) { return next(error); }
}

function deleteCategory(req, res, next) {
  try {
    const category = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!category) return res.status(404).json({ error: 'Category not found' });
    db.transaction(() => {
      db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
      audit(req, 'CATEGORY_DELETED', 'category', req.params.id, category, null);
    })();
    return res.json({ success: true });
  } catch (error) { return next(error); }
}

module.exports = { getCategories, createCategory, updateCategory, reorderCategories, deleteCategory };
