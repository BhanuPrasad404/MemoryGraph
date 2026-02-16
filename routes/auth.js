// routes/auth.js - AUTH API ENDPOINTS
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const {
    validateSignup,
    validateLogin,
    validatePasswordReset,
    validatePasswordResetConfirm,
    validateEmailVerification
} = require('../middleware/validateAuth');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

//import { createClient } from '@supabase/supabase-js';

//const router = Router();
// 1. SIGNUP
router.post('/signup', validateSignup, async (req, res) => {
    try {
        const { email, password } = req.authData;

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: `${process.env.FRONTEND_URL}/auth/verify`
            }
        });

        if (error) {
            console.error('Signup error:', error);

            //Handle specific errors
            if (error.message.includes('already registered')) {
                return res.status(409).json({
                    success: false,
                    error: 'Email already registered',
                    code: 'EMAIL_EXISTS'
                });
            }

            return res.status(400).json({
                success: false,
                error: error.message,
                code: 'SIGNUP_FAILED'
            });
        }

        res.json({
            success: true,
            message: 'Account created! Check your email to verify.',
            data: {
                user_id: data.user?.id,
                email: data.user?.email,
                requires_verification: !data.user?.email_confirmed_at
            }
        });

    } catch (error) {
        console.error('Signup exception:', error);
        res.status(500).json({
            success: false,
            error: 'Signup failed',
            code: 'SERVER_ERROR'
        });
    }
});


//LOGIN
router.post('/login', validateLogin, async (req, res) => {
    try {
        const { email, password } = req.authData;

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            console.error('Login error:', error);

            if (error.message.includes('Invalid login credentials')) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid email or password',
                    code: 'INVALID_CREDENTIALS'
                });
            }

            if (error.message.includes('Email not confirmed')) {
                return res.status(403).json({
                    success: false,
                    error: 'Please verify your email first',
                    code: 'EMAIL_NOT_VERIFIED'
                });
            }

            return res.status(400).json({
                success: false,
                error: error.message,
                code: 'LOGIN_FAILED'
            });
        }

        // Success - return token and user info
        res.json({
            success: true,
            data: {
                token: data.session.access_token,
                user: {
                    id: data.user.id,
                    email: data.user.email,
                    email_confirmed: !!data.user.email_confirmed_at,
                    created_at: data.user.created_at
                }
            }
        });

    } catch (error) {
        console.error('Login exception:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed',
            code: 'SERVER_ERROR'
        });
    }
});

// LOGOUT
router.post('/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (token) {
            await supabase.auth.signOut(token);
        }

        res.json({
            success: true,
            message: 'Logged out successfully'
        });

    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            error: 'Logout failed'
        });
    }
});

//  GET CURRENT USER
router.get('/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'No token provided',
                code: 'NO_TOKEN'
            });
        }

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                code: 'INVALID_TOKEN'
            });
        }

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    email_confirmed: !!user.email_confirmed_at,
                    created_at: user.created_at,
                    last_sign_in: user.last_sign_in_at
                }
            }
        });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user',
            code: 'SERVER_ERROR'
        });
    }
});
router.post('/', async (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
        return res.status(400).json({ error: 'Token and password are required' });
    }

    try {
        // Redeem the recovery token using Supabase Admin API
        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(token, {
            password,
        });

        if (error) throw error;

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('Reset password error:', err);
        return res.status(400).json({ error: err.message });
    }
});

// VERIFY EMAIL
router.post('/verify-email', validateEmailVerification, async (req, res) => {
    try {
        const { token } = req.authData;

        // Supabase handles email verification automatically via redirect
        // This endpoint is for manual verification if needed

        const { data, error } = await supabase.auth.verifyOtp({
            token_hash: token,
            type: 'email'
        });

        if (error) {
            return res.status(400).json({
                success: false,
                error: 'Invalid or expired verification token',
                code: 'INVALID_VERIFICATION_TOKEN'
            });
        }

        res.json({
            success: true,
            message: 'Email verified successfully',
            data: {
                user_id: data.user?.id,
                email: data.user?.email
            }
        });

    } catch (error) {
        console.error('Verify email error:', error);
        res.status(500).json({
            success: false,
            error: 'Email verification failed'
        });
    }
});
module.exports = router;