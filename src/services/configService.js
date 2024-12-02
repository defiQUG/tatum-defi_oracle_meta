const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { logger } = require('../config/logger');

class ConfigService {
    constructor() {
        this.config = {};
        this.initialized = false;
        this.envPath = path.resolve(process.cwd(), '.env');
    }

    initialize() {
        if (this.initialized) {
            return;
        }

        try {
            // Load environment variables from .env file
            const envConfig = dotenv.config({ path: this.envPath });
            
            if (envConfig.error) {
                logger.warn('No .env file found, using existing environment variables');
            }

            // Set default configurations
            this.config = {
                app: {
                    name: process.env.APP_NAME || 'DeFi Oracle Meta',
                    env: process.env.NODE_ENV || 'development',
                    port: parseInt(process.env.PORT, 10) || 3000,
                    host: process.env.HOST || 'localhost',
                    apiPrefix: process.env.API_PREFIX || '/api/v1',
                    corsOrigin: process.env.CORS_ORIGIN || '*',
                    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW, 10) || 15 * 60 * 1000, // 15 minutes
                    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100
                },
                auth: {
                    jwtSecret: process.env.JWT_SECRET,
                    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
                    refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
                    saltRounds: parseInt(process.env.SALT_ROUNDS, 10) || 10
                },
                database: {
                    url: process.env.DATABASE_URL,
                    host: process.env.DB_HOST || 'localhost',
                    port: parseInt(process.env.DB_PORT, 10) || 5432,
                    name: process.env.DB_NAME,
                    user: process.env.DB_USER,
                    password: process.env.DB_PASSWORD,
                    ssl: process.env.DB_SSL === 'true',
                    maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE, 10) || 10
                },
                redis: {
                    url: process.env.REDIS_URL,
                    host: process.env.REDIS_HOST || 'localhost',
                    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
                    password: process.env.REDIS_PASSWORD,
                    db: parseInt(process.env.REDIS_DB, 10) || 0
                },
                blockchain: {
                    networkId: parseInt(process.env.NETWORK_ID, 10) || 1,
                    rpcUrl: process.env.RPC_URL,
                    wsUrl: process.env.WS_URL,
                    explorerUrl: process.env.EXPLORER_URL,
                    gasPrice: process.env.GAS_PRICE || 'auto',
                    maxGasPrice: process.env.MAX_GAS_PRICE || '200000000000', // 200 Gwei
                    confirmationBlocks: parseInt(process.env.CONFIRMATION_BLOCKS, 10) || 2
                },
                tatum: {
                    apiKey: process.env.TATUM_API_KEY,
                    apiUrl: process.env.TATUM_API_URL || 'https://api.tatum.io',
                    testnet: process.env.TATUM_TESTNET === 'true'
                },
                security: {
                    enableRateLimit: process.env.ENABLE_RATE_LIMIT !== 'false',
                    enableCors: process.env.ENABLE_CORS !== 'false',
                    enableHelmet: process.env.ENABLE_HELMET !== 'false',
                    csrfProtection: process.env.CSRF_PROTECTION !== 'false',
                    maxRequestSize: process.env.MAX_REQUEST_SIZE || '10mb'
                },
                logging: {
                    level: process.env.LOG_LEVEL || 'info',
                    format: process.env.LOG_FORMAT || 'combined',
                    directory: process.env.LOG_DIRECTORY || 'logs'
                },
                monitoring: {
                    enabled: process.env.MONITORING_ENABLED === 'true',
                    interval: parseInt(process.env.MONITORING_INTERVAL, 10) || 60000
                },
                cache: {
                    ttl: parseInt(process.env.CACHE_TTL, 10) || 3600,
                    checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD, 10) || 600
                },
                email: {
                    host: process.env.EMAIL_HOST,
                    port: parseInt(process.env.EMAIL_PORT, 10) || 587,
                    secure: process.env.EMAIL_SECURE === 'true',
                    auth: {
                        user: process.env.EMAIL_USER,
                        pass: process.env.EMAIL_PASSWORD
                    },
                    from: process.env.EMAIL_FROM
                }
            };

            // Validate required configurations
            this.validateConfig();

            this.initialized = true;
            logger.info('Configuration loaded successfully');
        } catch (error) {
            logger.error('Error loading configuration:', error);
            throw error;
        }
    }

    validateConfig() {
        const requiredConfigs = [
            { path: 'auth.jwtSecret', message: 'JWT secret is required' },
            { path: 'database.url', message: 'Database URL is required' },
            { path: 'blockchain.rpcUrl', message: 'RPC URL is required' },
            { path: 'tatum.apiKey', message: 'Tatum API key is required' }
        ];

        const missingConfigs = requiredConfigs.filter(config => {
            const value = this.get(config.path);
            return !value || value.toString().trim() === '';
        });

        if (missingConfigs.length > 0) {
            const messages = missingConfigs.map(config => config.message);
            throw new Error('Missing required configurations: ' + messages.join(', '));
        }
    }

    get(path) {
        if (!this.initialized) {
            this.initialize();
        }

        return path.split('.').reduce((config, part) => {
            return config && config[part];
        }, this.config);
    }

    set(path, value) {
        if (!this.initialized) {
            this.initialize();
        }

        const parts = path.split('.');
        const last = parts.pop();
        const config = parts.reduce((config, part) => {
            if (!config[part]) {
                config[part] = {};
            }
            return config[part];
        }, this.config);

        config[last] = value;
    }

    getAll() {
        if (!this.initialized) {
            this.initialize();
        }

        return this.config;
    }

    isDevelopment() {
        return this.get('app.env') === 'development';
    }

    isProduction() {
        return this.get('app.env') === 'production';
    }

    isTest() {
        return this.get('app.env') === 'test';
    }

    async updateEnvFile(updates) {
        try {
            let envContent = '';
            
            // Read existing .env file if it exists
            if (fs.existsSync(this.envPath)) {
                envContent = fs.readFileSync(this.envPath, 'utf8');
            }

            // Parse existing environment variables
            const envVars = dotenv.parse(envContent);

            // Apply updates
            Object.assign(envVars, updates);

            // Convert to string format
            const newEnvContent = Object.entries(envVars)
                .map(([key, value]) => `${key}=${value}`)
                .join('\n');

            // Write back to .env file
            fs.writeFileSync(this.envPath, newEnvContent);

            // Reload configuration
            this.initialized = false;
            this.initialize();

            logger.info('Environment file updated successfully');
        } catch (error) {
            logger.error('Error updating environment file:', error);
            throw error;
        }
    }

    getNetworkConfig() {
        return {
            networkId: this.get('blockchain.networkId'),
            rpcUrl: this.get('blockchain.rpcUrl'),
            wsUrl: this.get('blockchain.wsUrl'),
            explorerUrl: this.get('blockchain.explorerUrl')
        };
    }

    getDatabaseConfig() {
        return {
            url: this.get('database.url'),
            host: this.get('database.host'),
            port: this.get('database.port'),
            name: this.get('database.name'),
            user: this.get('database.user'),
            password: this.get('database.password'),
            ssl: this.get('database.ssl'),
            maxPoolSize: this.get('database.maxPoolSize')
        };
    }

    getRedisConfig() {
        return {
            url: this.get('redis.url'),
            host: this.get('redis.host'),
            port: this.get('redis.port'),
            password: this.get('redis.password'),
            db: this.get('redis.db')
        };
    }

    getTatumConfig() {
        return {
            apiKey: this.get('tatum.apiKey'),
            apiUrl: this.get('tatum.apiUrl'),
            testnet: this.get('tatum.testnet')
        };
    }

    getSecurityConfig() {
        return {
            enableRateLimit: this.get('security.enableRateLimit'),
            enableCors: this.get('security.enableCors'),
            enableHelmet: this.get('security.enableHelmet'),
            csrfProtection: this.get('security.csrfProtection'),
            maxRequestSize: this.get('security.maxRequestSize')
        };
    }
}

module.exports = new ConfigService(); 