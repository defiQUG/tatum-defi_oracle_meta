const { validationResult } = require('express-validator');
const { logger } = require('../config/logger');

/**
 * Middleware to validate request data using express-validator
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn('Validation error:', {
            path: req.path,
            errors: errors.array()
        });
        
        return res.status(400).json({
            status: 'error',
            message: 'Validation failed',
            errors: errors.array().map(err => ({
                field: err.param,
                message: err.msg
            }))
        });
    }
    next();
};

module.exports = validate; 