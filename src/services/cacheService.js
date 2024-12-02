const Redis = require('ioredis');
const { logger } = require('../config/logger');

class CacheService {
    constructor() {
        this.redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD,
            retryStrategy: (times) => {
                return Math.min(times * 50, 2000);
            }
        });

        this.defaultTTL = 3600; // 1 hour in seconds
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.redis.on('error', (error) => {
            logger.error('Redis error:', error);
        });

        this.redis.on('connect', () => {
            logger.info('Redis connected');
        });

        this.redis.on('ready', () => {
            logger.info('Redis ready');
        });

        this.redis.on('close', () => {
            logger.warn('Redis connection closed');
        });

        this.redis.on('reconnecting', () => {
            logger.info('Redis reconnecting');
        });
    }

    // Basic cache operations
    async get(key) {
        try {
            const value = await this.redis.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            logger.error('Cache get error:', error);
            return null;
        }
    }

    async set(key, value, ttl = this.defaultTTL) {
        try {
            const serializedValue = JSON.stringify(value);
            await this.redis.set(key, serializedValue, 'EX', ttl);
            return true;
        } catch (error) {
            logger.error('Cache set error:', error);
            return false;
        }
    }

    async del(key) {
        try {
            await this.redis.del(key);
            return true;
        } catch (error) {
            logger.error('Cache delete error:', error);
            return false;
        }
    }

    // Advanced cache operations
    async getOrSet(key, fetchFn, ttl = this.defaultTTL) {
        try {
            const cached = await this.get(key);
            if (cached !== null) {
                return cached;
            }

            const value = await fetchFn();
            await this.set(key, value, ttl);
            return value;
        } catch (error) {
            logger.error('Cache getOrSet error:', error);
            return null;
        }
    }

    async mget(keys) {
        try {
            const values = await this.redis.mget(keys);
            return values.map(value => value ? JSON.parse(value) : null);
        } catch (error) {
            logger.error('Cache mget error:', error);
            return keys.map(() => null);
        }
    }

    async mset(keyValuePairs, ttl = this.defaultTTL) {
        try {
            const pipeline = this.redis.pipeline();
            
            Object.entries(keyValuePairs).forEach(([key, value]) => {
                pipeline.set(key, JSON.stringify(value), 'EX', ttl);
            });

            await pipeline.exec();
            return true;
        } catch (error) {
            logger.error('Cache mset error:', error);
            return false;
        }
    }

    // Cache patterns
    async remember(key, ttl, fetchFn) {
        return this.getOrSet(key, fetchFn, ttl);
    }

    async rememberForever(key, fetchFn) {
        return this.getOrSet(key, fetchFn, 0);
    }

    async tags(tags) {
        return new TaggedCache(this, tags);
    }

    // Cache management
    async flush() {
        try {
            await this.redis.flushdb();
            return true;
        } catch (error) {
            logger.error('Cache flush error:', error);
            return false;
        }
    }

    async clear(pattern) {
        try {
            const keys = await this.redis.keys(pattern);
            if (keys.length > 0) {
                await this.redis.del(keys);
            }
            return true;
        } catch (error) {
            logger.error('Cache clear error:', error);
            return false;
        }
    }

    // Cache statistics
    async getStats() {
        try {
            const info = await this.redis.info();
            return this.parseRedisInfo(info);
        } catch (error) {
            logger.error('Cache stats error:', error);
            return null;
        }
    }

    // Helper methods
    parseRedisInfo(info) {
        const stats = {};
        info.split('\n').forEach(line => {
            const parts = line.split(':');
            if (parts.length === 2) {
                stats[parts[0]] = parts[1];
            }
        });
        return stats;
    }

    // Specialized caching methods for the DeFi platform
    async cacheTokenPrice(symbol, price, ttl = 300) { // 5 minutes
        return this.set(`price:${symbol.toLowerCase()}`, price, ttl);
    }

    async getTokenPrice(symbol) {
        return this.get(`price:${symbol.toLowerCase()}`);
    }

    async cacheGasPrice(gasPrice, ttl = 60) { // 1 minute
        return this.set('gas:price', gasPrice, ttl);
    }

    async getGasPrice() {
        return this.get('gas:price');
    }

    async cacheTransactionReceipt(txHash, receipt, ttl = 3600) { // 1 hour
        return this.set(`tx:${txHash}`, receipt, ttl);
    }

    async getTransactionReceipt(txHash) {
        return this.get(`tx:${txHash}`);
    }

    async cacheUserBalance(userId, address, balance, ttl = 300) { // 5 minutes
        return this.set(`balance:${userId}:${address}`, balance, ttl);
    }

    async getUserBalance(userId, address) {
        return this.get(`balance:${userId}:${address}`);
    }

    // Close connection
    async close() {
        await this.redis.quit();
        logger.info('Redis connection closed');
    }
}

// Tagged cache implementation
class TaggedCache {
    constructor(cache, tags) {
        this.cache = cache;
        this.tags = Array.isArray(tags) ? tags : [tags];
    }

    async get(key) {
        return this.cache.get(this.taggedKey(key));
    }

    async set(key, value, ttl = null) {
        const taggedKey = this.taggedKey(key);
        await this.cache.set(taggedKey, value, ttl);
        
        // Store key in tag sets
        const pipeline = this.cache.redis.pipeline();
        this.tags.forEach(tag => {
            pipeline.sadd(`tag:${tag}`, taggedKey);
        });
        await pipeline.exec();
    }

    async flush() {
        try {
            const pipeline = this.cache.redis.pipeline();
            
            // Get all keys for each tag
            const tagKeys = await Promise.all(
                this.tags.map(tag => this.cache.redis.smembers(`tag:${tag}`))
            );
            
            // Delete all tagged keys and tag sets
            const keys = [...new Set(tagKeys.flat())];
            if (keys.length > 0) {
                pipeline.del(keys);
            }
            
            this.tags.forEach(tag => {
                pipeline.del(`tag:${tag}`);
            });
            
            await pipeline.exec();
            return true;
        } catch (error) {
            logger.error('Tagged cache flush error:', error);
            return false;
        }
    }

    taggedKey(key) {
        return `${this.tags.join('|')}:${key}`;
    }
}

module.exports = new CacheService(); 