const Redis = require('ioredis');
const { logger } = require('../config/logger');

class RateLimiter {
    constructor() {
        this.redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD,
            retryStrategy: (times) => {
                return Math.min(times * 50, 2000);
            }
        });

        this.defaultRules = {
            public: {
                points: 60,      // Number of requests
                duration: 60,    // Per 60 seconds
                blockDuration: 300 // Block for 5 minutes if exceeded
            },
            authenticated: {
                points: 300,     // Number of requests
                duration: 60,    // Per 60 seconds
                blockDuration: 300 // Block for 5 minutes if exceeded
            },
            premium: {
                points: 1000,    // Number of requests
                duration: 60,    // Per 60 seconds
                blockDuration: 300 // Block for 5 minutes if exceeded
            }
        };

        // Endpoint-specific rules
        this.endpointRules = {
            '/api/v1/transactions': {
                points: 100,
                duration: 60,
                blockDuration: 300
            },
            '/api/v1/wallet': {
                points: 150,
                duration: 60,
                blockDuration: 300
            }
        };

        // Dynamic rate limiting factors
        this.dynamicFactors = {
            systemLoad: 1.0,     // Adjust based on system load
            errorRate: 1.0,      // Adjust based on error rate
            responseTime: 1.0    // Adjust based on response time
        };
    }

    // Token bucket algorithm implementation
    async consume(key, rules) {
        const now = Date.now();
        const adjustedRules = this.adjustRules(rules);

        const tokenKey = `ratelimit:${key}:tokens`;
        const timestampKey = `ratelimit:${key}:ts`;
        const blockKey = `ratelimit:${key}:blocked`;

        try {
            // Check if blocked
            const isBlocked = await this.redis.get(blockKey);
            if (isBlocked) {
                const ttl = await this.redis.ttl(blockKey);
                return {
                    success: false,
                    remaining: 0,
                    resetTime: now + ttl * 1000,
                    blocked: true,
                    blockExpiry: parseInt(isBlocked)
                };
            }

            // Get current tokens and last update timestamp
            const [tokens, lastUpdate] = await Promise.all([
                this.redis.get(tokenKey),
                this.redis.get(timestampKey)
            ]);

            let currentTokens = tokens ? parseInt(tokens) : adjustedRules.points;
            const lastUpdateTime = lastUpdate ? parseInt(lastUpdate) : now;

            // Calculate token replenishment
            const timePassed = now - lastUpdateTime;
            const tokensToAdd = Math.floor(
                timePassed * (adjustedRules.points / (adjustedRules.duration * 1000))
            );
            currentTokens = Math.min(
                adjustedRules.points,
                currentTokens + tokensToAdd
            );

            // Consume token
            if (currentTokens > 0) {
                currentTokens--;
                
                // Update tokens and timestamp
                const pipeline = this.redis.pipeline();
                pipeline.set(tokenKey, currentTokens);
                pipeline.set(timestampKey, now);
                pipeline.expire(tokenKey, adjustedRules.duration);
                pipeline.expire(timestampKey, adjustedRules.duration);
                await pipeline.exec();

                return {
                    success: true,
                    remaining: currentTokens,
                    resetTime: now + adjustedRules.duration * 1000,
                    blocked: false
                };
            } else {
                // Block if no tokens left
                const blockExpiry = now + adjustedRules.blockDuration * 1000;
                await this.redis.set(blockKey, blockExpiry, 'EX', adjustedRules.blockDuration);

                return {
                    success: false,
                    remaining: 0,
                    resetTime: blockExpiry,
                    blocked: true,
                    blockExpiry
                };
            }
        } catch (error) {
            logger.error('Rate limiter error:', error);
            // Fail open in case of Redis error
            return {
                success: true,
                remaining: 1,
                resetTime: now + adjustedRules.duration * 1000,
                blocked: false
            };
        }
    }

    // Get rules for a specific endpoint and user type
    getRules(endpoint, userType = 'public') {
        const baseRules = this.endpointRules[endpoint] || this.defaultRules[userType];
        return { ...baseRules };
    }

    // Adjust rules based on dynamic factors
    adjustRules(rules) {
        const factor = Object.values(this.dynamicFactors).reduce((a, b) => a * b, 1);
        return {
            ...rules,
            points: Math.floor(rules.points * factor)
        };
    }

    // Update dynamic factors based on system metrics
    updateDynamicFactors(metrics) {
        try {
            // Adjust based on system load
            if (metrics.cpu > 80) {
                this.dynamicFactors.systemLoad = 0.5;
            } else if (metrics.cpu > 60) {
                this.dynamicFactors.systemLoad = 0.75;
            } else {
                this.dynamicFactors.systemLoad = 1.0;
            }

            // Adjust based on error rate
            if (metrics.errorRate > 0.1) {
                this.dynamicFactors.errorRate = 0.5;
            } else if (metrics.errorRate > 0.05) {
                this.dynamicFactors.errorRate = 0.75;
            } else {
                this.dynamicFactors.errorRate = 1.0;
            }

            // Adjust based on response time
            if (metrics.avgResponseTime > 1000) {
                this.dynamicFactors.responseTime = 0.5;
            } else if (metrics.avgResponseTime > 500) {
                this.dynamicFactors.responseTime = 0.75;
            } else {
                this.dynamicFactors.responseTime = 1.0;
            }

            logger.info('Rate limiter factors updated:', this.dynamicFactors);
        } catch (error) {
            logger.error('Error updating rate limiter factors:', error);
        }
    }

    // Middleware factory
    middleware(options = {}) {
        return async (req, res, next) => {
            const key = options.keyGenerator
                ? options.keyGenerator(req)
                : req.ip;
            
            const userType = req.user
                ? req.user.type || 'authenticated'
                : 'public';
            
            const rules = this.getRules(req.path, userType);
            const result = await this.consume(key, rules);

            // Set rate limit headers
            res.set('X-RateLimit-Limit', rules.points);
            res.set('X-RateLimit-Remaining', result.remaining);
            res.set('X-RateLimit-Reset', result.resetTime);

            if (!result.success) {
                return res.status(429).json({
                    error: 'Too Many Requests',
                    retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
                });
            }

            next();
        };
    }

    // Clean up resources
    async close() {
        await this.redis.quit();
        logger.info('Rate limiter closed');
    }
}

module.exports = new RateLimiter(); 