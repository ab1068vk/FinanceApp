const crypto = require('crypto');

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_COOKIE_NAME = 'financeapp_csrf';
const AUTH_EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
]);

function cookieOptions() {
  const secure = process.env.NODE_ENV === 'production';
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : null,
    'Max-Age=7200',
  ].filter(Boolean).join('; ');
}

function parseCookies(header = '') {
  return String(header).split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index === -1) return acc;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function csrfSecret() {
  return process.env.CSRF_SECRET || process.env.JWT_SECRET || 'development-csrf-secret';
}

function sign(nonce) {
  return crypto.createHmac('sha256', csrfSecret()).update(nonce).digest('base64url');
}

function createCsrfToken() {
  const nonce = crypto.randomBytes(32).toString('base64url');
  return `${nonce}.${sign(nonce)}`;
}

function isValidToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [nonce, signature] = token.split('.');
  if (!nonce || !signature) return false;
  const expected = sign(nonce);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return signatureBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

function setCsrfCookie(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies[CSRF_COOKIE_NAME];
  const token = isValidToken(existing) ? existing : createCsrfToken();
  res.setHeader('Set-Cookie', `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieOptions()}`);
  res.setHeader('X-CSRF-Token', token);
  req.csrfToken = token;
  return token;
}

function hasBearerToken(req) {
  return /^Bearer\s+\S+/i.test(req.headers.authorization || '');
}

function csrfProtection(req, res, next) {
  const token = setCsrfCookie(req, res);
  if (!STATE_CHANGING_METHODS.has(req.method)) return next();
  if (AUTH_EXEMPT_PATHS.has(req.path)) return next();
  if (hasBearerToken(req)) return next();

  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const provided = req.get('x-csrf-token') || req.body?._csrf;

  if (!provided || provided !== cookieToken || provided !== token || !isValidToken(provided)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  return next();
}

module.exports = {
  createCsrfToken,
  csrfProtection,
  parseCookies,
};
