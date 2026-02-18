// server.js - WITH SPECIFIC RATE LIMITING PER ROUTE
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { initIO } = require('./socket/io');

// Import rate limiters
const {
  globalLimiter,
  authLimiter,
  uploadLimiter,
  chatLimiter
} = require('./middleware/rateLimiter');

// Import routes
const uploadRoutes = require('./routes/upload');
const documentRoutes = require('./routes/documents');
const chatRoutes = require('./routes/chat');
const graphRoutes = require('./routes/graph');
const authRoutes = require('./routes/auth');
const authMiddleware = require('./middleware/auth');
const resetPasswordRoute = require('./routes/reset-password')
const forgotPasswordRoute = require('./routes/forgot-password');

const app = express();

const httpserver = createServer(app);

//  Allow both local and production frontend URLs
const allowedOrigins = [
  'http://localhost:3000',
  'https://memory-graph-frontend-r18d.vercel.app'
];

const io = new Server(httpserver, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
})

initIO(io);

//  GLOBAL RATE LIMIT (for all routes) 
app.use(globalLimiter);

// Add this at the TOP of your routes (before CORS even)
app.use('/api/debug', (req, res, next) => {
  console.log('🐛 DEBUG Route hit!');
  console.log('Headers:', req.headers);
  console.log('Auth:', req.headers.authorization);
  res.json({
    received: true,
    headers: req.headers,
    auth: req.headers.authorization
  });
});

//CORS middleware with multiple origins
app.use(cors({
  origin: [
    "https://memory-graph-frontend-r18d.vercel.app",
    "http://localhost:3000"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Client-Data"]
}));
app.options("*", cors());
// Also handle preflight requests
//app.options('*', cors()); // Allow all preflight requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


io.on('connection', (socket) => {
  console.log('🔌 WebSocket client connected:', socket.id);

  // User joins their personal room
  socket.on('join-user-room', (userId) => {
    socket.join(`user-${userId}`);
    console.log(`User ${userId} joined WebSocket room`);
  });

  // Document-specific room (for real-time progress)
  socket.on('join-document-room', (documentId) => {
    socket.join(`document-${documentId}`);
    console.log(`Joined document room: ${documentId}`);
  });

  socket.on('disconnect', () => {
    console.log('WebSocket client disconnected:', socket.id);
  });
});

// Make io available to other modules
app.set('io', io);
// SPECIFIC RATE LIMITS PER ROUTE 

// attempts/15min (prevents brute force)
app.use('/api/auth', authLimiter, authRoutes);

//  20 files/hour (prevents storage abuse)  
app.use('/api/upload', authMiddleware, uploadLimiter, uploadRoutes);

// Chat routes: 100 queries/hour (prevents AI cost abuse)
app.use('/api/chat', authMiddleware, chatLimiter, chatRoutes);

// Document routes: Use global limit only
app.use('/api/documents', authMiddleware, documentRoutes);

// Graph routes: Use global limit only  
app.use('/api/graph', authMiddleware, graphRoutes);
app.use('/api/user', authMiddleware, require('./routes/user'));
app.use('/api/auth/reset-password', resetPasswordRoute);


app.use('/api/auth/forgot-password', forgotPasswordRoute);


app.get('/', (req, res) => {
  res.json({
    message: 'MemoryGraph AI Backend is running!',
    status: 'active',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'MemoryGraph AI Backend',
    version: '1.0.0'
  });
});


app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({
    error: 'Something went wrong!',
    message: err.message
  });
});

// ========== 5. START SERVER ==========
const PORT = process.env.PORT || 5000;
httpserver.listen(PORT, () => {  // ← CHANGED FROM app.listen TO httpserver.listen
  console.log(`
  🚀 MemoryGraph AI Backend Started!
  📍 Port: ${PORT}
  🌐 Environment: ${process.env.NODE_ENV}
  🔌 WebSocket: Ready on ws://localhost:${PORT}  // ← ADD THIS LINE
  
  ⚡ Rate Limits Configured:
  - All routes: 1000 requests/15min
  - /api/auth: 10 attempts/15min  
  - /api/upload: 20 files/hour
  - /api/chat: 100 queries/hour
  
  Endpoints:
  - GET  /          → Welcome
  - GET  /health    → Health check
  - POST /api/upload → File upload
  - GET  /api/documents → Document list
  - POST /api/chat → AI chat
  
  ✅ Server is ready!
  `);
});