// middleware/validateAuth.js - VALIDATES AUTH REQUESTS
const validator = require('validator');

/**
 * Validates signup request
 */
function validateSignup(req, res, next) {
    const { email, password } = req.body;

    // Check required fields
    if (!email || !password) {
        return res.status(400).json({
            success: false,
            error: 'Email and password are required',
            code: 'MISSING_FIELDS'
        });
    }

    // Validate email format
    if (!validator.isEmail(email)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid email format',
            code: 'INVALID_EMAIL'
        });
    }

    // Validate password strength
    if (password.length < 8) {
        return res.status(400).json({
            success: false,
            error: 'Password must be at least 8 characters',
            code: 'WEAK_PASSWORD'
        });
    }

    // Check for common passwords (optional)
    const weakPasswords = ['password', '12345678', 'qwerty', 'letmein'];
    if (weakPasswords.includes(password.toLowerCase())) {
        return res.status(400).json({
            success: false,
            error: 'Password is too common',
            code: 'COMMON_PASSWORD'
        });
    }

    // Additional checks
    req.authData = {
        email: email.trim().toLowerCase(),
        password: password
    };

    next();
}

/**
 * Validates login request
 */
function validateLogin(req, res, next) {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            success: false,
            error: 'Email and password are required',
            code: 'MISSING_FIELDS'
        });
    }

    if (!validator.isEmail(email)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid email format',
            code: 'INVALID_EMAIL'
        });
    }

    req.authData = {
        email: email.trim().toLowerCase(),
        password: password
    };

    next();
}

/**
 * Validates password reset request
 */
function validatePasswordReset(req, res, next) {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({
            success: false,
            error: 'Email is required',
            code: 'MISSING_EMAIL'
        });
    }

    if (!validator.isEmail(email)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid email format',
            code: 'INVALID_EMAIL'
        });
    }

    req.authData = { email: email.trim().toLowerCase() };
    next();
}

function validatePasswordResetConfirm(req, res, next) {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
        return res.status(400).json({
            success: false,
            error: 'Reset token and new password are required',
            code: 'MISSING_FIELDS'
        });
    }

    // Basic token validation (JWT has 3 parts)
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
        return res.status(400).json({
            success: false,
            error: 'Invalid token format',
            code: 'INVALID_TOKEN_FORMAT'
        });
    }

    // Password strength
    if (newPassword.length < 8) {
        return res.status(400).json({
            success: false,
            error: 'Password must be at least 8 characters',
            code: 'WEAK_PASSWORD'
        });
    }

    req.authData = { token, newPassword };
    next();
}

/**
 * Validates email verification request
 */
function validateEmailVerification(req, res, next) {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({
            success: false,
            error: 'Verification token is required',
            code: 'MISSING_TOKEN'
        });
    }

    // Basic token validation (JWT format)
    if (token.split('.').length !== 3) {
        return res.status(400).json({
            success: false,
            error: 'Invalid token format',
            code: 'INVALID_TOKEN_FORMAT'
        });
    }

    req.authData = { token };
    next();
}

module.exports = {
    validateSignup,
    validateLogin,
    validatePasswordReset,
    validatePasswordResetConfirm,
    validateEmailVerification
};