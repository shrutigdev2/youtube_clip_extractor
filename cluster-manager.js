const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

// Store active workers
const workers = [];
// Store pending requests queue
const requestQueue = [];
// Track busy workers
const busyWorkers = new Set();

// Function to spawn a worker
function spawnWorker() {
  const worker = cluster.fork();
  workers.push(worker);
  
  worker.on('exit', (code, signal) => {
    console.log(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
    console.log('Spawning a new worker...');
    // Remove the dead worker from the array
    const index = workers.indexOf(worker);
    if (index !== -1) {
      workers.splice(index, 1);
      busyWorkers.delete(worker.process.pid);
    }
    // Spawn a new worker to replace the dead one
    spawnWorker();
  });

  // Handle messages from workers
 worker.on('message', (message) => {
    if (message.type === 'taskCompleted' || message.type === 'taskFailed') {
      // Mark worker as available
      busyWorkers.delete(worker.process.pid);
      console.log(`Worker ${worker.process.pid} is now available`);
      
      // Process next request in queue if available
      if (requestQueue.length > 0) {
        const nextRequest = requestQueue.shift();
        assignRequestToWorker(nextRequest.req, nextRequest.res, nextRequest.task);
      }
    }
  });

  return worker;
}

// Function to find an available worker
function getAvailableWorker() {
  for (const worker of workers) {
    if (!busyWorkers.has(worker.process.pid)) {
      return worker;
    }
  }
  return null;
}

// Function to assign a request to an available worker
function assignRequestToWorker(req, res, task) {
  const availableWorker = getAvailableWorker();
  
  if (availableWorker) {
    // Mark worker as busy
    busyWorkers.add(availableWorker.process.pid);
    console.log(`Assigning request to worker ${availableWorker.process.pid}`);
    
    // Store the response object with the request ID for later use
    const requestId = Date.now() + Math.random();
    const timeout = setTimeout(() => {
      if (global.pendingRequests && global.pendingRequests.has(requestId)) {
        const pending = global.pendingRequests.get(requestId);
        if (!pending.res.headersSent) {
          pending.res.status(408).json({
            success: false,
            error: 'Request timeout',
            message: 'Request took too long to process',
            data: null
          });
        }
        global.pendingRequests.delete(requestId);
      }
    }, 120000); // 2 minute timeout
    
    // Store the response and timeout for this request
    if (!global.pendingRequests) {
      global.pendingRequests = new Map();
    }
    global.pendingRequests.set(requestId, { res, timeout });
    
    // Send task to worker
    availableWorker.send({
      task: task,
      req: {
        body: req.body,
        params: req.params,
        query: req.query,
        method: req.method,
        url: req.url,
        headers: req.headers
      },
      id: requestId // Use the same ID for tracking
    });
 } else {
    // No available workers, add to queue
    console.log('No available workers, adding request to queue');
    requestQueue.push({ req, res, task });
  }
}

// Initialize the cluster manager
function initializeCluster() {
  if (cluster.isMaster) {
    console.log(`Master process ${process.pid} is running`);
    console.log(`Number of CPUs: ${numCPUs}`);
    
    // Fork workers based on number of CPUs
    const workerCount = Math.min(numCPUs, 4); // Limit to 4 workers to prevent resource exhaustion during video processing
    console.log(`Spawning ${workerCount} workers...`);
    
    for (let i = 0; i < workerCount; i++) {
      spawnWorker();
    }

    // Handle messages from workers
    Object.values(cluster.workers).forEach(worker => {
      worker.on('message', (message) => {
        // Forward messages to other workers if needed
        // For now, we'll just log them
        console.log(`Message from worker ${worker.process.pid}:`, message);
      });
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('Master process received SIGTERM, shutting down workers...');
      workers.forEach(worker => {
        worker.kill();
      });
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('Master process received SIGINT, shutting down workers...');
      workers.forEach(worker => {
        worker.kill();
      });
      process.exit(0);
    });
  } else {
    // Worker process - load the actual application
    require('./worker.js');
  }
}

module.exports = { initializeCluster, workers, assignRequestToWorker, requestQueue, busyWorkers };
