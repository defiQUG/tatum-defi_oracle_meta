const Web3 = require('web3');
const { logger } = require('../config/logger');
const Wallet = require('../models/wallet');
const { TatumSDK } = require('@tatumio/tatum');
const { ethers } = require('ethers');

// Initialize Web3 and Tatum
const web3 = new Web3(process.env.WEB3_PROVIDER_URL);
const tatum = TatumSDK.init({
    network: {
        name: process.env.NETWORK_NAME,
        chainId: parseInt(process.env.CHAIN_ID),
        rpcUrl: process.env.WEB3_PROVIDER_URL
    }
});

// Cache for token prices (5 minutes)
const tokenPriceCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Helper function to get token price with caching
async function getTokenPrice(symbol) {
    const now = Date.now();
    const cached = tokenPriceCache.get(symbol);
    
    if (cached && now - cached.timestamp < CACHE_DURATION) {
        return cached.price;
    }

    try {
        const response = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd`
        );
        const data = await response.json();
        const price = data[symbol]?.usd;
        
        tokenPriceCache.set(symbol, {
            price,
            timestamp: now
        });
        
        return price;
    } catch (error) {
        logger.error('Error fetching token price:', error);
        return cached?.price || null;
    }
}

// Create new wallet
exports.createWallet = async (req, res) => {
    try {
        const { name, type } = req.body;
        
        // Generate new wallet
        const wallet = web3.eth.accounts.create();
        
        // Save wallet details
        const newWallet = await Wallet.create({
            name,
            type,
            address: wallet.address,
            userId: req.user._id,
            encryptedPrivateKey: await encryptPrivateKey(wallet.privateKey, req.user._id)
        });

        res.status(201).json({
            status: 'success',
            data: {
                wallet: {
                    address: newWallet.address,
                    name: newWallet.name,
                    type: newWallet.type
                }
            }
        });
    } catch (error) {
        logger.error('Wallet creation error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error creating wallet'
        });
    }
};

// Import existing wallet
exports.importWallet = async (req, res) => {
    try {
        const { privateKey, name } = req.body;
        
        // Validate private key
        const wallet = web3.eth.accounts.privateKeyToAccount(privateKey);
        
        // Check if wallet already exists
        const existingWallet = await Wallet.findOne({
            address: wallet.address,
            userId: req.user._id
        });
        
        if (existingWallet) {
            return res.status(400).json({
                status: 'error',
                message: 'Wallet already imported'
            });
        }

        // Save wallet details
        const newWallet = await Wallet.create({
            name,
            type: 'ethereum',
            address: wallet.address,
            userId: req.user._id,
            encryptedPrivateKey: await encryptPrivateKey(privateKey, req.user._id)
        });

        res.status(201).json({
            status: 'success',
            data: {
                wallet: {
                    address: newWallet.address,
                    name: newWallet.name,
                    type: newWallet.type
                }
            }
        });
    } catch (error) {
        logger.error('Wallet import error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error importing wallet'
        });
    }
};

// Get wallet balance
exports.getBalance = async (req, res) => {
    try {
        const { address } = req.params;
        
        // Validate address
        if (!web3.utils.isAddress(address)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid address'
            });
        }

        // Get ETH balance
        const balance = await web3.eth.getBalance(address);
        const ethBalance = web3.utils.fromWei(balance, 'ether');
        
        // Get ETH price
        const ethPrice = await getTokenPrice('ethereum');
        const usdBalance = ethPrice ? (parseFloat(ethBalance) * ethPrice) : null;

        res.status(200).json({
            status: 'success',
            data: {
                balance: {
                    wei: balance,
                    eth: ethBalance,
                    usd: usdBalance
                }
            }
        });
    } catch (error) {
        logger.error('Balance fetch error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching balance'
        });
    }
};

// Send transaction
exports.sendTransaction = async (req, res) => {
    try {
        const { to, amount, gasPrice, gasLimit } = req.body;
        
        // Get user's wallet
        const wallet = await Wallet.findOne({
            userId: req.user._id,
            isDefault: true
        });
        
        if (!wallet) {
            return res.status(404).json({
                status: 'error',
                message: 'No default wallet found'
            });
        }

        // Decrypt private key
        const privateKey = await decryptPrivateKey(wallet.encryptedPrivateKey, req.user._id);
        
        // Create transaction
        const tx = {
            from: wallet.address,
            to,
            value: web3.utils.toWei(String(amount), 'ether'),
            gasPrice: gasPrice || await web3.eth.getGasPrice(),
            gasLimit: gasLimit || '21000'
        };

        // Sign and send transaction
        const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

        res.status(200).json({
            status: 'success',
            data: {
                transaction: {
                    hash: receipt.transactionHash,
                    blockNumber: receipt.blockNumber,
                    gasUsed: receipt.gasUsed
                }
            }
        });
    } catch (error) {
        logger.error('Transaction error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error sending transaction'
        });
    }
};

// Get transaction history
exports.getTransactions = async (req, res) => {
    try {
        const { address } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;

        const transactions = await tatum.rpc.getTransactionsByAddress(address, {
            page,
            pageSize: limit
        });

        res.status(200).json({
            status: 'success',
            data: {
                transactions: transactions.map(tx => ({
                    hash: tx.hash,
                    from: tx.from,
                    to: tx.to,
                    value: web3.utils.fromWei(tx.value, 'ether'),
                    timestamp: tx.timestamp,
                    status: tx.status
                })),
                pagination: {
                    page,
                    limit,
                    total: transactions.total
                }
            }
        });
    } catch (error) {
        logger.error('Transaction history error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching transactions'
        });
    }
};

// Get current gas price
exports.getGasPrice = async (req, res) => {
    try {
        const gasPrice = await web3.eth.getGasPrice();
        const gasPriceGwei = web3.utils.fromWei(gasPrice, 'gwei');

        res.status(200).json({
            status: 'success',
            data: {
                gasPrice: {
                    wei: gasPrice,
                    gwei: gasPriceGwei
                }
            }
        });
    } catch (error) {
        logger.error('Gas price error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching gas price'
        });
    }
};

// Sign message
exports.signMessage = async (req, res) => {
    try {
        const { message } = req.body;
        
        // Get user's wallet
        const wallet = await Wallet.findOne({
            userId: req.user._id,
            isDefault: true
        });
        
        if (!wallet) {
            return res.status(404).json({
                status: 'error',
                message: 'No default wallet found'
            });
        }

        // Decrypt private key
        const privateKey = await decryptPrivateKey(wallet.encryptedPrivateKey, req.user._id);
        
        // Sign message
        const signature = web3.eth.accounts.sign(message, privateKey);

        res.status(200).json({
            status: 'success',
            data: {
                signature: signature.signature,
                messageHash: signature.messageHash
            }
        });
    } catch (error) {
        logger.error('Message signing error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error signing message'
        });
    }
};

// Get network status
exports.getNetworkStatus = async (req, res) => {
    try {
        const [blockNumber, networkId, isListening, peerCount] = await Promise.all([
            web3.eth.getBlockNumber(),
            web3.eth.net.getId(),
            web3.eth.net.isListening(),
            web3.eth.net.getPeerCount()
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                network: {
                    blockNumber,
                    networkId,
                    isListening,
                    peerCount
                }
            }
        });
    } catch (error) {
        logger.error('Network status error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching network status'
        });
    }
};

// Get tokens for address
exports.getTokens = async (req, res) => {
    try {
        const { address } = req.params;
        
        const tokens = await tatum.rpc.getTokenBalances(address);

        const tokenDetails = await Promise.all(
            tokens.map(async token => ({
                address: token.contractAddress,
                symbol: token.symbol,
                balance: token.balance,
                decimals: token.decimals,
                price: await getTokenPrice(token.symbol.toLowerCase())
            }))
        );

        res.status(200).json({
            status: 'success',
            data: {
                tokens: tokenDetails
            }
        });
    } catch (error) {
        logger.error('Token fetch error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching tokens'
        });
    }
};

// Add custom token
exports.addCustomToken = async (req, res) => {
    try {
        const { address: tokenAddress, symbol, decimals } = req.body;
        
        // Validate token contract
        const tokenContract = new web3.eth.Contract(
            require('../contracts/ERC20.json').abi,
            tokenAddress
        );

        // Verify token details
        const [tokenSymbol, tokenDecimals] = await Promise.all([
            tokenContract.methods.symbol().call(),
            tokenContract.methods.decimals().call()
        ]);

        if (tokenSymbol !== symbol || parseInt(tokenDecimals) !== decimals) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid token details'
            });
        }

        // Save custom token
        await Wallet.findOneAndUpdate(
            { userId: req.user._id, isDefault: true },
            {
                $addToSet: {
                    customTokens: {
                        address: tokenAddress,
                        symbol,
                        decimals
                    }
                }
            }
        );

        res.status(200).json({
            status: 'success',
            message: 'Custom token added successfully'
        });
    } catch (error) {
        logger.error('Custom token error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error adding custom token'
        });
    }
};

// Helper functions for private key encryption/decryption
async function encryptPrivateKey(privateKey, userId) {
    // Implement secure encryption logic
    // This is a placeholder - use proper encryption in production
    return privateKey;
}

async function decryptPrivateKey(encryptedPrivateKey, userId) {
    // Implement secure decryption logic
    // This is a placeholder - use proper decryption in production
    return encryptedPrivateKey;
} 