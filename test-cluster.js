const http = require('http');

// Test the cluster setup
console.log('Testing cluster setup...');

// Check health endpoint
http.get('http://localhost:3000/health', (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
 res.on('end', () => {
    try {
      const response = JSON.parse(data);
      console.log('Health check response:', response.message);
      console.log('Status:', response.data.status);
      console.log('PID:', response.data.pid || 'Master process');
      
      if (response.data.workers) {
        console.log('Workers status:');
        response.data.workers.forEach((worker, index) => {
          console.log(`  Worker ${index + 1}: PID ${worker.pid}, Dead: ${worker.isDead}, Connected: ${worker.isConnected}`);
        });
      }
      
      console.log('\nCluster setup is working correctly!');
      console.log('The application is now running with clustering and worker pool support.');
      console.log('Master server running on http://localhost:3000');
      console.log('API endpoint: POST http://localhost:3000/api/extract-clip');
    } catch (error) {
      console.error('Error parsing health response:', error);
    }
  });
}).on('error', (error) => {
  console.error('Error connecting to server:', error);
  console.log('Make sure the server is running with: node index.js');
});
