const { logger } = require('../config/logger');
const cacheService = require('./cacheService');
const queueService = require('./queueService');
const notificationService = require('./notificationService');

class PriceMonitor {
    constructor() {
        this.intervals = new Map();
        this.priceAlerts = new Map(); // userId -> { symbol, threshold, direction }[]
        this.updateIntervals = {
            FAST: 30000,    // 30 seconds
            MEDIUM: 60000,  // 1 minute
            SLOW: 300000    // 5 minutes
        };
        this.supportedTokens = new Set([
            'ethereum',
            'bitcoin',
            'usdt',
            'usdc',
            'dai'
        ]);
    }

    async start() {
        try {
            // Start price monitoring for all supported tokens
            for (const token of this.supportedTokens) {
                await this.startTokenMonitoring(token);
            }

            // Start alert checking
            this.startAlertChecking();

            logger.info('Price monitor started');
        } catch (error) {
            logger.error('Error starting price monitor:', error);
            throw error;
        }
    }

    async startTokenMonitoring(symbol, interval = this.updateIntervals.MEDIUM) {
        if (this.intervals.has(symbol)) {
            return;
        }

        const updateFn = async () => {
            try {
                const price = await this.fetchPrice(symbol);
                if (price) {
                    await this.updatePrice(symbol, price);
                }
            } catch (error) {
                logger.error(`Error updating price for ${symbol}:`, error);
            }
        };

        // Initial update
        await updateFn();

        // Set up interval
        const intervalId = setInterval(updateFn, interval);
        this.intervals.set(symbol, intervalId);
    }

    async stopTokenMonitoring(symbol) {
        const intervalId = this.intervals.get(symbol);
        if (intervalId) {
            clearInterval(intervalId);
            this.intervals.delete(symbol);
        }
    }

    startAlertChecking() {
        setInterval(async () => {
            try {
                await this.checkAllAlerts();
            } catch (error) {
                logger.error('Error checking price alerts:', error);
            }
        }, this.updateIntervals.FAST);
    }

    async fetchPrice(symbol) {
        try {
            // Try cache first
            const cachedPrice = await cacheService.getTokenPrice(symbol);
            if (cachedPrice) {
                return cachedPrice;
            }

            // Fetch from API
            const response = await fetch(
                `https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd`,
                {
                    headers: {
                        'X-CG-API-KEY': process.env.COINGECKO_API_KEY
                    }
                }
            );
            
            if (!response.ok) {
                throw new Error(`API response error: ${response.status}`);
            }

            const data = await response.json();
            const price = data[symbol]?.usd;

            if (price) {
                // Cache the price
                await cacheService.cacheTokenPrice(symbol, price);
                return price;
            }

            return null;
        } catch (error) {
            logger.error(`Error fetching price for ${symbol}:`, error);
            return null;
        }
    }

    async updatePrice(symbol, price) {
        try {
            // Add to price update queue
            await queueService.addJob('priceUpdates', {
                symbol,
                price,
                timestamp: Date.now()
            });

            // Emit price update event
            this.emitPriceUpdate(symbol, price);
        } catch (error) {
            logger.error(`Error processing price update for ${symbol}:`, error);
        }
    }

    async addPriceAlert(userId, alert) {
        try {
            const { symbol, threshold, direction } = alert;

            if (!this.supportedTokens.has(symbol.toLowerCase())) {
                throw new Error(`Unsupported token: ${symbol}`);
            }

            if (!['above', 'below'].includes(direction)) {
                throw new Error(`Invalid alert direction: ${direction}`);
            }

            // Get user's alerts
            let userAlerts = this.priceAlerts.get(userId) || [];
            
            // Add new alert
            userAlerts.push({
                id: this.generateAlertId(),
                symbol: symbol.toLowerCase(),
                threshold: parseFloat(threshold),
                direction,
                createdAt: Date.now()
            });

            // Update alerts
            this.priceAlerts.set(userId, userAlerts);

            // Ensure token is being monitored
            await this.startTokenMonitoring(symbol.toLowerCase());

            return true;
        } catch (error) {
            logger.error('Error adding price alert:', error);
            throw error;
        }
    }

    async removePriceAlert(userId, alertId) {
        try {
            let userAlerts = this.priceAlerts.get(userId) || [];
            userAlerts = userAlerts.filter(alert => alert.id !== alertId);
            this.priceAlerts.set(userId, userAlerts);
            return true;
        } catch (error) {
            logger.error('Error removing price alert:', error);
            throw error;
        }
    }

    async checkAllAlerts() {
        for (const [userId, alerts] of this.priceAlerts) {
            for (const alert of alerts) {
                await this.checkAlert(userId, alert);
            }
        }
    }

    async checkAlert(userId, alert) {
        try {
            const currentPrice = await this.fetchPrice(alert.symbol);
            if (!currentPrice) {
              return;
            }

            const triggered = (alert.direction === 'above' && currentPrice >= alert.threshold) ||
                          (alert.direction === 'below' && currentPrice <= alert.threshold);

            if (triggered) {
                await this.handleTriggeredAlert(userId, alert, currentPrice);
            }
        } catch (error) {
            logger.error('Error checking alert:', error);
        }
    }

    async handleTriggeredAlert(userId, alert, currentPrice) {
        try {
            // Send notification
            await notificationService.notifyPriceAlert(userId, {
                symbol: alert.symbol,
                price: currentPrice,
                threshold: alert.threshold,
                direction: alert.direction
            });

            // Remove triggered alert
            await this.removePriceAlert(userId, alert.id);
        } catch (error) {
            logger.error('Error handling triggered alert:', error);
        }
    }

    emitPriceUpdate(symbol, price) {
        // Implement WebSocket broadcast for price updates
    }

    generateAlertId() {
        return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async getTokenPrice(symbol) {
        return this.fetchPrice(symbol.toLowerCase());
    }

    async getUserAlerts(userId) {
        return this.priceAlerts.get(userId) || [];
    }

    async stop() {
        // Clear all intervals
        for (const [symbol, intervalId] of this.intervals) {
            clearInterval(intervalId);
        }
        this.intervals.clear();
        this.priceAlerts.clear();
        logger.info('Price monitor stopped');
    }
}

module.exports = new PriceMonitor(); 