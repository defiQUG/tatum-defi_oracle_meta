const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { logger } = require('../config/logger');

class WebSocketService {
    constructor() {
        this.wss = null;
        this.clients = new Map(); // userId -> WebSocket[]
    }

    initialize(server) {
        this.wss = new WebSocket.Server({ server });

        this.wss.on('connection', async (ws, req) => {
            try {
                // Get token from query string
                const token = new URL(req.url, 'http://localhost')
                    .searchParams.get('token');

                if (!token) {
                    ws.close(4001, 'Authentication required');
                    return;
                }

                // Verify JWT token
                const decoded = await jwt.verify(token, process.env.JWT_SECRET);
                const userId = decoded.id;

                // Store client connection
                if (!this.clients.has(userId)) {
                    this.clients.set(userId, []);
                }
                this.clients.get(userId).push(ws);

                // Set up ping-pong to keep connection alive
                ws.isAlive = true;
                ws.on('pong', () => {
                    ws.isAlive = true;
                });

                // Handle client messages
                ws.on('message', (message) => {
                    this.handleMessage(userId, message, ws);
                });

                // Handle client disconnect
                ws.on('close', () => {
                    this.handleDisconnect(userId, ws);
                });

                // Send initial connection success message
                ws.send(JSON.stringify({
                    type: 'connection',
                    status: 'connected',
                    userId
                }));

                logger.info(`WebSocket client connected: ${userId}`);
            } catch (error) {
                logger.error('WebSocket connection error:', error);
                ws.close(4002, 'Authentication failed');
            }
        });

        // Set up ping interval
        setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    ws.terminate();
                    return;
                }
                ws.isAlive = false;
                ws.ping();
            });
        }, 30000);

        logger.info('WebSocket server initialized');
    }

    handleMessage(userId, message, ws) {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'subscribe':
                    this.handleSubscribe(userId, data, ws);
                    break;
                case 'unsubscribe':
                    this.handleUnsubscribe(userId, data, ws);
                    break;
                default:
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Unknown message type'
                    }));
            }
        } catch (error) {
            logger.error('WebSocket message handling error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
        }
    }

    handleSubscribe(userId, data, ws) {
        // Handle subscription to specific events
        ws.subscriptions = ws.subscriptions || new Set();
        ws.subscriptions.add(data.event);
        
        ws.send(JSON.stringify({
            type: 'subscribed',
            event: data.event
        }));
    }

    handleUnsubscribe(userId, data, ws) {
        // Handle unsubscription from specific events
        if (ws.subscriptions) {
            ws.subscriptions.delete(data.event);
        }
        
        ws.send(JSON.stringify({
            type: 'unsubscribed',
            event: data.event
        }));
    }

    handleDisconnect(userId, ws) {
        // Remove client from stored connections
        const userConnections = this.clients.get(userId);
        if (userConnections) {
            const index = userConnections.indexOf(ws);
            if (index !== -1) {
                userConnections.splice(index, 1);
            }
            if (userConnections.length === 0) {
                this.clients.delete(userId);
            }
        }
        logger.info(`WebSocket client disconnected: ${userId}`);
    }

    // Send update to specific user
    sendToUser(userId, data) {
        const userConnections = this.clients.get(userId);
        if (userConnections) {
            const message = JSON.stringify(data);
            userConnections.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN &&
                    (!data.event || !ws.subscriptions || ws.subscriptions.has(data.event))) {
                    ws.send(message);
                }
            });
        }
    }

    // Send update to all connected clients
    broadcast(data) {
        const message = JSON.stringify(data);
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    // Close all connections
    close() {
        if (this.wss) {
            this.wss.close();
            this.clients.clear();
            logger.info('WebSocket server closed');
        }
    }
}

module.exports = new WebSocketService(); 