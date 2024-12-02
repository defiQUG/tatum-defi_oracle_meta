import { config } from 'dotenv';

// Load environment variables
config();

// Validate required environment variables
if (!process.env.TATUM_API_KEY) {
  throw new Error('TATUM_API_KEY environment variable is not set. Please check your .env file.');
}

export const CONFIG = {
  NETWORK_NAME: 'Defi Oracle Meta Mainnet',
  CHAIN_ID: 138,
  CURRENCY: 'ETH',
  RPC_URL: 'http://102.133.148.122:8545',
  WSS_URL: 'ws://102.133.148.122:8546',
  BLOCKSCOUT_URL: 'http://102.133.148.122:26000',
  QUORUM_URL: 'http://102.133.148.122:25000',
  TATUM_API_KEY: process.env.TATUM_API_KEY
}; 