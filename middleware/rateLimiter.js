// middleware/rateLimiter.js - PRODUCTION SAFE (FIXED)
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

/**
 * GLOBAL RATE LIMIT
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  skip: (req) => req.path === '/' || req.path === '/health',
});

/**
 * AUTH RATE LIMIT
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many login attempts from this IP, please try again later.',
    code: 'AUTH_RATE_LIMIT_EXCEEDED',
  },
  skip: (req) => !req.path.startsWith('/api/auth'),
});

/**
 * UPLOAD RATE LIMIT (FIXED)
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => {
    // User-based if authenticated, otherwise safe IP generator
    return req.user?.id ?? ipKeyGenerator(req);
  },
  message: {
    success: false,
    error: 'Too many uploads, please try again later.',
    code: 'UPLOAD_LIMIT_EXCEEDED',
  },
  skip: (req) => !req.path.startsWith('/api/upload'),
});

/**
 * CHAT RATE LIMIT (FIXED)
 */
const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => {
    return req.user?.id ?? ipKeyGenerator(req);
  },
  message: {
    success: false,
    error: 'Too many queries, please try again later.',
    code: 'QUERY_LIMIT_EXCEEDED',
  },
  skip: (req) =>
    !req.path.startsWith('/api/chat') &&
    !req.path.startsWith('/api/query'),
});

module.exports = {
  globalLimiter,
  authLimiter,
  uploadLimiter,
  chatLimiter,
};
