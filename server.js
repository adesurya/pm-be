// server.js
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const session = require('express-session');
require('dotenv').config();

// Import configurations
const { masterDB } = require('./config/database');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS configuration
app.use(cors({
  origin: true, // Allow all origins for development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-CSRF-Token',
    'CSRF-Token',
    'X-API-Key'
  ]
}));

// Basic session (without Redis for now)
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-here',
  resave: false,
  saveUninitialized: false,
  name: 'newsapp.sid',
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Health check endpoint (before other middleware)
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'News CMS SaaS is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.json({
    success: true,
    message: 'News CMS SaaS API Documentation',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      docs: 'GET /api/docs',
      tenant_management: 'POST /api/tenant-management'
    }
  });
});

// Basic API routes (without tenant middleware for now)
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'News CMS SaaS API',
    version: '1.0.0',
    status: 'running'
  });
});

// Test tenant management endpoint
app.get('/api/tenant-management/health', async (req, res) => {
  try {
    // Test database connection
    await masterDB.authenticate();
    
    res.json({
      success: true,
      message: 'Tenant management service is healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({
      success: false,
      message: 'Service unavailable',
      error: error.message
    });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;
  
  res.status(err.status || 500).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.originalUrl
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  
  try {
    await masterDB.close();
    console.log('Database connections closed');
  } catch (error) {
    console.error('Error closing database:', error);
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  
  try {
    await masterDB.close();
    console.log('Database connections closed');
  } catch (error) {
    console.error('Error closing database:', error);
  }
  
  process.exit(0);
});

// Unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Initialize database and start server
const startServer = async () => {
  try {
    console.log('🚀 Starting News CMS SaaS server...');
    
    // Test master database connection
    await masterDB.authenticate();
    console.log('✅ Master database connected successfully');
    
    // Sync master database models (create tables if not exist)
    const Tenant = require('./models/Tenant');
    await masterDB.sync();
    console.log('✅ Master database models synchronized');
    
    // Start HTTP server
    const server = app.listen(PORT, () => {
      console.log(`🚀 News CMS SaaS server running on port ${PORT}`);
      console.log(`📖 API Documentation: http://localhost:${PORT}/api/docs`);
      console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('');
      console.log('Available endpoints:');
      console.log(`  GET  http://localhost:${PORT}/health`);
      console.log(`  GET  http://localhost:${PORT}/api`);
      console.log(`  GET  http://localhost:${PORT}/api/docs`);
      console.log(`  GET  http://localhost:${PORT}/api/tenant-management/health`);
    });
    
    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        process.exit(1);
      } else {
        console.error('❌ Server error:', error);
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    
    // Provide helpful error messages
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('💡 Database access denied. Please check your database credentials in .env file');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('💡 Database connection refused. Please make sure MySQL is running');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('💡 Database does not exist. Please create the database or run: npm run db:quickfix');
    }
    
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app;