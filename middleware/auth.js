const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function authMiddleware(req, res, next) {
  try {
    console.log('========== AUTH DEBUG START ==========');
    console.log('Request URL:', req.originalUrl);
    console.log('Request Method:', req.method);

    const authHeader = req.headers.authorization;
    console.log('Authorization Header:', authHeader);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ No Bearer token found');
      console.log('========== AUTH DEBUG END ==========');
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    console.log('Token length:', token?.length);
    console.log('Token preview:', token?.substring(0, 30) + '...');

    // Check environment config
    console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
    console.log(
      'SERVICE_KEY exists:',
      !!process.env.SUPABASE_SERVICE_KEY
    );

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    console.log('Supabase getUser data:', data);
    console.log('Supabase getUser error:', error);

    if (error || !data?.user) {
      console.log('❌ Supabase rejected token');
      console.log('========== AUTH DEBUG END ==========');
      return res.status(401).json({ error: 'Invalid token' });
    }

    console.log('✅ Authenticated user ID:', data.user.id);

    req.user = data.user;

    console.log('========== AUTH DEBUG END ==========');

    next();
  } catch (err) {
    console.error('🔥 Auth middleware crash:', err);
    console.log('========== AUTH DEBUG END ==========');
    res.status(401).json({ error: 'Authentication failed' });
  }
}

module.exports = authMiddleware;
