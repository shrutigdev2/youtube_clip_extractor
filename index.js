const cluster = require('cluster');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { initializeCluster, assignRequestToWorker, requestQueue, busyWorkers } = require('./cluster-manager');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

if (cluster.isMaster) {
  // Master process - handle incoming requests and distribute to workers
  console.log(`Master process ${process.pid} is running`);
  
  // Initialize the cluster
  initializeCluster();
  
  // Process video clip requests - forward to workers
  app.post('/api/extract-clip', (req, res) => {
    // Use the cluster manager's function to assign the request
    assignRequestToWorker(req, res, 'extract-clip');
  });
  
  // Handle messages from workers
  Object.values(cluster.workers).forEach(worker => {
    worker.on('message', (message) => {
      if (message.type === 'taskCompleted' || message.type === 'taskFailed') {
        // The cluster manager handles the worker availability status
        // Here we just need to handle the response to the client
        if (global.pendingRequests && global.pendingRequests.has(message.id)) {
          const pending = global.pendingRequests.get(message.id);
          clearTimeout(pending.timeout);
          
          if (!pending.res.headersSent) {
            pending.res.status(message.type === 'taskCompleted' ? 200 : 500).json(message.result);
          }
          
          global.pendingRequests.delete(message.id);
        }
      }
    });
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    const workerStatus = Object.values(cluster.workers).map(worker => ({
      pid: worker.process.pid,
      isDead: worker.isDead(),
      isConnected: worker.isConnected()
    }));
    
    res.json({
      success: true,
      message: 'Master is running',
      data: {
        status: 'ok',
        pid: process.pid,
        workerCount: Object.keys(cluster.workers).length,
        activeWorkers: Object.keys(cluster.workers).length,
        busyWorkers: busyWorkers.size,
        queuedRequests: requestQueue.length,
        workers: workerStatus,
        timestamp: new Date().toISOString()
      },
      error: null
    });
  });
  
  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: 'Not found',
      message: `Route ${req.method} ${req.path} not found`,
      data: null
    });
  });

  // Start the master server
  app.listen(PORT, () => {
    console.log(`Master server running on http://localhost:${PORT}`);
    console.log(`API endpoint: POST http://localhost:${PORT}/api/extract-clip`);
  });
  
} else {
  // Worker process - load the actual application
  require('./worker.js');
}
