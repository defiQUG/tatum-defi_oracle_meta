const { logger } = require('../config/logger');
const analyticsService = require('./analyticsService');
const notificationService = require('./notificationService');

class ErrorHandler {
    constructor() {
        this.errorTypes = {
            VALIDATION: 'ValidationError',
            AUTHENTICATION: 'AuthenticationError',
            AUTHORIZATION: 'AuthorizationError',
            DATABASE: 'DatabaseError',
            NETWORK: 'NetworkError',
            BLOCKCHAIN: 'BlockchainError',
            RATE_LIMIT: 'RateLimitError',
            SYSTEM: 'SystemError'
        };

        this.errorMap = new Map();
        this.setupErrorMappings();
    }

    setupErrorMappings() {
        // Map error types to status codes and messages
        this.errorMap.set(this.errorTypes.VALIDATION, {
            statusCode: 400,
            defaultMessage: 'Invalid input data'
        });
        this.errorMap.set(this.errorTypes.AUTHENTICATION, {
            statusCode: 401,
            defaultMessage: 'Authentication failed'
        });
        this.errorMap.set(this.errorTypes.AUTHORIZATION, {
            statusCode: 403,
            defaultMessage: 'Insufficient permissions'
        });
        this.errorMap.set(this.errorTypes.DATABASE, {
            statusCode: 500,
            defaultMessage: 'Database operation failed'
        });
        this.errorMap.set(this.errorTypes.NETWORK, {
            statusCode: 503,
            defaultMessage: 'Network service unavailable'
        });
        this.errorMap.set(this.errorTypes.BLOCKCHAIN, {
            statusCode: 502,
            defaultMessage: 'Blockchain operation failed'
        });
        this.errorMap.set(this.errorTypes.RATE_LIMIT, {
            statusCode: 429,
            defaultMessage: 'Too many requests'
        });
        this.errorMap.set(this.errorTypes.SYSTEM, {
            statusCode: 500,
            defaultMessage: 'Internal server error'
        });
    }

    async handleError(error, req = null, res = null) {
        try {
            // Determine error type
            const errorType = this.determineErrorType(error);
            const { statusCode, defaultMessage } = this.errorMap.get(errorType) || 
                this.errorMap.get(this.errorTypes.SYSTEM);

            // Log error
            this.logError(error, errorType, req);

            // Track error in analytics
            await this.trackError(error, errorType, req);

            // Send notification if critical
            if (this.isCriticalError(error, errorType)) {
                await this.notifyCriticalError(error, errorType);
            }

            // Return response if res object is provided
            if (res) {
                return res.status(statusCode).json({
                    status: 'error',
                    type: errorType,
                    message: process.env.NODE_ENV === 'production' 
                        ? defaultMessage 
                        : error.message,
                    ...(process.env.NODE_ENV !== 'production' && {
                        stack: error.stack
                    })
                });
            }

            return {
                statusCode,
                error: {
                    type: errorType,
                    message: error.message
                }
            };
        } catch (handlingError) {
            logger.error('Error in error handler:', handlingError);
            if (res) {
                return res.status(500).json({
                    status: 'error',
                    message: 'Internal server error'
                });
            }
            throw handlingError;
        }
    }

    determineErrorType(error) {
        // Check for known error types
        if (error.name === 'ValidationError' || error.name === 'CastError') {
            return this.errorTypes.VALIDATION;
        }
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return this.errorTypes.AUTHENTICATION;
        }
        if (error.name === 'MongoError' && error.code === 11000) {
            return this.errorTypes.DATABASE;
        }
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            return this.errorTypes.NETWORK;
        }
        if (error.message?.includes('blockchain') || error.message?.includes('web3')) {
            return this.errorTypes.BLOCKCHAIN;
        }
        if (error.message?.includes('rate limit')) {
            return this.errorTypes.RATE_LIMIT;
        }

        // Check custom error type property
        if (error.type && this.errorMap.has(error.type)) {
            return error.type;
        }

        return this.errorTypes.SYSTEM;
    }

    logError(error, errorType, req = null) {
        const logData = {
            type: errorType,
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        };

        if (req) {
            logData.request = {
                method: req.method,
                url: req.url,
                headers: req.headers,
                body: this.sanitizeRequestBody(req.body),
                ip: req.ip
            };
        }

        logger.error('Application error:', logData);
    }

    async trackError(error, errorType, req = null) {
        try {
            await analyticsService.trackAPIUsage(req?.path || 'unknown', {
                method: req?.method || 'unknown',
                statusCode: this.errorMap.get(errorType)?.statusCode || 500,
                error: {
                    type: errorType,
                    message: error.message
                }
            });
        } catch (trackingError) {
            logger.error('Error tracking error in analytics:', trackingError);
        }
    }

    async notifyCriticalError(error, errorType) {
        try {
            await notificationService.sendNotification('system', {
                type: 'error',
                priority: 'critical',
                title: `Critical ${errorType} Error`,
                message: error.message,
                data: {
                    type: errorType,
                    stack: error.stack,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (notificationError) {
            logger.error('Error sending error notification:', notificationError);
        }
    }

    isCriticalError(error, errorType) {
        // Define criteria for critical errors
        return (
            errorType === this.errorTypes.SYSTEM ||
            errorType === this.errorTypes.DATABASE ||
            errorType === this.errorTypes.NETWORK ||
            error.critical === true
        );
    }

    sanitizeRequestBody(body) {
        if (!body) {
          return body;
        }

        // Create a copy of the body
        const sanitized = { ...body };

        // List of sensitive fields to remove
        const sensitiveFields = [
            'password',
            'token',
            'apiKey',
            'secret',
            'privateKey',
            'authorization'
        ];

        // Remove sensitive data
        sensitiveFields.forEach(field => {
            if (field in sanitized) {
                sanitized[field] = '[REDACTED]';
            }
        });

        return sanitized;
    }

    // Create custom error
    createError(type, message, details = {}) {
        const error = new Error(message);
        error.type = type;
        error.details = details;
        return error;
    }

    // Middleware for Express
    middleware() {
        return async (err, req, res, next) => {
            await this.handleError(err, req, res);
        };
    }

    // Async handler wrapper
    asyncHandler(fn) {
        return (req, res, next) => {
            Promise.resolve(fn(req, res, next)).catch(error => {
                this.handleError(error, req, res);
            });
        };
    }
}

module.exports = new ErrorHandler(); 