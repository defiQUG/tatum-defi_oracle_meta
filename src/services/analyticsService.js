const { logger } = require('../config/logger');
const cacheService = require('./cacheService');
const queueService = require('./queueService');

class AnalyticsService {
    constructor() {
        this.metrics = {
            USER_ACTIVITY: 'user_activity',
            TRANSACTION_VOLUME: 'transaction_volume',
            GAS_USAGE: 'gas_usage',
            API_USAGE: 'api_usage',
            SYSTEM_PERFORMANCE: 'system_performance'
        };

        this.timeframes = {
            HOUR: 3600,
            DAY: 86400,
            WEEK: 604800,
            MONTH: 2592000
        };
    }

    // User Activity Tracking
    async trackUserActivity(userId, activity) {
        try {
            const eventData = {
                userId,
                type: activity.type,
                timestamp: Date.now(),
                details: activity.details || {},
                metadata: {
                    userAgent: activity.userAgent,
                    ip: activity.ip,
                    location: activity.location
                }
            };

            await queueService.addJob('analytics', {
                type: this.metrics.USER_ACTIVITY,
                data: eventData
            });

            // Update real-time metrics
            await this.updateRealtimeMetrics(this.metrics.USER_ACTIVITY, eventData);
        } catch (error) {
            logger.error('Error tracking user activity:', error);
        }
    }

    // Transaction Analytics
    async trackTransaction(transaction) {
        try {
            const txData = {
                hash: transaction.hash,
                from: transaction.from,
                to: transaction.to,
                value: transaction.value,
                gasUsed: transaction.gasUsed,
                timestamp: Date.now(),
                status: transaction.status
            };

            await queueService.addJob('analytics', {
                type: this.metrics.TRANSACTION_VOLUME,
                data: txData
            });

            // Update volume metrics
            await this.updateVolumeMetrics(txData);
        } catch (error) {
            logger.error('Error tracking transaction:', error);
        }
    }

    // Gas Usage Analytics
    async trackGasUsage(transaction) {
        try {
            const gasData = {
                hash: transaction.hash,
                gasUsed: transaction.gasUsed,
                gasPrice: transaction.gasPrice,
                timestamp: Date.now()
            };

            await queueService.addJob('analytics', {
                type: this.metrics.GAS_USAGE,
                data: gasData
            });

            // Update gas usage metrics
            await this.updateGasMetrics(gasData);
        } catch (error) {
            logger.error('Error tracking gas usage:', error);
        }
    }

    // API Usage Analytics
    async trackAPIUsage(endpoint, response) {
        try {
            const apiData = {
                endpoint,
                method: response.method,
                statusCode: response.statusCode,
                responseTime: response.responseTime,
                timestamp: Date.now(),
                userAgent: response.userAgent,
                ip: response.ip
            };

            await queueService.addJob('analytics', {
                type: this.metrics.API_USAGE,
                data: apiData
            });

            // Update API metrics
            await this.updateAPIMetrics(apiData);
        } catch (error) {
            logger.error('Error tracking API usage:', error);
        }
    }

    // System Performance Analytics
    async trackSystemPerformance(metrics) {
        try {
            const perfData = {
                cpu: metrics.cpu,
                memory: metrics.memory,
                latency: metrics.latency,
                timestamp: Date.now()
            };

            await queueService.addJob('analytics', {
                type: this.metrics.SYSTEM_PERFORMANCE,
                data: perfData
            });

            // Update performance metrics
            await this.updatePerformanceMetrics(perfData);
        } catch (error) {
            logger.error('Error tracking system performance:', error);
        }
    }

    // Analytics Retrieval Methods
    async getUserAnalytics(userId, timeframe = this.timeframes.DAY) {
        try {
            const cacheKey = `analytics:user:${userId}:${timeframe}`;
            return await cacheService.remember(cacheKey, 300, async () => {
                // Implement user analytics aggregation
                return {
                    activities: await this.aggregateUserActivities(userId, timeframe),
                    transactions: await this.aggregateUserTransactions(userId, timeframe),
                    gasUsage: await this.aggregateUserGasUsage(userId, timeframe)
                };
            });
        } catch (error) {
            logger.error('Error retrieving user analytics:', error);
            return null;
        }
    }

    async getSystemAnalytics(timeframe = this.timeframes.DAY) {
        try {
            const cacheKey = `analytics:system:${timeframe}`;
            return await cacheService.remember(cacheKey, 300, async () => {
                return {
                    performance: await this.aggregateSystemPerformance(timeframe),
                    apiUsage: await this.aggregateAPIUsage(timeframe),
                    errors: await this.aggregateErrors(timeframe)
                };
            });
        } catch (error) {
            logger.error('Error retrieving system analytics:', error);
            return null;
        }
    }

    // Helper Methods
    async updateRealtimeMetrics(metricType, data) {
        try {
            const key = `metrics:realtime:${metricType}`;
            const currentMetrics = await cacheService.get(key) || [];
            currentMetrics.push(data);

            // Keep only last hour of data
            const hourAgo = Date.now() - this.timeframes.HOUR * 1000;
            const filteredMetrics = currentMetrics.filter(m => m.timestamp >= hourAgo);

            await cacheService.set(key, filteredMetrics, this.timeframes.HOUR);
        } catch (error) {
            logger.error('Error updating realtime metrics:', error);
        }
    }

    async updateVolumeMetrics(txData) {
        try {
            const key = `metrics:volume:${Math.floor(Date.now() / 86400000)}`;
            const currentVolume = await cacheService.get(key) || {
                count: 0,
                volume: '0',
                gasUsed: '0'
            };

            currentVolume.count++;
            currentVolume.volume = (
                BigInt(currentVolume.volume) + BigInt(txData.value)
            ).toString();
            currentVolume.gasUsed = (
                BigInt(currentVolume.gasUsed) + BigInt(txData.gasUsed)
            ).toString();

            await cacheService.set(key, currentVolume, this.timeframes.DAY);
        } catch (error) {
            logger.error('Error updating volume metrics:', error);
        }
    }

    async updateGasMetrics(gasData) {
        try {
            const key = `metrics:gas:${Math.floor(Date.now() / 3600000)}`;
            const currentGas = await cacheService.get(key) || {
                count: 0,
                totalGasUsed: '0',
                avgGasPrice: '0'
            };

            currentGas.count++;
            currentGas.totalGasUsed = (
                BigInt(currentGas.totalGasUsed) + BigInt(gasData.gasUsed)
            ).toString();
            currentGas.avgGasPrice = (
                (BigInt(currentGas.avgGasPrice) * BigInt(currentGas.count - 1) +
                    BigInt(gasData.gasPrice)) /
                BigInt(currentGas.count)
            ).toString();

            await cacheService.set(key, currentGas, this.timeframes.HOUR);
        } catch (error) {
            logger.error('Error updating gas metrics:', error);
        }
    }

    async updateAPIMetrics(apiData) {
        try {
            const key = `metrics:api:${Math.floor(Date.now() / 60000)}`;
            const currentAPI = await cacheService.get(key) || {
                requests: 0,
                errors: 0,
                avgResponseTime: 0
            };

            currentAPI.requests++;
            if (apiData.statusCode >= 400) {
                currentAPI.errors++;
            }
            currentAPI.avgResponseTime = (
                (currentAPI.avgResponseTime * (currentAPI.requests - 1) +
                    apiData.responseTime) /
                currentAPI.requests
            );

            await cacheService.set(key, currentAPI, 60);
        } catch (error) {
            logger.error('Error updating API metrics:', error);
        }
    }

    async updatePerformanceMetrics(perfData) {
        try {
            const key = `metrics:performance:${Math.floor(Date.now() / 60000)}`;
            await cacheService.set(key, perfData, 60);
        } catch (error) {
            logger.error('Error updating performance metrics:', error);
        }
    }

    // Aggregation Methods
    async aggregateUserActivities(userId, timeframe) {
        // Implement user activity aggregation
    }

    async aggregateUserTransactions(userId, timeframe) {
        // Implement user transaction aggregation
    }

    async aggregateUserGasUsage(userId, timeframe) {
        // Implement user gas usage aggregation
    }

    async aggregateSystemPerformance(timeframe) {
        // Implement system performance aggregation
    }

    async aggregateAPIUsage(timeframe) {
        // Implement API usage aggregation
    }

    async aggregateErrors(timeframe) {
        // Implement error aggregation
    }
}

module.exports = new AnalyticsService(); 