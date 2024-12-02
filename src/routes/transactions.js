const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const transactionsController = require('../controllers/transactionsController');
const authController = require('../controllers/authController');
const validate = require('../middleware/validate');

// Apply authentication to all transaction routes
router.use(authController.protect);

// Validation middleware
const filterValidation = [
    query('startDate').optional().isISO8601().withMessage('Invalid start date'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date'),
    query('type').optional().isIn(['sent', 'received', 'all']).withMessage('Invalid transaction type'),
    query('status').optional().isIn(['pending', 'confirmed', 'failed']).withMessage('Invalid status'),
    query('page').optional().isInt({ min: 1 }).withMessage('Invalid page number'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit')
];

// Routes
router.get(
    '/history',
    filterValidation,
    validate,
    transactionsController.getTransactionHistory
);

router.get(
    '/stats',
    transactionsController.getTransactionStats
);

router.get(
    '/pending',
    transactionsController.getPendingTransactions
);

router.get(
    '/:hash',
    transactionsController.getTransactionDetails
);

router.post(
    '/export',
    [
        body('format').isIn(['csv', 'pdf']).withMessage('Invalid export format'),
        body('startDate').optional().isISO8601().withMessage('Invalid start date'),
        body('endDate').optional().isISO8601().withMessage('Invalid end date')
    ],
    validate,
    transactionsController.exportTransactions
);

router.get(
    '/gas/history',
    filterValidation,
    validate,
    transactionsController.getGasHistory
);

router.get(
    '/analytics/volume',
    filterValidation,
    validate,
    transactionsController.getVolumeAnalytics
);

router.get(
    '/analytics/patterns',
    transactionsController.getTransactionPatterns
);

module.exports = router; 