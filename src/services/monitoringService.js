const os = require('os');
const { EventEmitter } = require('events');
const { logger } = require('../config/logger');
const configService = require('./configService');
const utilityService = require('./utilityService');

class MonitoringService extends EventEmitter {
    constructor() {
        super();
        this.metrics = {
            system: {},
            process: {},
            application: {
                requests: {
                    total: 0,
                    success: 0,
                    failed: 0,
                    latency: []
                },
                endpoints: new Map(),
                errors: {
                    count: 0,
                    recent: []
                },
                memory: {
                    leaks: [],
                    gc: []
                }
            },
            blockchain: {
                transactions: {
                    pending: 0,
                    confirmed: 0,
                    failed: 0
                },
                gasPrice: {
                    current: 0,
                    history: []
                },
                blocks: {
                    latest: 0,
                    processed: 0
                }
            }
        };
        
        this.alerts = new Map();
        this.thresholds = {
            cpu: 80, // CPU usage percentage
            memory: 85, // Memory usage percentage
            disk: 90, // Disk usage percentage
            requestLatency: 1000, // Request latency in ms
            errorRate: 5 // Error rate percentage
        };
        
        this.interval = null;
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) {
            logger.warn('Monitoring service is already running');
            return;
        }

        const interval = configService.get('monitoring.interval');
        
        this.interval = setInterval(() => {
            this.collectMetrics();
            this.analyzeMetrics();
            this.cleanupOldMetrics();
        }, interval);

        this.setupEventListeners();
        this.isRunning = true;
        
        logger.info('Monitoring service started');
    }

    stop() {
        if (!this.isRunning) {
            logger.warn('Monitoring service is not running');
            return;
        }

        clearInterval(this.interval);
        this.interval = null;
        this.isRunning = false;
        
        logger.info('Monitoring service stopped');
    }

    async collectMetrics() {
        try {
            // System metrics
            this.metrics.system = {
                cpu: {
                    usage: await this.getCPUUsage(),
                    cores: os.cpus().length,
                    loadAvg: os.loadavg()
                },
                memory: {
                    total: os.totalmem(),
                    free: os.freemem(),
                    usage: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
                },
                uptime: os.uptime(),
                platform: os.platform(),
                arch: os.arch(),
                timestamp: Date.now()
            };

            // Process metrics
            const processMetrics = process.memoryUsage();
            this.metrics.process = {
                memory: {
                    heapTotal: processMetrics.heapTotal,
                    heapUsed: processMetrics.heapUsed,
                    external: processMetrics.external,
                    rss: processMetrics.rss
                },
                cpu: process.cpuUsage(),
                uptime: process.uptime(),
                pid: process.pid
            };

            // Application metrics are updated through event listeners

            logger.debug('Metrics collected successfully');
        } catch (error) {
            logger.error('Error collecting metrics:', error);
            this.emit('error', error);
        }
    }

    analyzeMetrics() {
        try {
            // Check CPU usage
            if (this.metrics.system.cpu.usage > this.thresholds.cpu) {
                this.createAlert('HIGH_CPU_USAGE', {
                    level: 'warning',
                    message: `CPU usage is at ${this.metrics.system.cpu.usage}%`,
                    value: this.metrics.system.cpu.usage,
                    threshold: this.thresholds.cpu
                });
            }

            // Check memory usage
            const memoryUsage = this.metrics.system.memory.usage;
            if (memoryUsage > this.thresholds.memory) {
                this.createAlert('HIGH_MEMORY_USAGE', {
                    level: 'warning',
                    message: `Memory usage is at ${memoryUsage}%`,
                    value: memoryUsage,
                    threshold: this.thresholds.memory
                });
            }

            // Check request latency
            const avgLatency = this.calculateAverageLatency();
            if (avgLatency > this.thresholds.requestLatency) {
                this.createAlert('HIGH_LATENCY', {
                    level: 'warning',
                    message: `Average request latency is ${avgLatency}ms`,
                    value: avgLatency,
                    threshold: this.thresholds.requestLatency
                });
            }

            // Check error rate
            const errorRate = this.calculateErrorRate();
            if (errorRate > this.thresholds.errorRate) {
                this.createAlert('HIGH_ERROR_RATE', {
                    level: 'error',
                    message: `Error rate is at ${errorRate}%`,
                    value: errorRate,
                    threshold: this.thresholds.errorRate
                });
            }

            // Check for memory leaks
            this.detectMemoryLeaks();

            logger.debug('Metrics analysis completed');
        } catch (error) {
            logger.error('Error analyzing metrics:', error);
            this.emit('error', error);
        }
    }

    cleanupOldMetrics() {
        try {
            const now = Date.now();
            const retentionPeriod = 24 * 60 * 60 * 1000; // 24 hours

            // Clean up latency history
            this.metrics.application.requests.latency = this.metrics.application.requests.latency
                .filter(entry => now - entry.timestamp < retentionPeriod);

            // Clean up error history
            this.metrics.application.errors.recent = this.metrics.application.errors.recent
                .filter(error => now - error.timestamp < retentionPeriod);

            // Clean up gas price history
            this.metrics.blockchain.gasPrice.history = this.metrics.blockchain.gasPrice.history
                .filter(entry => now - entry.timestamp < retentionPeriod);

            // Clean up alerts
            for (const [alertId, alert] of this.alerts) {
                if (now - alert.timestamp > retentionPeriod) {
                    this.alerts.delete(alertId);
                }
            }

            logger.debug('Old metrics cleaned up');
        } catch (error) {
            logger.error('Error cleaning up old metrics:', error);
            this.emit('error', error);
        }
    }

    setupEventListeners() {
        // Request monitoring
        this.on('request', ({ method, path, duration, statusCode }) => {
            this.metrics.application.requests.total++;
            
            if (statusCode >= 200 && statusCode < 400) {
                this.metrics.application.requests.success++;
            } else {
                this.metrics.application.requests.failed++;
            }

            this.metrics.application.requests.latency.push({
                timestamp: Date.now(),
                duration,
                path,
                method
            });

            // Update endpoint statistics
            const endpoint = `${method} ${path}`;
            const endpointStats = this.metrics.application.endpoints.get(endpoint) || {
                count: 0,
                totalDuration: 0,
                avgDuration: 0
            };

            endpointStats.count++;
            endpointStats.totalDuration += duration;
            endpointStats.avgDuration = endpointStats.totalDuration / endpointStats.count;

            this.metrics.application.endpoints.set(endpoint, endpointStats);
        });

        // Error monitoring
        this.on('error', (error) => {
            this.metrics.application.errors.count++;
            this.metrics.application.errors.recent.push({
                timestamp: Date.now(),
                message: error.message,
                stack: error.stack,
                type: error.name
            });
        });

        // Blockchain monitoring
        this.on('transaction', ({ status, gasPrice }) => {
            if (status === 'pending') {
                this.metrics.blockchain.transactions.pending++;
            } else if (status === 'confirmed') {
                this.metrics.blockchain.transactions.confirmed++;
                this.metrics.blockchain.transactions.pending--;
            } else if (status === 'failed') {
                this.metrics.blockchain.transactions.failed++;
                this.metrics.blockchain.transactions.pending--;
            }

            if (gasPrice) {
                this.metrics.blockchain.gasPrice.current = gasPrice;
                this.metrics.blockchain.gasPrice.history.push({
                    timestamp: Date.now(),
                    value: gasPrice
                });
            }
        });

        this.on('block', ({ number }) => {
            this.metrics.blockchain.blocks.latest = number;
            this.metrics.blockchain.blocks.processed++;
        });
    }

    async getCPUUsage() {
        return new Promise((resolve) => {
            const startUsage = process.cpuUsage();
            const startTime = process.hrtime();

            setTimeout(() => {
                const endUsage = process.cpuUsage(startUsage);
                const endTime = process.hrtime(startTime);

                const elapsedTime = endTime[0] * 1e6 + endTime[1] / 1e3; // microseconds
                const cpuUsage = (endUsage.user + endUsage.system) / elapsedTime * 100;

                resolve(Math.round(cpuUsage * 100) / 100);
            }, 100);
        });
    }

    calculateAverageLatency() {
        const recentLatency = this.metrics.application.requests.latency
            .slice(-100); // Consider last 100 requests

        if (recentLatency.length === 0) {
          return 0;
        }

        const sum = recentLatency.reduce((acc, curr) => acc + curr.duration, 0);
        return Math.round(sum / recentLatency.length);
    }

    calculateErrorRate() {
        const {total} = this.metrics.application.requests;
        if (total === 0) {
          return 0;
        }

        return Math.round(
            (this.metrics.application.requests.failed / total) * 100
        );
    }

    detectMemoryLeaks() {
        const {heapUsed, heapTotal} = this.metrics.process.memory;
        const heapUsage = (heapUsed / heapTotal) * 100;

        if (heapUsage > 90) {
            this.metrics.application.memory.leaks.push({
                timestamp: Date.now(),
                heapUsed,
                heapTotal,
                usage: heapUsage
            });

            this.createAlert('POTENTIAL_MEMORY_LEAK', {
                level: 'error',
                message: `High heap usage detected: ${heapUsage}%`,
                value: heapUsage,
                threshold: 90
            });
        }
    }

    createAlert(type, data) {
        const alert = {
            id: utilityService.generateSecureToken(),
            type,
            ...data,
            timestamp: Date.now()
        };

        this.alerts.set(alert.id, alert);
        this.emit('alert', alert);

        logger.warn(`Alert created: ${type} - ${data.message}`);
    }

    getMetrics() {
        return {
            ...this.metrics,
            alerts: Array.from(this.alerts.values())
        };
    }

    getAlerts() {
        return Array.from(this.alerts.values());
    }

    clearAlerts() {
        this.alerts.clear();
    }

    setThreshold(metric, value) {
        if (this.thresholds.hasOwnProperty(metric)) {
            this.thresholds[metric] = value;
            logger.info(`Threshold updated: ${metric} = ${value}`);
        } else {
            throw new Error(`Invalid metric: ${metric}`);
        }
    }
}

module.exports = new MonitoringService(); 