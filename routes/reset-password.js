// routes/reset-password.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY // 🔹 Use anon key
);

router.post('/', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }

  try {
    // Update password using recovery token
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
      access_token: token, // token from reset email
    });

    if (error) {
      console.error('Reset password error:', error);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully',
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  } catch (err) {
    console.error('Unexpected reset-password error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
