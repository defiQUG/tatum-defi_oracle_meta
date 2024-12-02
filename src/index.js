require('dotenv').config();
const express = require('express');
const compression = require('compression');
const { createServer } = require('https');
const mongoose = require('mongoose');
const { logger, requestLogger } = require('./config/logger');
const connectDB = require('./config/database');
const securityMiddleware = require('./middleware/security');
const errorHandler = require('./services/errorHandler');
const transactionMonitor = require('./services/transactionMonitor');
const webSocketService = require('./services/websocket');
const priceMonitor = require('./services/priceMonitor');
const analyticsService = require('./services/analyticsService');
const rateLimiter = require('./services/rateLimiter');
const cacheService = require('./services/cacheService');
const queueService = require('./services/queueService');
const monitoringService = require('./services/monitoringService');

// Create Express app and HTTP server
const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB().catch(error => {
    logger.error('Database connection error:', error);
    process.exit(1);
});

// Basic middleware
app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(requestLogger);

// Apply security middleware
securityMiddleware(app);

// Apply rate limiting
app.use(rateLimiter.middleware());

// Initialize services
const initializeServices = async () => {
    try {
        await Promise.all([
            webSocketService.initialize(server),
            transactionMonitor.start(),
            priceMonitor.start(),
            monitoringService.start()
        ]);
        logger.info('All services initialized successfully');
    } catch (error) {
        logger.error('Service initialization error:', error);
        throw error;
    }
};

// Track API usage
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        analyticsService.trackAPIUsage(req.path, {
            method: req.method,
            statusCode: res.statusCode,
            responseTime: Date.now() - start,
            userAgent: req.get('user-agent'),
            ip: req.ip
        });
    });
    next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        // Check all service statuses
        const [
            redisStatus,
            mongoStatus,
            queueStatus
        ] = await Promise.all([
            cacheService.redis.ping().then(() => true).catch(() => false),
            mongoose.connection.readyState === 1,
            Promise.all(Array.from(queueService.queues.values()).map(queue => 
                queue.getJobCounts().then(() => true).catch(() => false)
            )).then(results => results.every(status => status))
        ]);

        const systemHealth = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            services: {
                websocket: {
                    status: webSocketService.wss?.clients?.size > 0 ? 'active' : 'idle',
                    connections: webSocketService.wss?.clients?.size || 0
                },
                transactionMonitor: {
                    status: transactionMonitor.subscription ? 'active' : 'inactive',
                    lastUpdate: transactionMonitor.lastUpdate || null
                },
                priceMonitor: {
                    status: priceMonitor.intervals.size > 0 ? 'active' : 'inactive',
                    trackedTokens: Array.from(priceMonitor.intervals.keys())
                },
                cache: {
                    status: redisStatus ? 'connected' : 'disconnected',
                    type: 'redis'
                },
                queue: {
                    status: queueStatus ? 'operational' : 'degraded',
                    activeQueues: Array.from(queueService.queues.keys())
                },
                database: {
                    status: mongoStatus ? 'connected' : 'disconnected',
                    type: 'mongodb'
                }
            }
        };

        // Determine overall system status
        const servicesStatus = Object.values(systemHealth.services).map(s => s.status);
        const isHealthy = servicesStatus.every(status => 
            ['active', 'idle', 'connected', 'operational'].includes(status)
        );

        if (!isHealthy) {
            systemHealth.status = 'degraded';
        }

        // Add system metrics if available
        const metrics = await monitoringService.getMetrics();
        if (metrics) {
            systemHealth.metrics = metrics;
        }

        // Set appropriate status code
        const statusCode = isHealthy ? 200 : 503;
        res.status(statusCode).json(systemHealth);
    } catch (error) {
        errorHandler.handleError(error, req, res);
    }
});

// API routes
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/wallet', require('./routes/wallet'));
app.use('/api/v1/transactions', require('./routes/transactions'));

// Error handling middleware
app.use(errorHandler.middleware());

// Handle 404
app.use((req, res) => {
    const error = errorHandler.createError(
        errorHandler.errorTypes.VALIDATION,
        'Route not found'
    );
    errorHandler.handleError(error, req, res);
});

// Start server and services
const startServer = async () => {
    try {
        await initializeServices();
        
        const serverInstance = server.listen(PORT, () => {
            logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
        });

        // Graceful shutdown
        const gracefulShutdown = async (signal) => {
            logger.info(`Received ${signal} signal`);

            try {
                // Stop all services
                await Promise.all([
                    webSocketService.close(),
                    transactionMonitor.stop(),
                    priceMonitor.stop(),
                    rateLimiter.close(),
                    cacheService.close(),
                    queueService.close(),
                    monitoringService.stop()
                ]);

                // Close HTTP server
                await new Promise((resolve) => {
                    serverInstance.close(resolve);
                });
                logger.info('HTTP server closed');

                // Close database connection
                await mongoose.connection.close(false);
                logger.info('MongoDB connection closed');

                process.exit(0);
            } catch (error) {
                logger.error('Error during shutdown:', error);
                process.exit(1);
            }
        };

        // Handle shutdown signals
        ['SIGTERM', 'SIGINT'].forEach(signal => {
            process.on(signal, () => gracefulShutdown(signal));
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (error) => {
            logger.error('Unhandled Promise rejection:', error);
            gracefulShutdown('UNHANDLED_REJECTION');
        });

        return serverInstance;
    } catch (error) {
        logger.error('Server startup error:', error);
        process.exit(1);
    }
};

// Start the server
if (require.main === module) {
    startServer();
}

module.exports = app; 