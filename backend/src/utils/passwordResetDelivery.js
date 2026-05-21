const logger = require('./logger');
const { hashToken } = require('./security');
const { assertSafeWebhookUrl } = require('./urlSafety');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

function maskEmail(value) {
  if (typeof value !== 'string' || !value.includes('@')) return '[REDACTED_EMAIL]';
  const domain = value.split('@').pop();
  return `***@${domain}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function boolEnv(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function assertSecureDeliveryUrl(rawUrl, label) {
  try {
    return assertSafeWebhookUrl(rawUrl);
  } catch (error) {
    const message = String(error.message || 'Webhook URL is not safe').replace(/^Webhook URL/, 'webhook URL');
    throw new Error(`${label} ${message}`);
  }
}

function browserFallbackUrlFor(token, pathSegment) {
  const candidate = process.env.APP_WEB_FALLBACK_URL || process.env.MOBILE_APP_ORIGIN || 'http://localhost:19006';
  const baseUrl = /^https?:\/\//i.test(candidate) ? candidate : 'http://localhost:19006';
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${pathSegment}`;
  url.searchParams.set('token', token);
  return url.toString();
}

function tokenUrlFor(token, pathSegment, envUrl) {
  if (!envUrl) {
    return `financeapp://${pathSegment}?token=${encodeURIComponent(token)}`;
  }
  const baseUrl = envUrl;

  try {
    if (baseUrl.includes('{token}')) {
      return baseUrl.replace('{token}', encodeURIComponent(token));
    }

    const url = new URL(baseUrl);
    const basePath = url.pathname.replace(/\/$/, '');
    if (url.protocol === 'financeapp:') {
      url.pathname = basePath;
      url.searchParams.set('token', token);
    } else {
      url.pathname = `${basePath}/${pathSegment}/${encodeURIComponent(token)}`;
    }
    return url.toString();
  } catch {
    return `${baseUrl.replace(/\/$/, '')}/${pathSegment}/${encodeURIComponent(token)}`;
  }
}

function resetUrlFor(token) {
  return tokenUrlFor(token, 'reset-password', process.env.PASSWORD_RESET_URL);
}

function verificationUrlFor(token) {
  return tokenUrlFor(token, 'verify-email', process.env.EMAIL_VERIFICATION_URL);
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

function createSmtpTransport() {
  if (!process.env.SMTP_HOST) {
    throw new Error('SMTP_HOST is required for SMTP email delivery');
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = boolEnv('SMTP_SECURE', port === 465);
  const auth = process.env.SMTP_USER || process.env.SMTP_PASS
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined;

  if (auth && (!auth.user || !auth.pass)) {
    throw new Error('Both SMTP_USER and SMTP_PASS are required when SMTP auth is configured');
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth,
    requireTLS: boolEnv('SMTP_REQUIRE_TLS', !secure),
    tls: {
      rejectUnauthorized: boolEnv('SMTP_TLS_REJECT_UNAUTHORIZED', true),
    },
  });
}

function fromAddress() {
  return process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER;
}

function tokenEmailContent({ kind, actionUrl, fallbackUrl, expiresAt }) {
  const isVerification = kind === 'email-verification';
  const title = isVerification ? 'Verify your FinanceApp email' : 'Reset your FinanceApp password';
  const action = isVerification ? 'Verify email' : 'Reset password';
  const purpose = isVerification
    ? 'Use the secure link below to verify your FinanceApp email address.'
    : 'Use the secure link below to reset your FinanceApp password.';
  const escapedUrl = escapeHtml(actionUrl);
  const escapedExpiry = escapeHtml(expiresAt);

  return {
    subject: title,
    text: `${purpose}\n\nOpen in app: ${actionUrl}\nBrowser fallback: ${fallbackUrl}\n\nThis link expires at ${expiresAt}. If you did not request this, you can ignore this email.`,
    html: `
      <p>${escapeHtml(purpose)}</p>
      <p><a href="${escapedUrl}" rel="noopener noreferrer">${escapeHtml(action)}</a></p>
      <p>If the app is not installed, use this browser fallback:</p>
      <p><a href="${escapeHtml(fallbackUrl)}" rel="noopener noreferrer">${escapeHtml(fallbackUrl)}</a></p>
      <p>If the button does not work, copy and paste this link:</p>
      <p>${escapedUrl}</p>
      <p>This link expires at ${escapedExpiry}. If you did not request this, you can ignore this email.</p>
    `,
  };
}

function temporaryPasswordEmailContent({ temporaryPassword }) {
  const escapedPassword = escapeHtml(temporaryPassword);
  return {
    subject: 'Your temporary FinanceApp password',
    text: `An administrator reset your FinanceApp password.\n\nTemporary password: ${temporaryPassword}\n\nUse this password to sign in. You will be required to choose a new password immediately after login. If you did not expect this reset, contact support.`,
    html: `
      <p>An administrator reset your FinanceApp password.</p>
      <p>Temporary password:</p>
      <p><strong>${escapedPassword}</strong></p>
      <p>Use this password to sign in. You will be required to choose a new password immediately after login.</p>
      <p>If you did not expect this reset, contact support.</p>
    `,
  };
}

function authDeliveryWebhookSecret(envName, label) {
  const secret = process.env[envName] || process.env.AUTH_DELIVERY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(`${label} webhook secret is required`);
  }
  return secret;
}

function webhookSignatureFor(body, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function deliverViaWebhook({ webhookUrl, webhookSecret, email, token, actionUrl, fallbackUrl, expiresAt, tokenFieldName, urlFieldName, label }) {
  const safeWebhookUrl = assertSecureDeliveryUrl(webhookUrl, label);
  const body = JSON.stringify({ email, [tokenFieldName]: token, [urlFieldName]: actionUrl, fallbackUrl, expiresAt });
  const response = await fetch(safeWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': webhookSignatureFor(body, webhookSecret),
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`${label} webhook failed with status ${response.status}`);
  }

  return { channel: 'webhook', webhookUrl: safeWebhookUrl };
}

async function deliverViaSmtp({ email, kind, actionUrl, fallbackUrl, expiresAt }) {
  const from = fromAddress();
  if (!from) {
    throw new Error('EMAIL_FROM or SMTP_USER is required for SMTP email delivery');
  }

  const transporter = createSmtpTransport();
  const content = tokenEmailContent({ kind, actionUrl, fallbackUrl, expiresAt });
  await transporter.sendMail({
    from,
    to: email,
    subject: content.subject,
    text: content.text,
    html: content.html,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

async function deliverTemporaryPasswordViaSmtp({ email, temporaryPassword }) {
  const from = fromAddress();
  if (!from) {
    throw new Error('EMAIL_FROM or SMTP_USER is required for SMTP email delivery');
  }

  const transporter = createSmtpTransport();
  const content = temporaryPasswordEmailContent({ temporaryPassword });
  await transporter.sendMail({
    from,
    to: email,
    subject: content.subject,
    text: content.text,
    html: content.html,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

function allowLocalTokenFallback(envName) {
  if (process.env.NODE_ENV === 'test') return true;
  return process.env.NODE_ENV === 'development' && process.env[envName] === 'true';
}

async function deliverPasswordResetToken({ email, token, expiresAt }) {
  const resetUrl = resetUrlFor(token);
  const fallbackUrl = browserFallbackUrlFor(token, 'reset-password');

  if (process.env.PASSWORD_RESET_WEBHOOK_URL) {
    const delivery = await deliverViaWebhook({
      webhookUrl: process.env.PASSWORD_RESET_WEBHOOK_URL,
      webhookSecret: authDeliveryWebhookSecret('PASSWORD_RESET_WEBHOOK_SECRET', 'Password reset'),
      email,
      token,
      actionUrl: resetUrl,
      fallbackUrl,
      expiresAt,
      tokenFieldName: 'token',
      urlFieldName: 'resetUrl',
      label: 'Password reset',
    });
    logger.info('Password reset token delivered via webhook', { email: maskEmail(email), expiresAt });
    return delivery;
  }

  if (smtpConfigured()) {
    await deliverViaSmtp({ email, kind: 'password-reset', actionUrl: resetUrl, fallbackUrl, expiresAt });
    logger.info('Password reset token delivered via SMTP', { email: maskEmail(email), expiresAt });
    return { channel: 'smtp' };
  }

  if (!allowLocalTokenFallback('ALLOW_RESET_TOKEN_IN_RESPONSE')) {
    throw new Error('No password reset email provider is configured');
  }

  logger.warn('Password reset token generated without configured email provider', {
    email: maskEmail(email),
    token_hash: token ? hashToken(token) : null,
    reset_path: resetUrl ? '/reset-password/[token]' : null,
    expiresAt,
    delivery: 'admin-log',
  });
  return { channel: 'local-log' };
}

async function deliverEmailVerificationToken({ email, token, expiresAt }) {
  const verificationUrl = verificationUrlFor(token);
  const fallbackUrl = browserFallbackUrlFor(token, 'verify-email');

  if (process.env.NODE_ENV === 'test' && process.env.ALLOW_VERIFICATION_TOKEN_IN_RESPONSE === 'true') {
    logger.warn('Email verification token generated without delivery in test mode', {
      email: maskEmail(email),
      token_hash: token ? hashToken(token) : null,
      verification_path: verificationUrl ? '/verify-email/[token]' : null,
      expiresAt,
      delivery: 'test-response',
    });
    return;
  }

  if (process.env.EMAIL_VERIFICATION_WEBHOOK_URL) {
    const delivery = await deliverViaWebhook({
      webhookUrl: process.env.EMAIL_VERIFICATION_WEBHOOK_URL,
      webhookSecret: authDeliveryWebhookSecret('EMAIL_VERIFICATION_WEBHOOK_SECRET', 'Email verification'),
      email,
      token,
      actionUrl: verificationUrl,
      fallbackUrl,
      expiresAt,
      tokenFieldName: 'token',
      urlFieldName: 'verificationUrl',
      label: 'Email verification',
    });
    logger.info('Email verification token delivered via webhook', { email: maskEmail(email), expiresAt });
    return delivery;
  }

  if (smtpConfigured()) {
    await deliverViaSmtp({ email, kind: 'email-verification', actionUrl: verificationUrl, fallbackUrl, expiresAt });
    logger.info('Email verification token delivered via SMTP', { email: maskEmail(email), expiresAt });
    return { channel: 'smtp' };
  }

  if (!allowLocalTokenFallback('ALLOW_VERIFICATION_TOKEN_IN_RESPONSE')) {
    throw new Error('No email verification provider is configured');
  }

  logger.warn('Email verification token generated without configured email provider', {
    email: maskEmail(email),
    token_hash: token ? hashToken(token) : null,
    verification_path: verificationUrl ? '/verify-email/[token]' : null,
    expiresAt,
    delivery: 'admin-log',
  });
  return { channel: 'local-log' };
}

async function deliverAdminTemporaryPassword({ email, temporaryPassword }) {
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    logger.warn('Admin temporary password delivery skipped in test mode', {
      email: maskEmail(email),
      delivery: 'test-manual-handoff',
    });
    return { channel: 'manual', sent: false, reason: 'test_mode' };
  }

  if (smtpConfigured()) {
    await deliverTemporaryPasswordViaSmtp({ email, temporaryPassword });
    logger.info('Admin temporary password delivered via SMTP', { email: maskEmail(email) });
    return { channel: 'email', sent: true };
  }

  logger.warn('Admin temporary password requires manual delivery because SMTP is not configured', {
    email: maskEmail(email),
    delivery: 'manual-handoff',
  });
  return { channel: 'manual', sent: false, reason: 'smtp_not_configured' };
}

module.exports = {
  maskEmail,
  assertSecureDeliveryUrl,
  webhookSignatureFor,
  resetUrlFor,
  verificationUrlFor,
  deliverPasswordResetToken,
  deliverEmailVerificationToken,
  deliverAdminTemporaryPassword,
};
