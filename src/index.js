import express from 'express';
import csrf from 'csurf';
import path from 'path';
import { fileURLToPath } from 'url';
import { TatumSDK } from '@tatumio/tatum';
import Web3 from 'web3';
import fetch from 'node-fetch';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { csrfSynchronisedProtection } from 'express-csrf-double-submit-cookie';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(csrf());
const port = process.env.PORT || 3000;

// Security middleware
app.use(cookieParser());
app.use(helmet());
app.use(csrfSynchronisedProtection({
  cookieName: 'csrfToken',
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/', limiter);

// Custom network configuration
const customNetwork = {
  name: 'Defi Oracle Meta Mainnet',
  chainId: 138,
  rpcUrl: 'http://102.133.148.122:8545',
};

// Initialize Web3
const web3 = new Web3(customNetwork.rpcUrl);

// Cache for ETH price (5 minutes)
let ethPriceCache = {
  price: null,
  timestamp: 0
};

// Helper function to get ETH price with caching
async function getEthPrice() {
  const now = Date.now();
  if (ethPriceCache.price && now - ethPriceCache.timestamp < 5 * 60 * 1000) {
    return ethPriceCache.price;
  }

  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    const data = await response.json();
    ethPriceCache = {
      price: data.ethereum.usd,
      timestamp: now
    };
    return ethPriceCache.price;
  } catch (error) {
    console.error('Error fetching ETH price:', error);
    return ethPriceCache.price || null;
  }
}

// Validate Ethereum address
function isValidAddress(address) {
  return web3.utils.isAddress(address) || (address.startsWith('XE') && address.length >= 32 && address.length <= 33);
}

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to get address details
app.get('/api/address/:address', async (req, res) => {
  try {
    let { address } = req.params;

    // Validate address format
    if (!isValidAddress(address)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid address format'
      });
    }
    
    // Convert IBAN to address if needed
    if (address.startsWith('XE')) {
      address = web3.eth.Iban.toAddress(address);
    }

    // Create IBAN from address
    const iban = web3.eth.Iban.fromAddress(address);

    // Initialize Tatum SDK
    const tatum = await TatumSDK.init({
      network: customNetwork,
    });

    // Get ETH price
    const ethPrice = await getEthPrice();

    // Get address balance
    const balance = await tatum.rpc.getBalance(address);
    const balanceInEth = web3.utils.fromWei(balance, 'ether');
    const balanceInUsd = ethPrice ? (parseFloat(balanceInEth) * ethPrice) : null;
    
    // Get transaction count
    const txCount = await tatum.rpc.getTransactionCount(address);

    // Get gas price
    const gasPrice = await tatum.rpc.getGasPrice();
    const gasPriceGwei = web3.utils.fromWei(gasPrice, 'gwei');

    // Get latest block for timestamp
    const latestBlock = await tatum.rpc.getBlockByNumber('latest', false);
    
    // Clean up
    await tatum.destroy();

    // Cache control headers
    res.set('Cache-Control', 'public, max-age=30'); // Cache for 30 seconds

    res.json({
      success: true,
      data: {
        address,
        iban: iban.toString(),
        balance: {
          wei: balance,
          eth: balanceInEth,
          usd: balanceInUsd
        },
        transactions: {
          count: txCount,
          lastBlockTimestamp: parseInt(latestBlock.timestamp, 16)
        },
        network: {
          ...customNetwork,
          gasPrice: {
            wei: gasPrice,
            gwei: gasPriceGwei
          }
        }
      }
    });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
}); 