// utils/logger.js
const winston = require('winston');
const path = require('path');

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Define colors for each log level
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

// Add colors to winston
winston.addColors(logColors);

// Create log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack, ...meta } = info;
    let log = `${timestamp} [${level}]: ${message}`;
    
    if (stack) {
      log += `\n${stack}`;
    }
    
    if (Object.keys(meta).length > 0) {
      log += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return log;
  })
);

// Create transports array
const transports = [];

// Console transport (always enabled in development)
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      level: 'debug',
      format: consoleFormat
    })
  );
} else {
  transports.push(
    new winston.transports.Console({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  );
}

// File transports
const logsDir = path.join(process.cwd(), 'logs');

// All logs
transports.push(
  new winston.transports.File({
    filename: path.join(logsDir, 'app.log'),
    level: 'info',
    format: logFormat,
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    tailable: true
  })
);

// Error logs
transports.push(
  new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    format: logFormat,
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    tailable: true
  })
);

// Security logs
transports.push(
  new winston.transports.File({
    filename: path.join(logsDir, 'security.log'),
    level: 'warn',
    format: logFormat,
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    tailable: true
  })
);

// HTTP access logs
transports.push(
  new winston.transports.File({
    filename: path.join(logsDir, 'access.log'),
    level: 'http',
    format: logFormat,
    maxsize: 50 * 1024 * 1024, // 50MB
    maxFiles: 10,
    tailable: true
  })
);

// Create logger instance
const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: logFormat,
  defaultMeta: {
    service: 'news-cms-saas',
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  },
  transports,
  // Don't exit on handled exceptions
  exitOnError: false
});

// Handle uncaught exceptions
logger.exceptions.handle(
  new winston.transports.File({
    filename: path.join(logsDir, 'exceptions.log'),
    format: logFormat,
    maxsize: 10 * 1024 * 1024,
    maxFiles: 3
  })
);

// Handle unhandled promise rejections
logger.rejections.handle(
  new winston.transports.File({
    filename: path.join(logsDir, 'rejections.log'),
    format: logFormat,
    maxsize: 10 * 1024 * 1024,
    maxFiles: 3
  })
);

// Custom logging methods
logger.security = (message, meta = {}) => {
  logger.warn(message, { 
    type: 'security',
    timestamp: new Date().toISOString(),
    ...meta 
  });
};

logger.audit = (action, meta = {}) => {
  logger.info(`AUDIT: ${action}`, {
    type: 'audit',
    action,
    timestamp: new Date().toISOString(),
    ...meta
  });
};

logger.performance = (message, duration, meta = {}) => {
  logger.info(message, {
    type: 'performance',
    duration_ms: duration,
    timestamp: new Date().toISOString(),
    ...meta
  });
};

logger.database = (query, duration, meta = {}) => {
  logger.debug(`DB Query: ${query}`, {
    type: 'database',
    query,
    duration_ms: duration,
    timestamp: new Date().toISOString(),
    ...meta
  });
};

logger.api = (method, path, statusCode, duration, meta = {}) => {
  const level = statusCode >= 400 ? 'error' : 'http';
  logger.log(level, `${method} ${path} ${statusCode}`, {
    type: 'api',
    method,
    path,
    status_code: statusCode,
    duration_ms: duration,
    timestamp: new Date().toISOString(),
    ...meta
  });
};

logger.tenant = (tenantId, action, meta = {}) => {
  logger.info(`Tenant ${action}`, {
    type: 'tenant',
    tenant_id: tenantId,
    action,
    timestamp: new Date().toISOString(),
    ...meta
  });
};

logger.user = (userId, action, meta = {}) => {
  logger.info(`User ${action}`, {
    type: 'user',
    user_id: userId,
    action,
    timestamp: new Date().toISOString(),
    ...meta
  });
};

// HTTP request logger middleware
logger.httpMiddleware = (req, res, next) => {
  const start = Date.now();
  
  // Log request
  logger.http(`${req.method} ${req.path}`, {
    method: req.method,
    path: req.path,
    ip: req.ip,
    user_agent: req.get('User-Agent'),
    tenant_id: req.tenantId,
    user_id: req.currentUser?.id
  });

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - start;
    
    logger.api(
      req.method,
      req.path,
      res.statusCode,
      duration,
      {
        ip: req.ip,
        user_agent: req.get('User-Agent'),
        tenant_id: req.tenantId,
        user_id: req.currentUser?.id,
        response_size: chunk ? chunk.length : 0
      }
    );

    originalEnd.call(this, chunk, encoding);
  };

  next();
};

// Error logging helper
logger.logError = (error, context = {}) => {
  const errorInfo = {
    message: error.message,
    stack: error.stack,
    name: error.name,
    code: error.code,
    ...context
  };

  logger.error('Application Error', errorInfo);
};

// Success operation logger
logger.logSuccess = (operation, meta = {}) => {
  logger.info(`SUCCESS: ${operation}`, {
    type: 'success',
    operation,
    timestamp: new Date().toISOString(),
    ...meta
  });
};

// Business logic logger
logger.business = (event, meta = {}) => {
  logger.info(`BUSINESS: ${event}`, {
    type: 'business',
    event,
    timestamp: new Date().toISOString(),
    ...meta
  });
};

// System health logger
logger.health = (component, status, meta = {}) => {
  const level = status === 'healthy' ? 'info' : 'warn';
  logger.log(level, `HEALTH: ${component} is ${status}`, {
    type: 'health',
    component,
    status,
    timestamp: new Date().toISOString(),
    ...meta
  });
};

// Create logs directory if it doesn't exist
const fs = require('fs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Export logger
module.exports = logger;