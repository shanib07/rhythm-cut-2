// Quick local test to ensure the service starts correctly
const http = require('http');

console.log('Testing local server...');

// Start the server
require('./index.js');

// Wait a moment then test
setTimeout(() => {
  http.get('http://localhost:8080/', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Health check response:', data);
      process.exit(0);
    });
  }).on('error', (err) => {
    console.error('Health check failed:', err);
    process.exit(1);
  });
}, 2000);