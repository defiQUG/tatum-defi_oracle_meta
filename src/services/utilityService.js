const crypto = require('crypto');
const Web3 = require('web3');
const { logger } = require('../config/logger');

class UtilityService {
    constructor() {
        this.web3 = new Web3();
    }

    // Crypto utilities
    generateRandomBytes(length = 32) {
        return crypto.randomBytes(length);
    }

    generateHash(data, algorithm = 'sha256') {
        return crypto
            .createHash(algorithm)
            .update(data)
            .digest('hex');
    }

    generateHMAC(data, key, algorithm = 'sha256') {
        return crypto
            .createHmac(algorithm, key)
            .update(data)
            .digest('hex');
    }

    // Web3 utilities
    toWei(amount, unit = 'ether') {
        try {
            return this.web3.utils.toWei(amount.toString(), unit);
        } catch (error) {
            logger.error('Error converting to Wei:', error);
            throw error;
        }
    }

    fromWei(amount, unit = 'ether') {
        try {
            return this.web3.utils.fromWei(amount.toString(), unit);
        } catch (error) {
            logger.error('Error converting from Wei:', error);
            throw error;
        }
    }

    isValidAddress(address) {
        return this.web3.utils.isAddress(address);
    }

    // String utilities
    truncateString(str, maxLength = 50) {
        if (str.length <= maxLength) {
          return str;
        }
        return str.substring(0, maxLength - 3) + '...';
    }

    sanitizeString(str) {
        return str.replace(/[<>]/g, '');
    }

    slugify(text) {
        return text
            .toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\w\-]+/g, '')
            .replace(/\-\-+/g, '-');
    }

    // Number utilities
    roundNumber(number, decimals = 2) {
        return Number(Math.round(number + 'e' + decimals) + 'e-' + decimals);
    }

    formatCurrency(amount, currency = 'USD', locale = 'en-US') {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: currency
        }).format(amount);
    }

    // Date utilities
    formatDate(date, format = 'YYYY-MM-DD') {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');

        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    }

    getTimestamp() {
        return Math.floor(Date.now() / 1000);
    }

    // Array utilities
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    // Object utilities
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    flattenObject(obj = {}, prefix = '') {
        return Object.keys(obj).reduce((acc, k) => {
            const pre = prefix.length ? prefix + '.' : '';
            if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
                Object.assign(acc, this.flattenObject(obj[k], pre + k));
            } else {
                acc[pre + k] = obj[k];
            }
            return acc;
        }, {});
    }

    // Network utilities
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async retry(fn, maxAttempts = 3, delay = 1000) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                if (attempt === maxAttempts) {
                  break;
                }
                
                logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
                await this.sleep(delay);
                
                // Exponential backoff
                delay *= 2;
            }
        }
        
        throw lastError;
    }

    // Validation utilities
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    isValidURL(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    // File utilities
    getFileExtension(filename) {
        return filename.slice((filename.lastIndexOf('.') - 1 >>> 0) + 2);
    }

    formatFileSize(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) {
          return '0 Bytes';
        }
        const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        const value = (bytes / Math.pow(1024, i)).toFixed(2);
        return value + ' ' + sizes[i];
    }

    // Security utilities
    generateSecureToken(length = 32) {
        return crypto
            .randomBytes(length)
            .toString('base64')
            .replace(/[^a-zA-Z0-9]/g, '')
            .slice(0, length);
    }

    compareHashes(hash1, hash2) {
        return crypto.timingSafeEqual(
            Buffer.from(hash1, 'hex'),
            Buffer.from(hash2, 'hex')
        );
    }

    // Performance utilities
    async measureExecutionTime(fn) {
        const start = process.hrtime.bigint();
        const result = await fn();
        const end = process.hrtime.bigint();
        const duration = Number(end - start) / 1e6; // Convert to milliseconds
        
        return {
            result,
            duration
        };
    }

    // Cache utilities
    memoize(fn, { ttl = 60000, maxSize = 1000 } = {}) {
        const cache = new Map();
        const timestamps = new Map();

        return async (...args) => {
            const key = JSON.stringify(args);
            const now = Date.now();

            // Clear expired entries
            if (timestamps.has(key)) {
                const timestamp = timestamps.get(key);
                if (now - timestamp > ttl) {
                    cache.delete(key);
                    timestamps.delete(key);
                }
            }

            // Enforce max size
            if (cache.size >= maxSize) {
                const oldestKey = timestamps.keys().next().value;
                cache.delete(oldestKey);
                timestamps.delete(oldestKey);
            }

            if (!cache.has(key)) {
                cache.set(key, await fn(...args));
                timestamps.set(key, now);
            }

            return cache.get(key);
        };
    }
}

module.exports = new UtilityService(); 