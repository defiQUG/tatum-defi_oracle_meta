import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { TatumSDK } from '@tatumio/tatum';
import Web3 from 'web3';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Custom network configuration
const customNetwork = {
  name: 'Defi Oracle Meta Mainnet',
  chainId: 138,
  rpcUrl: 'http://102.133.148.122:8545',
};

// Initialize Web3
const web3 = new Web3(customNetwork.rpcUrl);

// Helper function to get ETH price
async function getEthPrice() {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    const data = await response.json();
    return data.ethereum.usd;
  } catch (error) {
    console.error('Error fetching ETH price:', error);
    return null;
  }
}

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to get address details
app.get('/api/address/:address', async (req, res) => {
  try {
    let { address } = req.params;
    
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

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
}); 