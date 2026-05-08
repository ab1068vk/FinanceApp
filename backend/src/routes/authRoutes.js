const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const changePasswordAttempts = new Map();

const loginLimiter = rateLimit({
  skip: () => process.env.NODE_ENV === 'test',
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

const registerLimiter = rateLimit({
  skip: () => process.env.NODE_ENV === 'test',
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many registration attempts, please try again later.' },
});

const refreshLimiter = rateLimit({
  skip: () => process.env.NODE_ENV === 'test',
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts, please try again later.' },
});

const passwordResetLimiter = rateLimit({
  skip: () => process.env.NODE_ENV === 'test',
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts, please try again later.' },
});

const emailVerificationLimiter = rateLimit({
  skip: () => process.env.NODE_ENV === 'test',
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many email verification attempts, please try again later.' },
});

const defaultBlockedEmailDomains = new Set([
  '10minutemail.com',
  'guerrillamail.com',
  'mailinator.com',
  'tempmail.com',
  'throwawaymail.com',
  'yopmail.com',
]);

function blockedEmailDomains() {
  const configured = String(process.env.BLOCKED_EMAIL_DOMAINS || '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...defaultBlockedEmailDomains, ...configured]);
}

function assertUsableEmail(value) {
  const domain = String(value).split('@').pop()?.toLowerCase() || '';
  if (!domain.includes('.') || domain.endsWith('.local') || domain === 'localhost') {
    throw new Error('email must use a real email domain');
  }
  if (blockedEmailDomains().has(domain)) {
    throw new Error('temporary email addresses are not allowed');
  }
  return true;
}

function changePasswordLimiter(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();
  const key = req.user?.id || req.ip;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const current = changePasswordAttempts.get(key) || { count: 0, resetAt: now + windowMs };
  const nextState = current.resetAt <= now ? { count: 1, resetAt: now + windowMs } : { ...current, count: current.count + 1 };
  changePasswordAttempts.set(key, nextState);
  if (nextState.count > 5) {
    return res.status(429).json({ error: 'Too many password change attempts, please try again later.' });
  }
  return next();
}

const passwordRules = (fieldName) => body(fieldName)
  .isString()
  .withMessage(`${fieldName} must be a string`)
  .bail()
  .isLength({ min: 8 })
  .withMessage(`${fieldName} must be at least 8 characters long`)
  .bail()
  .matches(/[A-Z]/)
  .withMessage(`${fieldName} must contain at least one uppercase letter`)
  .bail()
  .matches(/[0-9]/)
  .withMessage(`${fieldName} must contain at least one number`)
  .bail()
  .matches(/[^A-Za-z0-9]/)
  .withMessage(`${fieldName} must contain at least one special character`);

const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (errors.isEmpty()) {
    return next();
  }

  return res.status(400).json({
    errors: errors.array().map((error) => ({
      field: error.path,
      message: error.msg,
    })),
  });
};

const emailRule = () => body('email')
  .isString()
  .withMessage('email must be a string')
  .bail()
  .trim()
  .isEmail()
  .withMessage('email must be a valid email address')
  .bail()
  .normalizeEmail()
  .custom(assertUsableEmail);

const fullNameRule = () => body('full_name')
  .isString()
  .withMessage('full_name must be a string')
  .bail()
  .trim()
  .isLength({ min: 2, max: 50 })
  .withMessage('full_name must be between 2 and 50 characters');

const refreshTokenRule = () => body('refreshToken')
  .isString()
  .withMessage('refreshToken must be a string')
  .bail()
  .trim()
  .notEmpty()
  .withMessage('refreshToken is required');

const resetTokenRule = () => body('resetToken')
  .isString()
  .withMessage('resetToken must be a string')
  .bail()
  .trim()
  .isLength({ min: 32, max: 256 })
  .withMessage('resetToken is invalid');

const registerValidation = [
  emailRule(),
  passwordRules('password'),
  fullNameRule(),
];

const loginValidation = [
  emailRule(),
  body('password')
    .isString()
    .withMessage('password must be a string')
    .bail()
    .notEmpty()
    .withMessage('password is required'),
];

const changePasswordValidation = [
  body('currentPassword')
    .isString()
    .withMessage('currentPassword must be a string')
    .bail()
    .notEmpty()
    .withMessage('currentPassword is required'),
  passwordRules('newPassword'),
];

const forgotPasswordValidation = [
  emailRule(),
];

const resetPasswordValidation = [
  resetTokenRule(),
  passwordRules('newPassword'),
];

const verificationTokenRule = () => body('verificationToken')
  .isString()
  .withMessage('verificationToken must be a string')
  .bail()
  .trim()
  .isLength({ min: 32, max: 256 })
  .withMessage('verificationToken is invalid');

router.post('/register', registerLimiter, registerValidation, validate, authController.register);
router.post('/login', loginLimiter, loginValidation, validate, authController.login);
router.post('/forgot-password', passwordResetLimiter, forgotPasswordValidation, validate, authController.forgotPassword);
router.post('/reset-password', passwordResetLimiter, resetPasswordValidation, validate, authController.resetPassword);
router.post('/verify-email', emailVerificationLimiter, [verificationTokenRule()], validate, authController.verifyEmail);
router.post('/resend-verification', emailVerificationLimiter, forgotPasswordValidation, validate, authController.resendVerification);
router.get('/csrf', authController.getCsrfToken);
router.post('/refresh', refreshLimiter, [refreshTokenRule()], validate, authController.refreshToken);
router.post('/logout', requireAuth, [refreshTokenRule()], validate, authController.logout);
router.put('/change-password', requireAuth, changePasswordLimiter, changePasswordValidation, validate, authController.changePassword);
router.get('/me', requireAuth, authController.getMe);
router.get('/sessions', requireAuth, authController.getSessions);
router.delete('/sessions/others', requireAuth, [refreshTokenRule()], validate, authController.revokeOtherSessions);
router.delete('/sessions/:sessionId', requireAuth, [param('sessionId').isUUID().withMessage('sessionId must be a valid UUID')], validate, authController.revokeSession);
router.post('/push-token', requireAuth, [
  body('token').isString().trim().isLength({ min: 10, max: 300 }).withMessage('token is required'),
  body('platform').isString().trim().isLength({ min: 2, max: 40 }).withMessage('platform is required'),
], validate, authController.registerPushToken);
router.delete('/push-token', requireAuth, [
  body('token').isString().trim().isLength({ min: 10, max: 300 }).withMessage('token is required'),
], validate, authController.deregisterPushToken);
router.get('/notification-settings', requireAuth, authController.getNotificationSettings);
router.put('/notification-settings', requireAuth, [
  body('preferences').isObject().withMessage('preferences must be an object'),
], validate, authController.updateNotificationSettings);
router.get('/notifications', requireAuth, [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100').toInt(),
], validate, authController.getNotifications);
router.patch('/notifications/:id/read', requireAuth, [
  param('id').isUUID().withMessage('id must be a valid UUID'),
], validate, authController.markNotificationRead);
router.get('/data', requireAuth, authController.exportMyData);
router.delete('/data', requireAuth, authController.deleteMyData);
router.delete('/account', requireAuth, [
  body('confirmation').equals('DELETE').withMessage('Type DELETE to confirm account deletion'),
], validate, authController.deleteMyAccount);
router.patch('/me', requireAuth, [
  body('full_name')
    .optional()
    .isString()
    .withMessage('full_name must be a string')
    .bail()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('full_name must be between 2 and 50 characters'),
  body('avatar_color')
    .optional()
    .matches(/^#[0-9A-Fa-f]{6}$/)
    .withMessage('avatar_color must be a valid hex color'),
  body('currency')
    .optional()
    .isString()
    .trim()
    .matches(/^[A-Za-z]{3}$/)
    .withMessage('currency must be a 3-letter code')
    .customSanitizer((value) => String(value).toUpperCase()),
  body('has_completed_onboarding')
    .optional()
    .isBoolean()
    .withMessage('has_completed_onboarding must be boolean')
    .toBoolean(),
], validate, authController.updateMe);

module.exports = router;
