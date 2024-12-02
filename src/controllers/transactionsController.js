const Web3 = require('web3');
const { logger } = require('../config/logger');
const Wallet = require('../models/wallet');
const { TatumSDK } = require('@tatumio/tatum');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');

// Initialize Web3 and Tatum
const web3 = new Web3(process.env.WEB3_PROVIDER_URL);
const tatum = TatumSDK.init({
    network: {
        name: process.env.NETWORK_NAME,
        chainId: parseInt(process.env.CHAIN_ID),
        rpcUrl: process.env.WEB3_PROVIDER_URL
    }
});

// Get transaction history with filters
exports.getTransactionHistory = async (req, res) => {
    try {
        const {
            startDate,
            endDate,
            type,
            status,
            page = 1,
            limit = 10
        } = req.query;

        // Get user's wallets
        const wallets = await Wallet.find({ userId: req.user._id });
        const addresses = wallets.map(wallet => wallet.address);

        // Build filter query
        const query = {
            userId: req.user._id,
            'transactions.timestamp': {}
        };

        if (startDate) {
            query['transactions.timestamp'].$gte = new Date(startDate);
        }
        if (endDate) {
            query['transactions.timestamp'].$lte = new Date(endDate);
        }
        if (status) {
            query['transactions.status'] = status;
        }
        if (type === 'sent') {
            query['transactions.from'] = { $in: addresses };
        } else if (type === 'received') {
            query['transactions.to'] = { $in: addresses };
        }

        // Get transactions with pagination
        const transactions = await Wallet.aggregate([
            { $match: query },
            { $unwind: '$transactions' },
            { $sort: { 'transactions.timestamp': -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit }
        ]);

        // Get total count for pagination
        const total = await Wallet.aggregate([
            { $match: query },
            { $unwind: '$transactions' },
            { $count: 'total' }
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                transactions,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: total[0]?.total || 0
                }
            }
        });
    } catch (error) {
        logger.error('Transaction history error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching transaction history'
        });
    }
};

// Get transaction statistics
exports.getTransactionStats = async (req, res) => {
    try {
        const wallets = await Wallet.find({ userId: req.user._id });
        const addresses = wallets.map(wallet => wallet.address);

        const stats = await Wallet.aggregate([
            { $match: { userId: req.user._id } },
            { $unwind: '$transactions' },
            {
                $group: {
                    _id: null,
                    totalTransactions: { $sum: 1 },
                    totalSent: {
                        $sum: {
                            $cond: [
                                { $in: ['$transactions.from', addresses] },
                                1,
                                0
                            ]
                        }
                    },
                    totalReceived: {
                        $sum: {
                            $cond: [
                                { $in: ['$transactions.to', addresses] },
                                1,
                                0
                            ]
                        }
                    },
                    totalGasUsed: { $sum: { $toDouble: '$transactions.gasUsed' } },
                    avgGasUsed: { $avg: { $toDouble: '$transactions.gasUsed' } }
                }
            }
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                stats: stats[0] || {
                    totalTransactions: 0,
                    totalSent: 0,
                    totalReceived: 0,
                    totalGasUsed: 0,
                    avgGasUsed: 0
                }
            }
        });
    } catch (error) {
        logger.error('Transaction stats error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching transaction statistics'
        });
    }
};

// Get pending transactions
exports.getPendingTransactions = async (req, res) => {
    try {
        const pendingTxs = await Wallet.aggregate([
            { $match: { userId: req.user._id } },
            { $unwind: '$transactions' },
            { $match: { 'transactions.status': 'pending' } },
            { $sort: { 'transactions.timestamp': -1 } }
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                transactions: pendingTxs
            }
        });
    } catch (error) {
        logger.error('Pending transactions error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching pending transactions'
        });
    }
};

// Get transaction details
exports.getTransactionDetails = async (req, res) => {
    try {
        const { hash } = req.params;

        // Get transaction from blockchain
        const transaction = await web3.eth.getTransaction(hash);
        const receipt = await web3.eth.getTransactionReceipt(hash);
        const block = transaction.blockNumber
            ? await web3.eth.getBlock(transaction.blockNumber)
            : null;

        // Format response
        const details = {
            hash: transaction.hash,
            from: transaction.from,
            to: transaction.to,
            value: web3.utils.fromWei(transaction.value, 'ether'),
            gasPrice: web3.utils.fromWei(transaction.gasPrice, 'gwei'),
            gasLimit: transaction.gas,
            gasUsed: receipt?.gasUsed,
            nonce: transaction.nonce,
            blockNumber: transaction.blockNumber,
            timestamp: block?.timestamp ? new Date(block.timestamp * 1000) : null,
            status: receipt?.status ? 'confirmed' : 'failed',
            confirmations: transaction.blockNumber
                ? await web3.eth.getBlockNumber() - transaction.blockNumber
                : 0
        };

        res.status(200).json({
            status: 'success',
            data: {
                transaction: details
            }
        });
    } catch (error) {
        logger.error('Transaction details error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching transaction details'
        });
    }
};

// Export transactions
exports.exportTransactions = async (req, res) => {
    try {
        const { format, startDate, endDate } = req.body;

        // Get transactions
        const transactions = await Wallet.aggregate([
            { $match: { userId: req.user._id } },
            { $unwind: '$transactions' },
            {
                $match: {
                    ...(startDate && {
                        'transactions.timestamp': { $gte: new Date(startDate) }
                    }),
                    ...(endDate && {
                        'transactions.timestamp': { $lte: new Date(endDate) }
                    })
                }
            },
            { $sort: { 'transactions.timestamp': -1 } }
        ]);

        if (format === 'csv') {
            const fields = [
                'hash',
                'from',
                'to',
                'value',
                'gasUsed',
                'status',
                'timestamp'
            ];
            const parser = new Parser({ fields });
            const csv = parser.parse(
                transactions.map(tx => tx.transactions)
            );

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader(
                'Content-Disposition',
                'attachment; filename=transactions.csv'
            );
            return res.send(csv);
        } else {
            // PDF format
            const doc = new PDFDocument();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader(
                'Content-Disposition',
                'attachment; filename=transactions.pdf'
            );
            doc.pipe(res);

            // Add content to PDF
            doc.fontSize(16).text('Transaction History', { align: 'center' });
            doc.moveDown();
            transactions.forEach(tx => {
                doc.fontSize(12).text(`Hash: ${tx.transactions.hash}`);
                doc.fontSize(10)
                    .text(`From: ${tx.transactions.from}`)
                    .text(`To: ${tx.transactions.to}`)
                    .text(`Value: ${tx.transactions.value} ETH`)
                    .text(`Status: ${tx.transactions.status}`)
                    .text(
                        `Date: ${new Date(
                            tx.transactions.timestamp
                        ).toLocaleString()}`
                    );
                doc.moveDown();
            });

            doc.end();
        }
    } catch (error) {
        logger.error('Transaction export error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error exporting transactions'
        });
    }
};

// Get gas price history
exports.getGasHistory = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const gasHistory = await Wallet.aggregate([
            { $match: { userId: req.user._id } },
            { $unwind: '$transactions' },
            {
                $match: {
                    ...(startDate && {
                        'transactions.timestamp': { $gte: new Date(startDate) }
                    }),
                    ...(endDate && {
                        'transactions.timestamp': { $lte: new Date(endDate) }
                    })
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$transactions.timestamp'
                        }
                    },
                    avgGasPrice: { $avg: { $toDouble: '$transactions.gasUsed' } },
                    maxGasPrice: { $max: { $toDouble: '$transactions.gasUsed' } },
                    minGasPrice: { $min: { $toDouble: '$transactions.gasUsed' } }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                gasHistory
            }
        });
    } catch (error) {
        logger.error('Gas history error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching gas history'
        });
    }
};

// Get volume analytics
exports.getVolumeAnalytics = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const volumeData = await Wallet.aggregate([
            { $match: { userId: req.user._id } },
            { $unwind: '$transactions' },
            {
                $match: {
                    ...(startDate && {
                        'transactions.timestamp': { $gte: new Date(startDate) }
                    }),
                    ...(endDate && {
                        'transactions.timestamp': { $lte: new Date(endDate) }
                    })
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$transactions.timestamp'
                        }
                    },
                    totalVolume: {
                        $sum: { $toDouble: '$transactions.value' }
                    },
                    transactionCount: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                volumeData
            }
        });
    } catch (error) {
        logger.error('Volume analytics error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching volume analytics'
        });
    }
};

// Get transaction patterns
exports.getTransactionPatterns = async (req, res) => {
    try {
        const wallets = await Wallet.find({ userId: req.user._id });
        const addresses = wallets.map(wallet => wallet.address);

        const patterns = await Wallet.aggregate([
            { $match: { userId: req.user._id } },
            { $unwind: '$transactions' },
            {
                $group: {
                    _id: {
                        hour: { $hour: '$transactions.timestamp' },
                        dayOfWeek: { $dayOfWeek: '$transactions.timestamp' }
                    },
                    count: { $sum: 1 },
                    avgValue: {
                        $avg: { $toDouble: '$transactions.value' }
                    },
                    sentCount: {
                        $sum: {
                            $cond: [
                                { $in: ['$transactions.from', addresses] },
                                1,
                                0
                            ]
                        }
                    },
                    receivedCount: {
                        $sum: {
                            $cond: [
                                { $in: ['$transactions.to', addresses] },
                                1,
                                0
                            ]
                        }
                    }
                }
            },
            { $sort: { count: -1 } }
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                patterns
            }
        });
    } catch (error) {
        logger.error('Transaction patterns error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error analyzing transaction patterns'
        });
    }
};

// Helper function to update transaction status
exports.updateTransactionStatus = async (hash) => {
    try {
        const receipt = await web3.eth.getTransactionReceipt(hash);
        if (receipt) {
            await Wallet.updateOne(
                { 'transactions.hash': hash },
                {
                    $set: {
                        'transactions.$.status': receipt.status
                            ? 'confirmed'
                            : 'failed',
                        'transactions.$.gasUsed': receipt.gasUsed
                    }
                }
            );
        }
    } catch (error) {
        logger.error('Transaction status update error:', error);
    }
}; 