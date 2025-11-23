const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { extractVideoClip, cleanupOldFiles, tempDir } = require('./video-processor');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000 + process.pid % 100; // Slightly different port per worker to avoid conflicts

app.use(express.json());

// Schedule cleanup of old files every 10 minutes
setInterval(cleanupOldFiles, 10 * 60 * 1000);
cleanupOldFiles(); // Initial cleanup

// Process video clip requests - this is still needed for direct access if needed
app.post('/api/extract-clip', async (req, res) => {
  const { youtubeUrl, startTime, endTime } = req.body;

  // Input validation
  if (!youtubeUrl || startTime === undefined || endTime === undefined) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields',
      message: 'Please provide youtubeUrl, startTime, and endTime',
      data: null
    });
  }

  try {
    // Extract the video clip using the shared processor
    const result = await extractVideoClip(youtubeUrl, startTime, endTime);

    // Add protocol and host to download URL
    const downloadUrl = `${req.protocol}://${req.get('host')}${result.downloadUrl}`;
    result.downloadUrl = downloadUrl;

    // Send success response
    res.status(200).json({
      success: true,
      message: 'Clip extracted successfully',
      data: result,
      error: null
    });
  } catch (error) {
    console.error('Error processing video:', error);

    res.status(500).json({
      success: false,
      error: 'Processing failed',
      message: error.message,
      data: null
    });
  }
});

// Handle file downloads
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.resolve(tempDir, filename);

 console.log('Download request for:', filepath);

  // Security check to prevent directory traversal
  const normalizedPath = path.normalize(filepath);
  if (!normalizedPath.startsWith(path.resolve(tempDir))) {
    return res.status(400).json({
      success: false,
      error: 'Invalid file path',
      message: 'Security violation: path traversal attempt',
      data: null
    });
  }

  // Check if file exists
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({
      success: false,
      error: 'File not found',
      message: `The file ${filename} does not exist or has been deleted`,
      data: null
    });
  }

  try {
    const stats = fs.statSync(filepath);
    
    // Set appropriate headers for video file
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // Stream the file
    const readStream = fs.createReadStream(filepath);
    readStream.pipe(res);

    // Clean up the file after it's sent
    readStream.on('end', () => {
      setTimeout(() => {
        try {
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            console.log(`Temporary file ${filename} deleted after download`);
          }
        } catch (err) {
          console.error(`Error deleting temporary file ${filename}:`, err);
        }
      }, 1000); // Small delay to ensure stream is closed
    });

    readStream.on('error', (err) => {
      console.error(`Error sending file ${filename}:`, err);
      if (!res.headersSent) {
        res.status(50).json({
          success: false,
          error: 'Stream error',
          message: 'Error sending file',
          data: null
        });
      }
    });
  } catch (err) {
    console.error('Error processing download:', err);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: err.message,
      data: null
    });
 }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Worker is running',
    data: {
      status: 'ok',
      tempDir: tempDir,
      pid: process.pid,
      timestamp: new Date().toISOString(),
      supportedUrlFormats: [
        'https://www.youtube.com/watch?v=VIDEO_ID',
        'https://youtu.be/VIDEO_ID',
        'https://www.youtube.com/watch?v=VIDEO_ID&list=...',
        'https://youtu.be/VIDEO_ID?si=...',
        'https://www.youtube.com/embed/VIDEO_ID',
        'https://m.youtube.com/watch?v=VIDEO_ID'
      ]
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

// Global error handler
app.use((err, req, res, next) => {
 console.error('Unhandled error:', err);
 res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message,
    data: null
  });
});

// Handle messages from master process
process.on('message', async (msg) => {
  if (msg.task === 'extract-clip' && msg.req && msg.req.body) {
    const { youtubeUrl, startTime, endTime } = msg.req.body;
    
    try {
      // Extract the video clip using the shared processor
      const result = await extractVideoClip(youtubeUrl, startTime, endTime);
      
      // Add protocol and host to download URL (using placeholder for now since we don't have the full request context)
      // The master will update this with the correct host
      result.downloadUrl = `/api/download/${result.fileName}`;
      
      // Send result back to master
      process.send({
        type: 'taskCompleted',
        id: msg.id,
        result: {
          success: true,
          message: 'Clip extracted successfully',
          data: result,
          error: null
        }
      });
    } catch (error) {
      console.error('Error processing video:', error);
      
      // Send error back to master
      process.send({
        type: 'taskFailed',
        id: msg.id,
        result: {
          success: false,
          error: 'Processing failed',
          message: error.message,
          data: null
        }
      });
    }
  }
});

// Start the worker server if running directly (for debugging)
if (!module.parent) {
  const server = app.listen(PORT, () => {
    console.log(`Worker process ${process.pid} running on http://localhost:${PORT}`);
    console.log(`Temp directory: ${tempDir}`);
    console.log(`API endpoint: POST http://localhost:${PORT}/api/extract-clip`);
    console.log(`Download endpoint: GET http://localhost:${PORT}/api/download/:filename`);
  });

  // Handle graceful shutdown
  process.on('SIGTERM', () => {
   console.log(`Worker process ${process.pid} received SIGTERM, shutting down...`);
    server.close(() => {
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log(`Worker process ${process.pid} received SIGINT, shutting down...`);
    server.close(() => {
      process.exit(0);
    });
  });
}
