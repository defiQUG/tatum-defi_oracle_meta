const Queue = require('bull');
const { logger } = require('../config/logger');
const notificationService = require('./notificationService');
const cacheService = require('./cacheService');

class QueueService {
    constructor() {
        this.queues = new Map();
        this.defaultJobOptions = {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000
            },
            removeOnComplete: 100,
            removeOnFail: 100
        };

        this.initializeQueues();
    }

    initializeQueues() {
        // Transaction processing queue
        this.createQueue('transactions', {
            process: async (job) => {
                await this.processTransaction(job.data);
            }
        });

        // Notification queue
        this.createQueue('notifications', {
            process: async (job) => {
                await this.processNotification(job.data);
            }
        });

        // Price updates queue
        this.createQueue('priceUpdates', {
            process: async (job) => {
                await this.processPriceUpdate(job.data);
            }
        });

        // Cache maintenance queue
        this.createQueue('cacheMaintenance', {
            process: async (job) => {
                await this.processCacheMaintenance(job.data);
            }
        });

        // Data export queue
        this.createQueue('dataExports', {
            process: async (job) => {
                await this.processDataExport(job.data);
            }
        });
    }

    createQueue(name, options) {
        const queue = new Queue(name, {
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD
            }
        });

        // Set up event handlers
        queue.on('error', (error) => {
            logger.error(`Queue ${name} error:`, error);
        });

        queue.on('failed', (job, error) => {
            logger.error(`Job ${job.id} in queue ${name} failed:`, error);
        });

        queue.on('completed', (job) => {
            logger.info(`Job ${job.id} in queue ${name} completed`);
        });

        // Set up processor
        if (options.process) {
            queue.process(options.concurrency || 1, options.process);
        }

        this.queues.set(name, queue);
        return queue;
    }

    getQueue(name) {
        return this.queues.get(name);
    }

    // Job addition methods
    async addJob(queueName, data, options = {}) {
        const queue = this.getQueue(queueName);
        if (!queue) {
            throw new Error(`Queue ${queueName} not found`);
        }

        const jobOptions = {
            ...this.defaultJobOptions,
            ...options
        };

        return queue.add(data, jobOptions);
    }

    // Specialized job processors
    async processTransaction(data) {
        try {
            const { type, transaction, userId } = data;

            switch (type) {
                case 'confirmation':
                    await this.processTransactionConfirmation(transaction, userId);
                    break;
                case 'monitoring':
                    await this.processTransactionMonitoring(transaction, userId);
                    break;
                case 'gas':
                    await this.processGasPrice(transaction, userId);
                    break;
                default:
                    logger.warn(`Unknown transaction process type: ${type}`);
            }
        } catch (error) {
            logger.error('Transaction processing error:', error);
            throw error;
        }
    }

    async processNotification(data) {
        try {
            const { userId, notification } = data;
            await notificationService.sendNotification(userId, notification);
        } catch (error) {
            logger.error('Notification processing error:', error);
            throw error;
        }
    }

    async processPriceUpdate(data) {
        try {
            const { symbol, price } = data;
            await cacheService.cacheTokenPrice(symbol, price);
            
            // Check price alerts
            await this.checkPriceAlerts(symbol, price);
        } catch (error) {
            logger.error('Price update processing error:', error);
            throw error;
        }
    }

    async processCacheMaintenance(data) {
        try {
            const { type, pattern } = data;

            switch (type) {
                case 'clean':
                    await cacheService.clear(pattern);
                    break;
                case 'refresh':
                    await this.refreshCacheData(pattern);
                    break;
                default:
                    logger.warn(`Unknown cache maintenance type: ${type}`);
            }
        } catch (error) {
            logger.error('Cache maintenance error:', error);
            throw error;
        }
    }

    async processDataExport(data) {
        try {
            const { type, userId, options } = data;

            switch (type) {
                case 'transactions':
                    await this.exportTransactions(userId, options);
                    break;
                case 'analytics':
                    await this.exportAnalytics(userId, options);
                    break;
                default:
                    logger.warn(`Unknown export type: ${type}`);
            }
        } catch (error) {
            logger.error('Data export error:', error);
            throw error;
        }
    }

    // Helper methods
    async processTransactionConfirmation(transaction, userId) {
        // Implement transaction confirmation logic
    }

    async processTransactionMonitoring(transaction, userId) {
        // Implement transaction monitoring logic
    }

    async processGasPrice(transaction, userId) {
        // Implement gas price processing logic
    }

    async checkPriceAlerts(symbol, price) {
        // Implement price alert checking logic
    }

    async refreshCacheData(pattern) {
        // Implement cache refresh logic
    }

    async exportTransactions(userId, options) {
        // Implement transaction export logic
    }

    async exportAnalytics(userId, options) {
        // Implement analytics export logic
    }

    // Queue management methods
    async pause(queueName) {
        const queue = this.getQueue(queueName);
        if (queue) {
            await queue.pause();
        }
    }

    async resume(queueName) {
        const queue = this.getQueue(queueName);
        if (queue) {
            await queue.resume();
        }
    }

    async clean(queueName, grace) {
        const queue = this.getQueue(queueName);
        if (queue) {
            await queue.clean(grace);
        }
    }

    async close() {
        const closePromises = Array.from(this.queues.values()).map(queue => queue.close());
        await Promise.all(closePromises);
        logger.info('All queues closed');
    }

    // Queue monitoring methods
    async getQueueStats(queueName) {
        const queue = this.getQueue(queueName);
        if (!queue) {
          return null;
        }

        const [
            jobCounts,
            completedCount,
            failedCount,
            delayedCount,
            activeCount,
            waitingCount
        ] = await Promise.all([
            queue.getJobCounts(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
            queue.getDelayedCount(),
            queue.getActiveCount(),
            queue.getWaitingCount()
        ]);

        return {
            jobCounts,
            completedCount,
            failedCount,
            delayedCount,
            activeCount,
            waitingCount
        };
    }
}

module.exports = new QueueService(); 