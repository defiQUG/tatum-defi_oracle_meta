const Web3 = require('web3');
const { logger } = require('../config/logger');
const Wallet = require('../models/wallet');
const { updateTransactionStatus } = require('../controllers/transactionsController');

class TransactionMonitor {
    constructor() {
        this.web3 = new Web3(process.env.WEB3_PROVIDER_URL);
        this.subscription = null;
        this.pendingTxs = new Map();
        this.confirmationBlocks = 12; // Number of blocks for confirmation
    }

    async start() {
        try {
            // Subscribe to new blocks
            this.subscription = this.web3.eth.subscribe('newBlockHeaders');

            this.subscription.on('data', async (blockHeader) => {
                await this.processBlock(blockHeader.number);
            });

            this.subscription.on('error', (error) => {
                logger.error('Block subscription error:', error);
                this.restart();
            });

            // Subscribe to pending transactions
            const pendingSub = this.web3.eth.subscribe('pendingTransactions');
            
            pendingSub.on('data', async (txHash) => {
                await this.processPendingTransaction(txHash);
            });

            logger.info('Transaction monitor started');
        } catch (error) {
            logger.error('Error starting transaction monitor:', error);
            this.restart();
        }
    }

    async processBlock(blockNumber) {
        try {
            const block = await this.web3.eth.getBlock(blockNumber, true);
            if (!block) {
              return;
            }

            // Process transactions in the block
            for (const tx of block.transactions) {
                await this.processTransaction(tx, block);
            }

            // Update pending transactions
            for (const [txHash, data] of this.pendingTxs) {
                if (blockNumber - data.startBlock > 50) { // Transaction might be dropped
                    await this.handleDroppedTransaction(txHash);
                }
            }
        } catch (error) {
            logger.error('Error processing block:', error);
        }
    }

    async processTransaction(tx, block) {
        try {
            // Check if transaction is related to our users
            const wallet = await Wallet.findOne({
                $or: [
                    { address: tx.from.toLowerCase() },
                    { address: tx.to?.toLowerCase() }
                ]
            });

            if (wallet) {
                const receipt = await this.web3.eth.getTransactionReceipt(tx.hash);
                
                // Update transaction status
                await wallet.updateOne({
                    $push: {
                        transactions: {
                            hash: tx.hash,
                            from: tx.from,
                            to: tx.to,
                            value: tx.value,
                            gasUsed: receipt?.gasUsed || tx.gas,
                            gasPrice: tx.gasPrice,
                            blockNumber: block.number,
                            timestamp: new Date(block.timestamp * 1000),
                            status: receipt ? (receipt.status ? 'confirmed' : 'failed') : 'pending'
                        }
                    }
                });

                // Remove from pending if exists
                this.pendingTxs.delete(tx.hash);

                // Emit event for real-time updates (implement WebSocket service)
                // this.emitTransactionUpdate(wallet.userId, tx.hash, 'confirmed');
            }
        } catch (error) {
            logger.error('Error processing transaction:', error);
        }
    }

    async processPendingTransaction(txHash) {
        try {
            const tx = await this.web3.eth.getTransaction(txHash);
            if (!tx) {
              return;
            }

            const wallet = await Wallet.findOne({
                $or: [
                    { address: tx.from.toLowerCase() },
                    { address: tx.to?.toLowerCase() }
                ]
            });

            if (wallet) {
                this.pendingTxs.set(txHash, {
                    startBlock: await this.web3.eth.getBlockNumber(),
                    transaction: tx
                });

                // Add pending transaction to wallet
                await wallet.updateOne({
                    $push: {
                        transactions: {
                            hash: tx.hash,
                            from: tx.from,
                            to: tx.to,
                            value: tx.value,
                            gasPrice: tx.gasPrice,
                            status: 'pending',
                            timestamp: new Date()
                        }
                    }
                });

                // Emit event for real-time updates
                // this.emitTransactionUpdate(wallet.userId, txHash, 'pending');
            }
        } catch (error) {
            logger.error('Error processing pending transaction:', error);
        }
    }

    async handleDroppedTransaction(txHash) {
        try {
            const wallet = await Wallet.findOne({
                'transactions.hash': txHash
            });

            if (wallet) {
                await wallet.updateOne({
                    $set: {
                        'transactions.$.status': 'failed',
                        'transactions.$.error': 'Transaction dropped from mempool'
                    }
                });

                // Emit event for real-time updates
                // this.emitTransactionUpdate(wallet.userId, txHash, 'dropped');
            }

            this.pendingTxs.delete(txHash);
        } catch (error) {
            logger.error('Error handling dropped transaction:', error);
        }
    }

    async restart() {
        if (this.subscription) {
            await this.subscription.unsubscribe();
        }
        setTimeout(() => this.start(), 5000); // Restart after 5 seconds
    }

    async stop() {
        if (this.subscription) {
            await this.subscription.unsubscribe();
        }
        this.pendingTxs.clear();
        logger.info('Transaction monitor stopped');
    }
}

module.exports = new TransactionMonitor(); 