const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const compression = require('compression');
const morgan = require('morgan');
const dotenv = require('dotenv');
const logger = require('./utils/logger');
const { db } = require('../database/db');
const authRoutes = require('./routes/authRoutes');
const accountRoutes = require('./routes/accountRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const budgetRoutes = require('./routes/budgetRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { securityMonitor } = require('./middleware/securityMonitor');
const { csrfProtection } = require('./middleware/csrfProtection');
const { getLastBackupTimestamp } = require('./utils/backup');

const backendRoot = path.join(__dirname, '..');
const envPath = path.join(backendRoot, '.env');
const projectEnvPath = path.join(backendRoot, '..', '.env');

dotenv.config({ path: fs.existsSync(envPath) ? envPath : projectEnvPath });

const app = express();
const logDir = path.join(backendRoot, 'logs');
fs.mkdirSync(logDir, { recursive: true });
app.set('etag', false);

const allowedOrigins = (process.env.MOBILE_APP_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin || allowedOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV === 'test') {
    try {
      const url = new URL(origin);
      return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    } catch {
      return false;
    }
  }
  return false;
}

const requestLoggerStream = {
  write: (message) => logger.info(message.trim(), { source: 'http' }),
};

morgan.token('id', (req) => req.id || '-');

const globalLimiter = rateLimit({
  skip: () => process.env.NODE_ENV === 'test',
  windowMs: Number(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
  limit: Number(process.env.GLOBAL_RATE_LIMIT_MAX) || 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  handler: (req, res, next, options) => {
    logger.warn('Global rate limit exceeded', {
      requestId: req.id,
      ip: req.ip,
      method: req.method,
      path: req.originalUrl,
      windowMs: options.windowMs,
      limit: options.limit,
    });
    res.status(options.statusCode).json(options.message);
  },
});

const clientErrorLimiter = rateLimit({
  skip: () => process.env.NODE_ENV === 'test',
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many client error reports, please try again later.' },
});

function trustProxyHops() {
  const configured = process.env.TRUST_PROXY_HOPS;
  if (process.env.NODE_ENV === 'production' && configured === undefined) {
    throw new Error('TRUST_PROXY_HOPS must be set explicitly in production');
  }
  const hops = configured === undefined ? 1 : Number(configured);
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
  }
  return hops;
}

app.disable('x-powered-by');
app.set('trust proxy', trustProxyHops());

app.use((req, res, next) => {
  req.id = req.get('x-request-id') || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

let warnedAboutHttpInProduction = false;
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
    const httpsDetected = req.secure || forwardedProto === 'https' || process.env.REQUIRE_HTTPS === 'true';
    if (!httpsDetected && !warnedAboutHttpInProduction) {
      warnedAboutHttpInProduction = true;
      logger.warn('Production HTTPS warning', {
        warning: 'Production request did not indicate HTTPS. Run FinanceApp behind a TLS-terminating reverse proxy and forward X-Forwarded-Proto.',
        method: req.method,
        path: req.originalUrl,
        forwardedProto,
      });
    }
  }
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'no-referrer' },
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
}));
app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token'],
  exposedHeaders: ['X-Request-ID', 'X-CSRF-Token'],
}));
app.use(hpp());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(securityMonitor);
app.use(mongoSanitize({ replaceWith: '_' }));
app.use(csrfProtection);
app.use(compression());
app.use(morgan(':id :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"', { stream: requestLoggerStream }));
app.use(globalLimiter);
app.post('/api/client-error', clientErrorLimiter, (req, res) => {
  const body = req.body || {};
  logger.error('Client-side error reported', {
    requestId: req.id,
    ip: req.ip,
    message: String(body.message || 'Client error').slice(0, 500),
    stack: body.stack ? String(body.stack).slice(0, 4000) : undefined,
    screen: body.screen ? String(body.screen).slice(0, 120) : undefined,
    appVersion: body.appVersion ? String(body.appVersion).slice(0, 80) : undefined,
    platform: body.platform ? String(body.platform).slice(0, 80) : undefined,
    type: body.type ? String(body.type).slice(0, 40) : 'client',
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
  });
  res.status(202).json({ success: true });
});
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/admin', adminRoutes);

if (process.env.NODE_ENV !== 'production') {
  try {
    const swaggerJsdoc = require('swagger-jsdoc');
    const swaggerUi = require('swagger-ui-express');
    const spec = swaggerJsdoc({
      definition: {
        openapi: '3.0.0',
        info: { title: 'FinanceApp API', version: process.env.npm_package_version || '1.0.0' },
        components: {
          securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        },
      },
      apis: [path.join(__dirname, 'routes', '*.js')],
    });
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec));
  } catch (error) {
    logger.warn('Swagger UI unavailable; install swagger-jsdoc and swagger-ui-express to enable /api/docs', { error: error.message });
  }
}

app.get('/health', (req, res) => {
  let dbStatus = 'ok';
  try {
    db.prepare('SELECT 1 AS ok').get();
  } catch (error) {
    dbStatus = 'error';
    logger.error('Health check database probe failed', { error: error.message, requestId: req.id });
  }

  res.status(dbStatus === 'ok' ? 200 : 503).json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    service: 'financeapp-backend',
    uptime: process.uptime(),
    db: dbStatus,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    min_app_version: process.env.MIN_APP_VERSION || '1.0.0',
    last_backup_at: getLastBackupTimestamp(),
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;

  logger.error(err.message || 'Unhandled application error', {
    statusCode,
    method: req.method,
    path: req.originalUrl,
    requestId: req.id,
    ip: req.ip,
    stack: err.stack,
  });

  res.status(statusCode).json({
    error: statusCode === 500 ? 'Internal server error' : err.message,
  });
});

module.exports = app;




