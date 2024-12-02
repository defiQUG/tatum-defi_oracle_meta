const { logger } = require('../config/logger');
const webSocketService = require('./websocket');

class NotificationService {
    constructor() {
        this.notificationTypes = {
            TRANSACTION: 'transaction',
            SECURITY: 'security',
            ACCOUNT: 'account',
            SYSTEM: 'system',
            PRICE: 'price'
        };

        this.priorityLevels = {
            LOW: 'low',
            MEDIUM: 'medium',
            HIGH: 'high',
            CRITICAL: 'critical'
        };
    }

    async sendNotification(userId, notification) {
        try {
            const formattedNotification = this.formatNotification(notification);
            
            // Send via WebSocket if user is connected
            webSocketService.sendToUser(userId, {
                type: 'notification',
                data: formattedNotification
            });

            // Store notification in database
            await this.storeNotification(userId, formattedNotification);

            // Handle critical notifications
            if (notification.priority === this.priorityLevels.CRITICAL) {
                await this.handleCriticalNotification(userId, formattedNotification);
            }

            logger.info('Notification sent:', {
                userId,
                type: notification.type,
                priority: notification.priority
            });
        } catch (error) {
            logger.error('Error sending notification:', error);
        }
    }

    formatNotification(notification) {
        return {
            id: this.generateNotificationId(),
            timestamp: new Date(),
            type: notification.type,
            priority: notification.priority || this.priorityLevels.LOW,
            title: notification.title,
            message: notification.message,
            data: notification.data || {},
            read: false,
            actions: notification.actions || []
        };
    }

    async storeNotification(userId, notification) {
        try {
            // Store in MongoDB (implement notification model)
            // await Notification.create({
            //     userId,
            //     ...notification
            // });
        } catch (error) {
            logger.error('Error storing notification:', error);
        }
    }

    async handleCriticalNotification(userId, notification) {
        // Implement critical notification handling
        // - Send email
        // - Send SMS
        // - Create incident ticket
        logger.warn('Critical notification:', {
            userId,
            notification
        });
    }

    // Transaction notifications
    async notifyTransactionCreated(userId, transaction) {
        await this.sendNotification(userId, {
            type: this.notificationTypes.TRANSACTION,
            priority: this.priorityLevels.MEDIUM,
            title: 'Transaction Created',
            message: `Transaction ${transaction.hash} has been created`,
            data: {
                transactionHash: transaction.hash,
                amount: transaction.value,
                to: transaction.to
            },
            actions: [
                {
                    name: 'view',
                    label: 'View Transaction',
                    url: `/transactions/${transaction.hash}`
                }
            ]
        });
    }

    async notifyTransactionConfirmed(userId, transaction) {
        await this.sendNotification(userId, {
            type: this.notificationTypes.TRANSACTION,
            priority: this.priorityLevels.MEDIUM,
            title: 'Transaction Confirmed',
            message: `Transaction ${transaction.hash} has been confirmed`,
            data: {
                transactionHash: transaction.hash,
                blockNumber: transaction.blockNumber,
                confirmations: transaction.confirmations
            }
        });
    }

    async notifyTransactionFailed(userId, transaction, error) {
        await this.sendNotification(userId, {
            type: this.notificationTypes.TRANSACTION,
            priority: this.priorityLevels.HIGH,
            title: 'Transaction Failed',
            message: `Transaction ${transaction.hash} has failed: ${error}`,
            data: {
                transactionHash: transaction.hash,
                error: error
            }
        });
    }

    // Security notifications
    async notifySecurityAlert(userId, alert) {
        await this.sendNotification(userId, {
            type: this.notificationTypes.SECURITY,
            priority: this.priorityLevels.HIGH,
            title: 'Security Alert',
            message: alert.message,
            data: alert.data
        });
    }

    async notifyLoginAttempt(userId, attempt) {
        await this.sendNotification(userId, {
            type: this.notificationTypes.SECURITY,
            priority: this.priorityLevels.MEDIUM,
            title: 'New Login Attempt',
            message: `Login attempt from ${attempt.ip} - ${attempt.location}`,
            data: {
                ip: attempt.ip,
                location: attempt.location,
                device: attempt.device,
                success: attempt.success
            }
        });
    }

    // Price notifications
    async notifyPriceAlert(userId, alert) {
        await this.sendNotification(userId, {
            type: this.notificationTypes.PRICE,
            priority: this.priorityLevels.MEDIUM,
            title: 'Price Alert',
            message: `${alert.symbol} has ${alert.direction} ${alert.threshold}`,
            data: {
                symbol: alert.symbol,
                price: alert.price,
                threshold: alert.threshold,
                direction: alert.direction
            }
        });
    }

    // System notifications
    async notifySystemUpdate(userId, update) {
        await this.sendNotification(userId, {
            type: this.notificationTypes.SYSTEM,
            priority: this.priorityLevels.LOW,
            title: 'System Update',
            message: update.message,
            data: update.data
        });
    }

    async notifyMaintenanceScheduled(userId, maintenance) {
        await this.sendNotification(userId, {
            type: this.notificationTypes.SYSTEM,
            priority: this.priorityLevels.MEDIUM,
            title: 'Scheduled Maintenance',
            message: `System maintenance scheduled for ${maintenance.scheduledTime}`,
            data: {
                scheduledTime: maintenance.scheduledTime,
                duration: maintenance.duration,
                impact: maintenance.impact
            }
        });
    }

    // Helper methods
    generateNotificationId() {
        return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Bulk notifications
    async sendBulkNotifications(notifications) {
        try {
            const promises = notifications.map(({ userId, notification }) =>
                this.sendNotification(userId, notification)
            );
            await Promise.all(promises);
        } catch (error) {
            logger.error('Error sending bulk notifications:', error);
        }
    }
}

module.exports = new NotificationService(); 