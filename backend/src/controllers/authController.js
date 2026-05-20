const crypto = require('crypto');
const { db } = require('../../database/db');
const { addImpersonationAuditContext, serializeAuditValue } = require('../utils/audit');
const { clientIp } = require('../utils/clientIp');
const { blockAccessToken } = require('../utils/accessTokenBlocklist');
const logger = require('../utils/logger');
const { createDefaultCashAccount } = require('../utils/defaultAccount');
const { parseBoolField, serializeMoney } = require('../utils/money');
const { DEFAULT_PREFS, sendPushNotification, upsertDefaultPreferences } = require('../utils/pushNotifications');
const {
  deliverEmailVerificationToken,
  deliverPasswordResetToken,
  maskEmail,
} = require('../utils/passwordResetDelivery');
const {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  sanitizeUser,
} = require('../utils/security');

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 30;
const REFRESH_TOKEN_DAYS = 30;
const PASSWORD_RESET_TOKEN_MINUTES = 30;
const EMAIL_VERIFICATION_TOKEN_HOURS = 24;
const MAX_ACTIVE_REFRESH_TOKENS = 10;
const CHANGE_PASSWORD_FAILURE_LIMIT = 3;
const dummyPasswordHashPromise = hashPassword(crypto.randomBytes(32).toString('hex'));
const PASSWORD_STRENGTH_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const changePasswordFailures = new Map();

function nowIso() {
  return new Date().toISOString();
}

function newSecurityStamp() {
  return crypto.randomBytes(32).toString('hex');
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function writeAuditLog(req, { userId, action, entityType = null, entityId = null, oldValue = null, newValue = null }) {
  db.prepare(`
    INSERT INTO audit_logs (
      id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    userId || null,
    action,
    entityType,
    entityId,
    serializeAuditValue(oldValue),
    serializeAuditValue(addImpersonationAuditContext(req, newValue)),
    clientIp(req),
    req.get('user-agent') || null,
    nowIso()
  );
}

function writeSecurityLog(req, { userId = null, action, newValue }) {
  db.prepare(`
    INSERT INTO audit_logs (
      id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, created_at
    )
    VALUES (?, ?, ?, 'security', NULL, NULL, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    userId,
    action,
    serializeAuditValue(newValue),
    clientIp(req),
    req.get('user-agent') || null,
    nowIso()
  );
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
}

function getDeletedUserByEmail(email) {
  return db.prepare('SELECT id FROM deleted_users WHERE email = ? ORDER BY deleted_at DESC LIMIT 1').get(email.toLowerCase());
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function isLocked(user) {
  return user.locked_until && new Date(user.locked_until).getTime() > Date.now();
}

function issueAccessToken(user) {
  return generateAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    must_change_password: Boolean(user.must_change_password),
    security_stamp: user.security_stamp,
  });
}

function passwordResetResponse(token) {
  const response = {
    success: true,
    message: 'If an account exists for that email, a password reset token has been sent.',
  };

  if (['development', 'test'].includes(process.env.NODE_ENV) && process.env.ALLOW_RESET_TOKEN_IN_RESPONSE === 'true') {
    response.resetToken = token;
  }

  return response;
}

function registerResponse(token) {
  const response = {
    success: true,
    message: 'If this email is not registered, an account has been created. Check your email to verify your account.',
  };

  if (['development', 'test'].includes(process.env.NODE_ENV) && process.env.ALLOW_VERIFICATION_TOKEN_IN_RESPONSE === 'true') {
    response.verificationToken = token;
  }

  return response;
}

function verifyEmailResponse(token) {
  const response = {
    success: true,
    message: 'If an account exists for that email, a verification link has been sent.',
  };

  if (['development', 'test'].includes(process.env.NODE_ENV) && process.env.ALLOW_VERIFICATION_TOKEN_IN_RESPONSE === 'true') {
    response.verificationToken = token;
  }

  return response;
}

function emailVerificationRequired() {
  return process.env.REQUIRE_EMAIL_VERIFICATION === 'true'
    || (process.env.NODE_ENV !== 'test' && process.env.REQUIRE_EMAIL_VERIFICATION !== 'false');
}

function createEmailVerificationToken(req, user) {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationTokenHash = hashToken(verificationToken);
  const createdAt = nowIso();
  const expiresAt = addHours(new Date(), EMAIL_VERIFICATION_TOKEN_HOURS).toISOString();

  db.transaction(() => {
    db.prepare('UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(createdAt, user.id);
    db.prepare(`
      INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), user.id, verificationTokenHash, expiresAt, createdAt);

    writeAuditLog(req, {
      userId: user.id,
      action: 'EMAIL_VERIFICATION_REQUESTED',
      entityType: 'user',
      entityId: user.id,
      newValue: { email: user.email, expires_at: expiresAt },
    });
  })();

  return { verificationToken, expiresAt };
}

function cleanupFailedRegistration(userId, email) {
  return db.transaction(() => {
    db.prepare('DELETE FROM users WHERE id = ? AND email = ? AND email_verified_at IS NULL').run(userId, email);
  })();
}

function cleanupFailedPasswordReset(userId) {
  db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(nowIso(), userId);
}

function pruneRefreshTokens() {
  db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(nowIso());
}

function revokeOldestActiveRefreshTokens(userId, keepCount = MAX_ACTIVE_REFRESH_TOKENS - 1) {
  db.prepare(`
    UPDATE refresh_tokens
    SET revoked = 1
    WHERE id IN (
      SELECT id FROM refresh_tokens
      WHERE user_id = ? AND revoked = 0 AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT -1 OFFSET ?
    )
  `).run(userId, nowIso(), keepCount);
}

function refreshTokenFamilyId(token) {
  return token.family_id || token.id;
}

function revokeRefreshTokenFamily(req, storedToken, reason) {
  const familyId = refreshTokenFamilyId(storedToken);
  const result = db.prepare(`
    UPDATE refresh_tokens
    SET revoked = 1
    WHERE family_id = ? OR id = ?
  `).run(familyId, familyId);

  writeSecurityLog(req, {
    userId: storedToken.user_id,
    action: 'SECURITY_REFRESH_TOKEN_REUSE',
    newValue: {
      family_id: familyId,
      token_id: storedToken.id,
      reason,
      revoked: result.changes,
      ip_address: clientIp(req),
    },
  });

  logger.warn('Refresh token reuse detected; revoked token family', {
    userId: storedToken.user_id,
    familyId,
    tokenId: storedToken.id,
    revoked: result.changes,
    reason,
  });
}

async function register(req, res, next) {
  try {
    const email = req.body.email.toLowerCase();
    const fullName = req.body.full_name.trim();
    const password = req.body.password;
    const requiresEmailVerification = emailVerificationRequired();

    if (!PASSWORD_STRENGTH_REGEX.test(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters with an uppercase letter, a number, and a special character',
      });
    }

    const existingUser = getUserByEmail(email);

    if (existingUser) {
      await hashPassword(password);
      writeSecurityLog(req, {
        userId: existingUser.id,
        action: 'SECURITY_REGISTRATION_EXISTING_EMAIL',
        newValue: { email, reason: 'existing_email' },
      });
      return res.status(201).json(registerResponse(undefined));
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const createdAt = nowIso();
    const securityStamp = newSecurityStamp();

    let verification;
    const createUser = db.transaction(() => {
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, role, is_active, created_at, email_verified_at, security_stamp)
        VALUES (?, ?, ?, ?, 'user', 1, ?, ?, ?)
      `).run(userId, email, passwordHash, fullName, createdAt, requiresEmailVerification ? null : createdAt, securityStamp);

      const defaultAccount = createDefaultCashAccount(userId);
      const createdUser = getUserById(userId);

      writeAuditLog(req, {
        userId,
        action: 'USER_REGISTERED',
        entityType: 'user',
        entityId: userId,
        newValue: { email, full_name: fullName, role: 'user' },
      });

      writeAuditLog(req, {
        userId,
        action: 'ACCOUNT_CREATED',
        entityType: 'account',
        entityId: defaultAccount.id,
        newValue: defaultAccount,
      });

      if (requiresEmailVerification) {
        verification = createEmailVerificationToken(req, createdUser);
      }
    });

    createUser();
    if (requiresEmailVerification && verification) {
      try {
        await deliverEmailVerificationToken({ email, token: verification.verificationToken, expiresAt: verification.expiresAt });
      } catch (deliveryError) {
        logger.error('Email verification delivery failed', {
          email: maskEmail(email),
          error: deliveryError.message,
        });
        cleanupFailedRegistration(userId, email);
        return res.status(503).json({ error: 'Verification email could not be sent. Please try again later.' });
      }
      return res.status(201).json(registerResponse(verification.verificationToken));
    }

    return res.status(201).json({
      success: true,
      message: 'Account created successfully. You can now sign in.',
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Email is already registered' });
    }

    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const email = req.body.email.toLowerCase();
    const password = req.body.password;
    const user = getUserByEmail(email);

    if (!user) {
      await verifyPassword(password, await dummyPasswordHashPromise);
      const deletedUser = getDeletedUserByEmail(email);
      writeSecurityLog(req, {
        action: 'SECURITY_AUTH_FAILURE',
        newValue: { email, reason: deletedUser ? 'deleted_user' : 'unknown_email' },
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) {
      await verifyPassword(password, await dummyPasswordHashPromise);
      writeSecurityLog(req, {
        action: 'SECURITY_AUTH_FAILURE',
        userId: user.id,
        newValue: { email, reason: 'inactive_user' },
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (emailVerificationRequired() && !user.email_verified_at) {
      const passwordMatches = await verifyPassword(password, user.password_hash);
      writeSecurityLog(req, {
        action: 'SECURITY_AUTH_FAILURE',
        userId: user.id,
        newValue: { email, reason: 'email_unverified' },
      });
      if (!passwordMatches) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      return res.status(403).json({
        error: 'Please verify your email before signing in.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    if (isLocked(user)) {
      await verifyPassword(password, user.password_hash);
      writeSecurityLog(req, {
        action: 'SECURITY_ACCOUNT_LOCKED',
        userId: user.id,
        newValue: { email, reason: 'account_locked' },
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatches = await verifyPassword(password, user.password_hash);

    if (!passwordMatches) {
      const failedAttempts = (user.failed_login_attempts || 0) + 1;
      const lockedUntil = failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS
        ? addMinutes(new Date(), LOCK_MINUTES).toISOString()
        : null;

      db.prepare(`
        UPDATE users
        SET failed_login_attempts = ?, locked_until = ?, updated_at = ?
        WHERE id = ?
      `).run(failedAttempts, lockedUntil, nowIso(), user.id);

      writeSecurityLog(req, {
        userId: user.id,
        action: failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS ? 'SECURITY_ACCOUNT_LOCKED' : 'SECURITY_AUTH_FAILURE',
        newValue: { email, reason: 'bad_password', failed_attempts: failedAttempts, locked_until: lockedUntil },
      });

      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashToken(refreshToken);
    const refreshFamilyId = crypto.randomUUID();
    const expiresAt = addDays(new Date(), REFRESH_TOKEN_DAYS).toISOString();
    const loginAt = nowIso();

    const completeLogin = db.transaction(() => {
      pruneRefreshTokens();
      revokeOldestActiveRefreshTokens(user.id);
      db.prepare(`
        UPDATE users
        SET failed_login_attempts = 0, locked_until = NULL, last_login = ?, updated_at = ?
        WHERE id = ?
      `).run(loginAt, loginAt, user.id);

      db.prepare(`
      INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, created_at, last_used_at, user_agent, revoked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(crypto.randomUUID(), user.id, refreshFamilyId, refreshTokenHash, expiresAt, loginAt, loginAt, req.get('user-agent') || null);

      writeAuditLog(req, {
        userId: user.id,
        action: 'USER_LOGIN',
        entityType: 'user',
        entityId: user.id,
      });
      upsertDefaultPreferences(user.id);
    });

    completeLogin();

    const updatedUser = getUserById(user.id);

    return res.status(200).json({
      accessToken: issueAccessToken(updatedUser),
      refreshToken,
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    return next(error);
  }
}

function refreshToken(req, res, next) {
  try {
    const tokenHash = hashToken(req.body.refreshToken);
    const nextRefreshToken = generateRefreshToken();
    const nextRefreshTokenHash = hashToken(nextRefreshToken);
    const createdAt = nowIso();
    const expiresAt = addDays(new Date(), REFRESH_TOKEN_DAYS).toISOString();
    let accessToken;
    let refreshError = null;

    db.transaction(() => {
      const storedToken = db.prepare(`
        SELECT refresh_tokens.*, users.email, users.role, users.is_active, users.must_change_password, users.security_stamp
        FROM refresh_tokens
        JOIN users ON users.id = refresh_tokens.user_id
        WHERE refresh_tokens.token_hash = ?
      `).get(tokenHash);

      if (!storedToken) {
        refreshError = Object.assign(new Error('Invalid refresh token'), { statusCode: 401 });
        return;
      }

      if (storedToken.revoked) {
        revokeRefreshTokenFamily(req, storedToken, 'revoked_token_presented');
        refreshError = Object.assign(new Error('Invalid refresh token'), { statusCode: 401 });
        return;
      }

      if (!storedToken.is_active) {
        refreshError = Object.assign(new Error('Invalid refresh token'), { statusCode: 401 });
        return;
      }

      if (new Date(storedToken.expires_at).getTime() <= Date.now()) {
        db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(storedToken.id);
        refreshError = Object.assign(new Error('Invalid refresh token'), { statusCode: 401 });
        return;
      }

      const revokeResult = db.prepare('UPDATE refresh_tokens SET revoked = 1, last_used_at = ? WHERE id = ? AND revoked = 0').run(createdAt, storedToken.id);
      if (revokeResult.changes !== 1) {
        revokeRefreshTokenFamily(req, storedToken, 'rotation_conflict');
        refreshError = Object.assign(new Error('Invalid refresh token'), { statusCode: 401 });
        return;
      }
      db.prepare(`
        INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, created_at, last_used_at, user_agent, revoked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(crypto.randomUUID(), storedToken.user_id, storedToken.family_id || storedToken.id, nextRefreshTokenHash, expiresAt, createdAt, createdAt, req.get('user-agent') || null);

      accessToken = issueAccessToken({
        id: storedToken.user_id,
        email: storedToken.email,
        role: storedToken.role,
        must_change_password: storedToken.must_change_password,
        security_stamp: storedToken.security_stamp,
      });
    })();

    if (refreshError) {
      throw refreshError;
    }

    return res.status(200).json({ accessToken, refreshToken: nextRefreshToken });
  } catch (error) {
    return next(error);
  }
}

function logout(req, res, next) {
  try {
    const tokenHash = hashToken(req.body.refreshToken);

    const result = db.prepare(`
      UPDATE refresh_tokens
      SET revoked = 1
      WHERE token_hash = ? AND user_id = ?
    `).run(tokenHash, req.user.id);

    if (result.changes === 0) {
      return res.status(400).json({ error: 'Refresh token not found or already revoked' });
    }

    blockAccessToken(req.auth?.jti, req.auth?.exp);

    writeAuditLog(req, {
      userId: req.user.id,
      action: 'USER_LOGOUT',
      entityType: 'user',
      entityId: req.user.id,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const email = req.body.email.toLowerCase();
    const user = getUserByEmail(email);

    if (!user || !user.is_active) {
      await verifyPassword('password-reset-padding', await dummyPasswordHashPromise);
      return res.status(200).json(passwordResetResponse(undefined));
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = hashToken(resetToken);
    const createdAt = nowIso();
    const expiresAt = addMinutes(new Date(), PASSWORD_RESET_TOKEN_MINUTES).toISOString();

    const createResetToken = db.transaction(() => {
      db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(createdAt, user.id);
      db.prepare(`
        INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), user.id, resetTokenHash, expiresAt, createdAt);

      writeAuditLog(req, {
        userId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'user',
        entityId: user.id,
        newValue: { email: user.email, expires_at: expiresAt },
      });
    });

    createResetToken();
    try {
      await deliverPasswordResetToken({ email: user.email, token: resetToken, expiresAt });
    } catch (deliveryError) {
      logger.error('Password reset delivery failed', {
        email: maskEmail(user.email),
        error: deliveryError.message,
      });
      cleanupFailedPasswordReset(user.id);
      return res.status(503).json({ error: 'Password reset email could not be sent. Please try again later.' });
    }

    return res.status(200).json(passwordResetResponse(resetToken));
  } catch (error) {
    return next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const tokenHash = hashToken(req.body.resetToken);
    const newPasswordHash = await hashPassword(req.body.newPassword);
    const updatedAt = nowIso();
    const securityStamp = newSecurityStamp();
    let storedToken;

    const completeReset = db.transaction(() => {
      const tokenUpdate = db.prepare(`
        UPDATE password_reset_tokens
        SET used_at = ?
        WHERE token_hash = ?
          AND used_at IS NULL
          AND expires_at > ?
          AND user_id IN (SELECT id FROM users WHERE is_active = 1)
      `).run(updatedAt, tokenHash, updatedAt);

      if (tokenUpdate.changes !== 1) {
        throw Object.assign(new Error('Invalid or expired reset token'), { statusCode: 400 });
      }

      storedToken = db.prepare(`
        SELECT password_reset_tokens.*, users.email, users.is_active
        FROM password_reset_tokens
        JOIN users ON users.id = password_reset_tokens.user_id
        WHERE password_reset_tokens.token_hash = ?
      `).get(tokenHash);

      if (!storedToken) {
        throw Object.assign(new Error('Token record missing after update'), { statusCode: 500 });
      }

      db.prepare(`
        UPDATE users
        SET password_hash = ?, must_change_password = 0, security_stamp = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = ?
        WHERE id = ?
      `).run(newPasswordHash, securityStamp, updatedAt, storedToken.user_id);

      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(storedToken.user_id);
      db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(updatedAt, storedToken.user_id);

      writeAuditLog(req, {
        userId: storedToken.user_id,
        action: 'PASSWORD_RESET_COMPLETED',
        entityType: 'user',
        entityId: storedToken.user_id,
        newValue: { email: storedToken.email },
      });
    });

    completeReset();

    return res.status(200).json({ success: true, message: 'Password has been reset successfully.' });
  } catch (error) {
    return next(error);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const tokenHash = hashToken(req.body.verificationToken);
    const verifiedAt = nowIso();
    let storedToken;

    const completeVerification = db.transaction(() => {
      const tokenUpdate = db.prepare(`
        UPDATE email_verification_tokens
        SET used_at = ?
        WHERE token_hash = ?
          AND used_at IS NULL
          AND expires_at > ?
          AND user_id IN (SELECT id FROM users WHERE is_active = 1)
      `).run(verifiedAt, tokenHash, verifiedAt);

      if (tokenUpdate.changes !== 1) {
        throw Object.assign(new Error('Invalid or expired verification token'), { statusCode: 400 });
      }

      storedToken = db.prepare(`
        SELECT email_verification_tokens.*, users.email
        FROM email_verification_tokens
        JOIN users ON users.id = email_verification_tokens.user_id
        WHERE email_verification_tokens.token_hash = ?
      `).get(tokenHash);

      if (!storedToken) {
        throw Object.assign(new Error('Token record missing after update'), { statusCode: 500 });
      }

      db.prepare('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?')
        .run(verifiedAt, verifiedAt, storedToken.user_id);
      db.prepare('UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
        .run(verifiedAt, storedToken.user_id);

      writeAuditLog(req, {
        userId: storedToken.user_id,
        action: 'EMAIL_VERIFIED',
        entityType: 'user',
        entityId: storedToken.user_id,
        newValue: { email: storedToken.email },
      });
    });

    completeVerification();

    return res.status(200).json({ success: true, message: 'Email verified. You can now sign in.' });
  } catch (error) {
    return next(error);
  }
}

async function resendVerification(req, res, next) {
  try {
    const email = req.body.email.toLowerCase();
    const user = getUserByEmail(email);

    if (!user || !user.is_active || user.email_verified_at) {
      await verifyPassword('email-verification-padding', await dummyPasswordHashPromise);
      return res.status(200).json(verifyEmailResponse(undefined));
    }

    const verification = createEmailVerificationToken(req, user);
    try {
      await deliverEmailVerificationToken({ email: user.email, token: verification.verificationToken, expiresAt: verification.expiresAt });
    } catch (deliveryError) {
      logger.error('Email verification delivery failed', {
        email: maskEmail(user.email),
        error: deliveryError.message,
      });
      return res.status(503).json({ error: 'Verification email could not be sent. Please try again later.' });
    }

    return res.status(200).json(verifyEmailResponse(verification.verificationToken));
  } catch (error) {
    return next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    const user = getUserById(req.user.id);

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const currentPasswordMatches = await verifyPassword(req.body.currentPassword, user.password_hash);

    if (!currentPasswordMatches) {
      const failures = (changePasswordFailures.get(user.id) || 0) + 1;
      changePasswordFailures.set(user.id, failures);
      writeSecurityLog(req, {
        userId: user.id,
        action: 'SECURITY_PASSWORD_CHANGE_FAILURE',
        newValue: { failed_attempts: failures },
      });
      if (failures >= CHANGE_PASSWORD_FAILURE_LIMIT) {
        db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(user.id);
        writeSecurityLog(req, {
          userId: user.id,
          action: 'SECURITY_PASSWORD_CHANGE_REAUTH_REQUIRED',
          newValue: { failed_attempts: failures },
        });
      }
      return res.status(401).json({ error: 'Invalid current password' });
    }

    const newPasswordHash = await hashPassword(req.body.newPassword);
    const updatedAt = nowIso();
    const nextRefreshToken = generateRefreshToken();
    const nextRefreshTokenHash = hashToken(nextRefreshToken);
    const nextRefreshFamilyId = crypto.randomUUID();
    const nextRefreshExpiresAt = addDays(new Date(), REFRESH_TOKEN_DAYS).toISOString();
    const securityStamp = newSecurityStamp();

    const updatePassword = db.transaction(() => {
      db.prepare(`
        UPDATE users
        SET password_hash = ?, must_change_password = 0, security_stamp = ?, updated_at = ?
        WHERE id = ?
      `).run(newPasswordHash, securityStamp, updatedAt, user.id);

      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(user.id);
      db.prepare(`
        INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, created_at, last_used_at, user_agent, revoked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(crypto.randomUUID(), user.id, nextRefreshFamilyId, nextRefreshTokenHash, nextRefreshExpiresAt, updatedAt, updatedAt, req.get('user-agent') || null);

      writeAuditLog(req, {
        userId: user.id,
        action: 'PASSWORD_CHANGED',
        entityType: 'user',
        entityId: user.id,
      });
    });

    try {
      updatePassword();
      changePasswordFailures.delete(user.id);
    } catch (transactionError) {
      logger.error('Password change transaction rolled back', {
        userId: user.id,
        error: transactionError.message,
      });
      throw transactionError;
    }

    const updatedUser = getUserById(user.id);
    void sendPushNotification(
      user.id,
      'Your password was changed',
      "If this wasn't you, contact support immediately.",
      { type: 'password_changed' }
    ).catch((pushError) => logger.warn('Password change push failed', { userId: user.id, error: pushError.message }));
    return res.status(200).json({ success: true, accessToken: issueAccessToken(updatedUser), refreshToken: nextRefreshToken });
  } catch (error) {
    return next(error);
  }
}

function registerPushToken(req, res, next) {
  try {
    const token = String(req.body.token || '').trim();
    const platform = String(req.body.platform || '').trim().slice(0, 40);
    db.prepare(`
      INSERT INTO push_tokens (id, user_id, token, platform, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, token) DO UPDATE SET platform = excluded.platform
    `).run(crypto.randomUUID(), req.user.id, token, platform, nowIso());
    return res.status(201).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

function deregisterPushToken(req, res, next) {
  try {
    const token = String(req.body.token || '').trim();
    const result = db.prepare('DELETE FROM push_tokens WHERE user_id = ? AND token = ?').run(req.user.id, token);
    return res.json({ success: true, deleted: result.changes });
  } catch (error) {
    return next(error);
  }
}

function getNotificationSettings(req, res, next) {
  try {
    upsertDefaultPreferences(req.user.id);
    const rows = db.prepare('SELECT type, enabled FROM notification_preferences WHERE user_id = ?').all(req.user.id);
    return res.json({
      preferences: rows.reduce((acc, row) => ({ ...acc, [row.type]: Boolean(row.enabled) }), { ...DEFAULT_PREFS }),
    });
  } catch (error) {
    return next(error);
  }
}

function updateNotificationSettings(req, res, next) {
  try {
    upsertDefaultPreferences(req.user.id);
    const updates = req.body.preferences || {};
    const update = db.prepare('UPDATE notification_preferences SET enabled = ?, updated_at = ? WHERE user_id = ? AND type = ?');
    const updatedAt = nowIso();
    db.transaction(() => {
      Object.keys(DEFAULT_PREFS).forEach((type) => {
        if (Object.prototype.hasOwnProperty.call(updates, type)) {
          update.run(parseBoolField(updates[type]), updatedAt, req.user.id, type);
          // FIX: 4
        }
      });
    })();
    return getNotificationSettings(req, res, next);
  } catch (error) {
    return next(error);
  }
}

function getNotifications(req, res, next) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const rows = db.prepare(`
      SELECT id, user_id, type, title, body, data_json, read_at, created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(req.user.id, limit);
    return res.json({
      data: rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        type: row.type,
        title: row.title,
        body: row.body,
        data: row.data_json ? (() => { try { return JSON.parse(row.data_json); } catch { return null; } })() : null,
        read_at: row.read_at,
        created_at: row.created_at,
      })),
    });
  } catch (error) {
    return next(error);
  }
}

function markNotificationRead(req, res, next) {
  try {
    const readAt = nowIso();
    const result = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').run(readAt, req.params.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Notification not found' });
    return res.json({ success: true, read_at: readAt });
  } catch (error) {
    return next(error);
  }
}

function getMe(req, res) {
  return res.status(200).json(sanitizeUser(req.user));
}

function getCsrfToken(req, res) {
  return res.status(200).json({ csrfToken: req.csrfToken });
}

function getSessions(req, res, next) {
  try {
    const sessions = db.prepare(`
      SELECT id, created_at, expires_at, last_used_at, user_agent
      FROM refresh_tokens
      WHERE user_id = ? AND revoked = 0 AND expires_at > ?
      ORDER BY created_at DESC
    `).all(req.user.id, nowIso()).map((session) => ({
      ...session,
      device_hint: session.user_agent ? String(session.user_agent).slice(0, 120) : 'Unknown device',
    }));

    return res.json({
      active_sessions: sessions.length,
      sessions,
    });
  } catch (error) {
    return next(error);
  }
}

function revokeSession(req, res, next) {
  try {
    const result = db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ? AND user_id = ?')
      .run(req.params.sessionId, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Session not found' });
    writeAuditLog(req, {
      userId: req.user.id,
      action: 'USER_REVOKED_SESSION',
      entityType: 'refresh_token',
      entityId: req.params.sessionId,
    });
    return res.json({ success: true, revoked: 1 });
  } catch (error) {
    return next(error);
  }
}

function revokeOtherSessions(req, res, next) {
  try {
    const refreshToken = req.body.refreshToken;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken is required' });
    const tokenHash = hashToken(refreshToken);
    const current = db.prepare('SELECT id FROM refresh_tokens WHERE token_hash = ? AND user_id = ? AND revoked = 0 AND expires_at > ?')
      .get(tokenHash, req.user.id, nowIso());
    if (!current) return res.status(401).json({ error: 'Invalid refresh token' });

    const result = db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND id != ? AND revoked = 0')
      .run(req.user.id, current.id);
    writeAuditLog(req, {
      userId: req.user.id,
      action: 'USER_REVOKED_OTHER_SESSIONS',
      entityType: 'refresh_token',
      entityId: current.id,
      newValue: { revoked: result.changes },
    });
    return res.json({ success: true, revoked: result.changes });
  } catch (error) {
    return next(error);
  }
}

function updateMe(req, res, next) {
  try {
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'full_name')) {
      updates.full_name = req.body.full_name.trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'avatar_color')) {
      updates.avatar_color = req.body.avatar_color;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'currency')) {
      updates.currency = req.body.currency;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'has_completed_onboarding')) {
      updates.has_completed_onboarding = parseBoolField(req.body.has_completed_onboarding);
      // FIX: 4
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No profile fields provided' });
    }

    updates.updated_at = nowIso();
    const setSql = Object.keys(updates).map((field) => `${field} = @${field}`).join(', ');
    db.prepare(`UPDATE users SET ${setSql} WHERE id = @id`).run({ ...updates, id: req.user.id });

    const updated = getUserById(req.user.id);

    return res.json(sanitizeUser(updated));
  } catch (error) {
    return next(error);
  }
}

function exportMyData(req, res, next) {
  try {
    const userId = req.user.id;
    const payload = {
      exported_at: nowIso(),
      user: sanitizeUser(getUserById(userId)),
      // Include inactive accounts as user-owned export metadata; hidden transactions remain excluded below.
      accounts: db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      transactions: db.prepare('SELECT * FROM transactions WHERE user_id = ? AND admin_deleted_at IS NULL ORDER BY date DESC, created_at DESC').all(userId),
      budgets: db.prepare('SELECT * FROM budgets WHERE user_id = ? ORDER BY start_date DESC, created_at DESC').all(userId),
      categories: db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC, name ASC').all(userId),
      audit_logs: db.prepare('SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC').all(userId),
    };

    writeAuditLog(req, {
      userId,
      action: 'USER_DATA_EXPORTED',
      entityType: 'user',
      entityId: userId,
      newValue: {
        accounts: payload.accounts.length,
        transactions: payload.transactions.length,
        budgets: payload.budgets.length,
        categories: payload.categories.length,
        audit_logs: payload.audit_logs.length,
      },
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="financeapp-data-${userId}.json"`);
    return res.status(200).send(JSON.stringify(serializeMoney(payload), null, 2));
  } catch (error) {
    return next(error);
  }
}

function deleteMyData(req, res, next) {
  try {
    const before = {
      transactions: db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?').get(req.user.id).count,
      budgets: db.prepare('SELECT COUNT(*) AS count FROM budgets WHERE user_id = ?').get(req.user.id).count,
      accounts: db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?').get(req.user.id).count,
      categories: db.prepare('SELECT COUNT(*) AS count FROM categories WHERE user_id = ?').get(req.user.id).count,
    };

    db.transaction(() => {
      db.prepare('DELETE FROM transactions WHERE user_id = ?').run(req.user.id);
      db.prepare('DELETE FROM budgets WHERE user_id = ?').run(req.user.id);
      db.prepare('DELETE FROM accounts WHERE user_id = ?').run(req.user.id);
      db.prepare('DELETE FROM categories WHERE user_id = ?').run(req.user.id);
      const defaultAccount = createDefaultCashAccount(req.user.id);
      writeAuditLog(req, {
        userId: req.user.id,
        action: 'USER_DATA_DELETED',
        entityType: 'user',
        entityId: req.user.id,
        oldValue: before,
        newValue: { default_account_id: defaultAccount.id },
      });
    })();

    return res.json({ success: true, deleted: before });
  } catch (error) {
    return next(error);
  }
}

async function deleteMyAccount(req, res, next) {
  try {
    if (req.body?.confirmation !== 'DELETE') {
      return res.status(400).json({ error: 'Type DELETE to confirm account deletion' });
    }

    const userId = req.user.id;
    const before = {
      transactions: db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?').get(userId).count,
      budgets: db.prepare('SELECT COUNT(*) AS count FROM budgets WHERE user_id = ?').get(userId).count,
      accounts: db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?').get(userId).count,
      categories: db.prepare('SELECT COUNT(*) AS count FROM categories WHERE user_id = ?').get(userId).count,
    };
    const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
    const deletedEmail = `deleted-${userId}@deleted.local`;
    const deletedAt = nowIso();

    db.transaction(() => {
      db.prepare('DELETE FROM transactions WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM budgets WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM accounts WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM categories WHERE user_id = ?').run(userId);
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
      db.prepare(`
        UPDATE users
        SET email = ?, full_name = ?, password_hash = ?, avatar_color = '#6C757D',
            is_active = 0, must_change_password = 0, email_verified_at = NULL,
            security_stamp = ?, updated_at = ?
        WHERE id = ?
      `).run(deletedEmail, `Deleted User ${userId.slice(0, 8)}`, passwordHash, newSecurityStamp(), deletedAt, userId);
      writeAuditLog(req, {
        userId,
        action: 'USER_ACCOUNT_DELETED',
        entityType: 'user',
        entityId: userId,
        oldValue: before,
        newValue: { anonymized: true, deleted_at: deletedAt },
      });
    })();

    if (req.auth?.jti && req.auth?.exp) {
      blockAccessToken(req.auth.jti, req.auth.exp);
    }

    return res.json({ success: true, deleted: before });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  changePassword,
  getCsrfToken,
  getMe,
  getSessions,
  revokeSession,
  revokeOtherSessions,
  registerPushToken,
  deregisterPushToken,
  getNotificationSettings,
  updateNotificationSettings,
  getNotifications,
  markNotificationRead,
  updateMe,
  exportMyData,
  deleteMyData,
  deleteMyAccount,
};
