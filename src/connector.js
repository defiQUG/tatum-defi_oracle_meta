import { CONFIG } from './config/network.js';
import { makeRPCRequest } from './services/rpc.js';
import { tatumService } from './services/tatum.js';

async function main() {
  console.log('Starting Defi Oracle Meta Connector...\n');

  try {
    // Direct RPC Examples
    console.log('1. Direct RPC Examples:');
    console.log('----------------------');

    // Get latest block number
    const directBlockNumber = await makeRPCRequest(
      CONFIG.RPC_URL,
      'eth_blockNumber'
    );
    console.log('Latest block:', parseInt(directBlockNumber.result, 16));

    // Get gas price
    const directGasPrice = await makeRPCRequest(
      CONFIG.RPC_URL,
      'eth_gasPrice'
    );
    console.log('Gas price:', parseInt(directGasPrice.result, 16));

    // Tatum API Examples
    console.log('\n2. Tatum API Examples:');
    console.log('---------------------');

    // Get latest block number
    const tatumBlockNumber = await tatumService.getBlockNumber();
    console.log('Latest block:', parseInt(tatumBlockNumber.result, 16));

    // Get gas price
    const tatumGasPrice = await tatumService.getGasPrice();
    console.log('Gas price:', parseInt(tatumGasPrice.result, 16));

    // Get a specific block
    const blockNumber = '0x1'; // Block #1
    const block = await tatumService.getBlockByNumber(blockNumber, true);
    console.log('\nBlock #1 details:');
    console.log('- Hash:', block.result.hash);
    console.log('- Timestamp:', parseInt(block.result.timestamp, 16));
    console.log('- Transactions:', block.result.transactions.length);

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

// Check if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
} 