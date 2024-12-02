const mongoose = require('mongoose');
const { logger } = require('./logger');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            // MongoDB connection options
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            family: 4, // Use IPv4
            maxPoolSize: 50,
            minPoolSize: 10,
            maxIdleTimeMS: 10000,
            compressors: 'zlib'
        });

        // Set up mongoose options
        mongoose.set('strictQuery', true);
        mongoose.set('debug', process.env.NODE_ENV === 'development');

        // Connection event handlers
        mongoose.connection.on('connected', () => {
            logger.info(`MongoDB connected: ${conn.connection.host}`);
        });

        mongoose.connection.on('error', (err) => {
            logger.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('MongoDB disconnected');
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            try {
                await mongoose.connection.close();
                logger.info('MongoDB connection closed through app termination');
                process.exit(0);
            } catch (err) {
                logger.error('Error during MongoDB connection closure:', err);
                process.exit(1);
            }
        });

        return conn;
    } catch (error) {
        logger.error('Error connecting to MongoDB:', error);
        process.exit(1);
    }
};

module.exports = connectDB; 