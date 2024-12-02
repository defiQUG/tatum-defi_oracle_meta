import http from 'http';
import https from 'https';
import { URL } from 'url';

/**
 * Make an RPC request
 * @param {string} url - The URL to make the request to
 * @param {string} method - The RPC method
 * @param {Array} params - The RPC parameters
 * @param {Object} headers - Request headers
 * @param {string} httpMethod - HTTP method (GET, POST, PUT)
 * @returns {Promise<any>} - The RPC response
 */
export function makeRPCRequest(url, method, params = [], headers = {}, httpMethod = 'POST') {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      method: httpMethod,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    // Choose http or https based on the URL protocol
    const requestModule = parsedUrl.protocol === 'https:' ? https : http;

    const req = requestModule.request(options, (res) => {
      const chunks = [];

      res.on('data', (chunk) => chunks.push(chunk));

      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString();
          
          // Handle non-200 status codes
          if (res.statusCode !== 200) {
            throw new Error(`HTTP ${res.statusCode}: ${body}`);
          }

          // Try to parse as JSON
          try {
            const data = JSON.parse(body);
            resolve(data);
          } catch {
            // If not JSON, return raw response
            resolve(body);
          }
        } catch (error) {
          reject(new Error(`Failed to process response: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    // Only send body data for POST and PUT requests
    if (httpMethod === 'POST' || httpMethod === 'PUT') {
      const data = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: method,
        params: params
      });
      req.write(data);
    }

    req.end();
  });
} 