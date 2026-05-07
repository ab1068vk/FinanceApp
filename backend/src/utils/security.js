const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const saltRounds = 12;
const JWT_ALGORITHM = 'HS256';
const ENCRYPTED_PREFIX = 'enc:v1';

function assertJwtSecret(secret = process.env.JWT_SECRET) {
  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes of high-entropy data');
  }
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, saltRounds);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function generateAccessToken(payload) {
  assertJwtSecret();

  if (!payload || typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('Access token payload must include a subject in the sub claim');
  }

  const options = {
    algorithm: JWT_ALGORITHM,
    expiresIn: '15m',
    jwtid: crypto.randomUUID(),
  };
  if (process.env.JWT_ISSUER) options.issuer = process.env.JWT_ISSUER;
  if (process.env.JWT_AUDIENCE) options.audience = process.env.JWT_AUDIENCE;

  return jwt.sign(payload, process.env.JWT_SECRET, options);
}

function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function secretEncryptionKey() {
  const material = process.env.WEBHOOK_SECRET_KEY || process.env.JWT_SECRET;
  if (!material) {
    throw new Error('WEBHOOK_SECRET_KEY or JWT_SECRET is required to protect webhook secrets');
  }
  return crypto.createHash('sha256').update(material).digest();
}

function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith(`${ENCRYPTED_PREFIX}:`);
}

function encryptSecret(value) {
  if (value === null || value === undefined || value === '') return null;
  if (isEncryptedSecret(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTED_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

function decryptSecret(value) {
  if (!value || !isEncryptedSecret(value)) return value || null;
  const [, , ivB64, tagB64, ciphertextB64] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretEncryptionKey(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function sanitizeUser(user) {
  if (!user) {
    return user;
  }

  const safeUser = { ...user };
  delete safeUser.password_hash;
  return safeUser;
}

module.exports = {
  JWT_ALGORITHM,
  assertJwtSecret,
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
  sanitizeUser,
};
