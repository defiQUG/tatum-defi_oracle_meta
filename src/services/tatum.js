import { makeRPCRequest } from './rpc.js';
import { CONFIG } from '../config/network.js';

const TATUM_BASE_URL = 'https://api.tatum.io';
const TATUM_API_VERSION = 'v3';
const TATUM_BLOCKCHAIN = 'ethereum';

class TatumService {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('Tatum API key is not configured');
    }
    this.apiKey = apiKey;
    this.headers = {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Make a POST request to the Tatum RPC endpoint
   * @param {string} method - The RPC method
   * @param {Array} params - The RPC parameters
   * @returns {Promise<any>} - The RPC response
   */
  async post(method, params = []) {
    try {
      console.log(`Making Tatum POST request for method: ${method}`);
      const response = await makeRPCRequest(
        `${TATUM_BASE_URL}/${TATUM_API_VERSION}/blockchain/node/${TATUM_BLOCKCHAIN}`,
        method,
        params,
        this.headers
      );

      if (response.error) {
        throw new Error(`Tatum API returned error: ${JSON.stringify(response.error)}`);
      }

      return response;
    } catch (error) {
      this._handleError(error);
    }
  }

  /**
   * Make a GET request to the Tatum RPC endpoint
   * @param {string} method - The RPC method
   * @param {Array} params - The RPC parameters
   * @returns {Promise<any>} - The RPC response
   */
  async get(method, params = []) {
    try {
      console.log(`Making Tatum GET request for method: ${method}`);
      // Convert params to query string
      const queryParams = params.map((param, index) => `params[${index}]=${param}`).join('&');
      const url = `${TATUM_BASE_URL}/${TATUM_API_VERSION}/blockchain/node/${TATUM_BLOCKCHAIN}/${method}${queryParams ? '?' + queryParams : ''}`;
      
      const response = await makeRPCRequest(
        url,
        method,
        [],
        this.headers,
        'GET'
      );

      if (response.error) {
        throw new Error(`Tatum API returned error: ${JSON.stringify(response.error)}`);
      }

      return response;
    } catch (error) {
      this._handleError(error);
    }
  }

  /**
   * Make a PUT request to the Tatum RPC endpoint
   * @param {string} method - The RPC method
   * @param {Array} params - The RPC parameters
   * @returns {Promise<any>} - The RPC response
   */
  async put(method, params = []) {
    try {
      console.log(`Making Tatum PUT request for method: ${method}`);
      const response = await makeRPCRequest(
        `${TATUM_BASE_URL}/${TATUM_API_VERSION}/blockchain/node/${TATUM_BLOCKCHAIN}`,
        method,
        params,
        this.headers,
        'PUT'
      );

      if (response.error) {
        throw new Error(`Tatum API returned error: ${JSON.stringify(response.error)}`);
      }

      return response;
    } catch (error) {
      this._handleError(error);
    }
  }

  _handleError(error) {
    if (error.message.includes('Invalid value') && error.message.includes('x-api-key')) {
      throw new Error('Invalid Tatum API key. Please check your .env file.');
    }
    throw new Error(`Tatum API error: ${error.message}`);
  }

  // Common Ethereum RPC methods
  async getBlockNumber() {
    return this.post('eth_blockNumber');
  }

  async getBalance(address, block = 'latest') {
    return this.post('eth_getBalance', [address, block]);
  }

  async getTransactionCount(address, block = 'latest') {
    return this.post('eth_getTransactionCount', [address, block]);
  }

  async getBlockByNumber(blockNumber, includeTransactions = false) {
    return this.post('eth_getBlockByNumber', [blockNumber, includeTransactions]);
  }

  async getTransactionByHash(txHash) {
    return this.post('eth_getTransactionByHash', [txHash]);
  }

  async getTransactionReceipt(txHash) {
    return this.post('eth_getTransactionReceipt', [txHash]);
  }

  async sendRawTransaction(signedTx) {
    return this.post('eth_sendRawTransaction', [signedTx]);
  }

  async call(txObject, block = 'latest') {
    return this.post('eth_call', [txObject, block]);
  }

  async estimateGas(txObject) {
    return this.post('eth_estimateGas', [txObject]);
  }

  async getGasPrice() {
    return this.post('eth_gasPrice');
  }
}

// Export singleton instance
export const tatumService = new TatumService(CONFIG.TATUM_API_KEY);

// For backward compatibility
export const makeTatumRequest = (method, params = []) => tatumService.post(method, params);