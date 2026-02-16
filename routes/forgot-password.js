// routes/forgot-password.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY // 🔹 USE ANON KEY HERE
);

router.post('/', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        // Send password recovery email
        const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${process.env.FRONTEND_URL}/auth/reset-password`
        });

        if (error) throw error;

        return res.json({ success: true, message: 'Password reset email sent!' });
    } catch (err) {
        console.error('Forgot password error:', err);
        return res.status(400).json({ error: err.message });
    }
});

module.exports = router;
