# Defi Oracle Meta Blockchain Connector

This repository contains the connector for interacting with the Defi Oracle Meta Mainnet blockchain network. It provides both direct RPC connectivity and Tatum API integration.

## Network Details

- **Network Name:** Defi Oracle Meta Mainnet
- **Chain ID:** 138
- **Currency:** ETH
- **RPC URLs:**
  - HTTP: http://102.133.148.122:8545
  - WSS: ws://102.133.148.122:8546
- **Explorers:**
  - Blockscout: http://102.133.148.122:26000
  - Quorum: http://102.133.148.122:25000

## Features

- Direct RPC connection to Defi Oracle Meta Mainnet
- Tatum API integration for enhanced blockchain interaction
- Web interface for checking Ethereum addresses
- Support for both HTTP and HTTPS connections
- Automatic protocol selection based on URL
- Proper error handling and logging
- Development mode with auto-reload

## Prerequisites

1. Install pnpm (if not already installed):

```bash
npm install -g pnpm
```

2. Node.js version >= 18
3. pnpm version >= 8.15.1

## Project Structure

```
.
├── src/
│   ├── config/
│   │   └── network.js     # Network configuration
│   ├── public/
│   │   └── index.html     # Web interface
│   ├── services/
│   │   ├── rpc.js         # RPC service
│   │   └── tatum.js       # Tatum API service
│   └── index.js           # Main application file
├── .env                   # Environment variables
├── .gitignore
├── package.json
├── pnpm-lock.yaml
└── README.md
```

## Setup

1. Clone the repository:

```bash
git clone https://github.com/Defi-Oracle-Meta-Blockchain/tatum-defi_oracle_meta.git
cd tatum-defi_oracle_meta
```

2. Install dependencies:

```bash
pnpm install
```

3. Create a `.env` file with your Tatum API key:

```bash
TATUM_API_KEY=your-tatum-api-key
```

## Usage

### Start the server:

```bash
pnpm start
```

### Development mode (with auto-reload):

```bash
pnpm dev
```

### Web Interface

The web interface is available at `http://localhost:3000` and provides:
- Address balance checking
- Transaction count
- Network information

### API Endpoints

#### Get Address Details
```
GET /api/address/:address
```

Example response:

```json
{
  "success": true,
  "data": {
    "address": "0x...",
    "balance": "1000000000000000000",
    "txCount": 10,
    "network": {
      "name": "Defi Oracle Meta Mainnet",
      "chainId": 138,
      "rpcUrl": "http://102.133.148.122:8545"
    }
  }
}
```

### JavaScript SDK Usage

```javascript
import { tatumService } from './services/tatum.js';

// Get balance
const balance = await tatumService.getBalance('0x...');

// Get transaction count
const txCount = await tatumService.getTransactionCount('0x...');

// Get block details
const block = await tatumService.getBlockByNumber('0x1', true);
```

## License

MIT
