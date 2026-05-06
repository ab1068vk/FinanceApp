const jwt = require('jsonwebtoken');
const { db } = require('../../database/db');
const { JWT_ALGORITHM, hashToken, sanitizeUser } = require('../utils/security');
const { isAccessTokenBlocked } = require('../utils/accessTokenBlocklist');

function nowIso() {
  return new Date().toISOString();
}

function authenticateApiToken(token, req, res, next) {
  const row = db.prepare(`
    SELECT t.id AS token_id, t.scopes, u.*
    FROM admin_api_tokens t
    JOIN users u ON u.id = t.created_by
    WHERE t.token_hash = ?
      AND t.is_active = 1
      AND t.revoked_at IS NULL
      AND u.is_active = 1
  `).get(hashToken(token));

  if (!row) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  db.prepare('UPDATE admin_api_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.token_id);
  const { token_id: tokenId, scopes, ...user } = row;
  req.auth = {
    api_token_id: tokenId,
    scopes: JSON.parse(scopes || '[]'),
    sub: user.id,
    token_type: 'admin_api_token',
  };
  req.accessToken = token;
  req.user = sanitizeUser(user);
  return next();
}

function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (token.startsWith('fa_')) {
      return authenticateApiToken(token, req, res, next);
    }

    const verifyOptions = { algorithms: [JWT_ALGORITHM] };
    if (process.env.JWT_ISSUER) verifyOptions.issuer = process.env.JWT_ISSUER;
    if (process.env.JWT_AUDIENCE) verifyOptions.audience = process.env.JWT_AUDIENCE;

    const decoded = jwt.verify(token, process.env.JWT_SECRET, verifyOptions);
    const userId = decoded.sub;

    if (!userId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(userId);

    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (isAccessTokenBlocked(decoded.jti)) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (!decoded.security_stamp || decoded.security_stamp !== user.security_stamp) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const isChangePasswordRoute = req.method === 'PUT' && req.originalUrl.split('?')[0] === '/api/auth/change-password';
    if ((decoded.must_change_password || user.must_change_password) && !isChangePasswordRoute) {
      return res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED' });
    }

    req.auth = decoded;
    req.accessToken = token;
    req.user = sanitizeUser(user);
    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }

    return next(error);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  return next();
}

function requireAdminScope(scope) {
  return (req, res, next) => {
    if (req.auth?.token_type !== 'admin_api_token') return next();
    const scopes = Array.isArray(req.auth.scopes) ? req.auth.scopes : [];
    if (scopes.includes(scope) || scopes.includes('admin:*')) return next();
    return res.status(403).json({ error: `API token scope required: ${scope}` });
  };
}

function requireOwnership(getOwnerId) {
  return async function ownershipMiddleware(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (req.user.role === 'admin') {
        return next();
      }

      const ownerId = typeof getOwnerId === 'function'
        ? await getOwnerId(req)
        : req.params.userId;

      if (!ownerId || ownerId !== req.user.id) {
        return res.status(403).json({ error: 'Resource access denied' });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireAdminScope,
  requireOwnership,
};
