const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');

const app = express();

// Security Headers
app.use(helmet({ 
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false // Allows loading assets in development
}));

// Environment-Driven CORS with Production Cloud & Local Network Support
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',').map(s => s.trim().replace(/\/$/, '')) : [])
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow non-browser requests (e.g. mobile apps, curl, webhooks, server-to-server)
    if (!origin) {
      return callback(null, true);
    }
    const cleanOrigin = origin.replace(/\/$/, '');
    const isExplicitlyAllowed = allowedOrigins.includes(cleanOrigin);
    const isVercel = cleanOrigin.endsWith('.vercel.app');
    const isRender = cleanOrigin.endsWith('.onrender.com');
    const isNetlify = cleanOrigin.endsWith('.netlify.app');
    const isRailway = cleanOrigin.endsWith('.railway.app');
    const isLocalNetwork = /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(cleanOrigin);

    if (isExplicitlyAllowed || isVercel || isRender || isNetlify || isRailway || isLocalNetwork || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    console.warn(`[CORS] Rejected request from unauthorized origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Requested-With']
}));

// Request Parsers (Captures raw byte buffer for cryptographic webhook HMAC verification)
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Static Uploads Directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Tiered Rate Limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 30, // 30 attempts per 15 min
  message: { status: 'error', error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many authentication attempts. Please try again after 15 minutes.' } },
  standardHeaders: true,
  legacyHeaders: false
});

const otpResendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 10, // 10 resend requests per 15 min
  message: { status: 'error', error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many OTP resend attempts. Please try again later.' } },
  standardHeaders: true,
  legacyHeaders: false
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 25, // 25 verify attempts per 15 min
  message: { status: 'error', error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many verification attempts. Please wait.' } },
  standardHeaders: true,
  legacyHeaders: false
});

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60, // 60 checkout actions per 15 min
  message: { status: 'error', error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many checkout requests. Please wait.' } },
  standardHeaders: true,
  legacyHeaders: false
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { status: 'error', error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later.' } },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1/auth/resend-otp', otpResendLimiter);
app.use('/api/v1/auth/verify-otp', otpVerifyLimiter);
app.use('/api/v1/orders/checkout', checkoutLimiter);
app.use('/api/', generalLimiter);

// Primary API Router Mount
app.use('/api/v1', routes);

// Production Static Frontend Serving (Enables single-URL full-stack deployment)
const fs = require('fs');
const frontendDist = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Root & Health Probes (Supports Render/Railway health checks & browser verification)
app.get(['/', '/health', '/api/v1/health'], (req, res) => {
  res.status(200).json({ 
    status: 'UP', 
    service: 'MarketSphere Marketplace Backend API',
    database: mongoose.connection.readyState === 1 ? 'CONNECTED' : 'DISCONNECTED',
    version: '1.0.0',
    timestamp: new Date() 
  });
});

app.get('/api/v1/ready', (req, res) => {
  const isDbReady = mongoose.connection.readyState === 1;
  if (isDbReady) {
    return res.status(200).json({ 
      status: 'READY', 
      database: 'CONNECTED', 
      timestamp: new Date() 
    });
  }
  return res.status(503).json({ 
    status: 'NOT_READY', 
    database: 'DISCONNECTED', 
    timestamp: new Date() 
  });
});

// Error Handling Pipeline
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;