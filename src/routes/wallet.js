const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const walletController = require('../controllers/walletController');
const authController = require('../controllers/authController');
const validate = require('../middleware/validate');

// Apply authentication to all wallet routes
router.use(authController.protect);

// Validation middleware
const createWalletValidation = [
    body('name').trim().notEmpty().withMessage('Wallet name is required'),
    body('type').isIn(['ethereum', 'bitcoin', 'custom']).withMessage('Invalid wallet type')
];

const importWalletValidation = [
    body('privateKey')
        .isString()
        .matches(/^0x[0-9a-fA-F]{64}$/)
        .withMessage('Invalid private key format'),
    body('name').trim().notEmpty().withMessage('Wallet name is required')
];

const sendTransactionValidation = [
    body('to')
        .isString()
        .matches(/^0x[0-9a-fA-F]{40}$/)
        .withMessage('Invalid recipient address'),
    body('amount')
        .isNumeric()
        .withMessage('Amount must be a number')
        .custom(value => value > 0)
        .withMessage('Amount must be greater than 0'),
    body('gasPrice')
        .optional()
        .isNumeric()
        .withMessage('Gas price must be a number'),
    body('gasLimit')
        .optional()
        .isNumeric()
        .withMessage('Gas limit must be a number')
];

// Routes
router.post(
    '/create',
    createWalletValidation,
    validate,
    walletController.createWallet
);

router.post(
    '/import',
    importWalletValidation,
    validate,
    walletController.importWallet
);

router.get(
    '/balance/:address',
    walletController.getBalance
);

router.post(
    '/send',
    sendTransactionValidation,
    validate,
    walletController.sendTransaction
);

router.get(
    '/transactions/:address',
    walletController.getTransactions
);

router.get(
    '/gas-price',
    walletController.getGasPrice
);

router.post(
    '/sign-message',
    [
        body('message').notEmpty().withMessage('Message is required')
    ],
    validate,
    walletController.signMessage
);

router.get(
    '/network-status',
    walletController.getNetworkStatus
);

router.get(
    '/tokens/:address',
    walletController.getTokens
);

router.post(
    '/add-custom-token',
    [
        body('address')
            .matches(/^0x[0-9a-fA-F]{40}$/)
            .withMessage('Invalid token contract address'),
        body('symbol').notEmpty().withMessage('Token symbol is required'),
        body('decimals').isInt().withMessage('Token decimals must be an integer')
    ],
    validate,
    walletController.addCustomToken
);

module.exports = router; 