# YouTube Video Clip Extractor with Node.js Clustering

This application extracts clips from YouTube videos using a clustered Node.js architecture to handle multiple concurrent requests efficiently.

## Features

- **Node.js Clustering**: Uses the built-in `cluster` module to create multiple worker processes
- **Worker Pool**: Manages a pool of workers to handle concurrent requests
- **Load Balancing**: Distributes requests across available workers
- **Request Queueing**: Queues requests when all workers are busy
- **Automatic Scaling**: Spawns workers based on available CPU cores (up to 4 to prevent resource exhaustion)
- **Process Management**: Automatically restarts failed workers
- **Health Monitoring**: Provides health check endpoints

## Architecture

The application is structured as follows:

- **Master Process**: Handles incoming requests and distributes them to worker processes
- **Worker Processes**: Execute the actual video processing tasks
- **Shared Processing Module**: Contains the core video extraction logic
- **Cluster Manager**: Manages worker lifecycle, request queueing, and load balancing

## Files

- `index.js`: Master process that handles incoming requests and distributes to workers
- `cluster-manager.js`: Manages the cluster, worker lifecycle, and request queueing
- `worker.js`: Worker process that handles video processing tasks
- `video-processor.js`: Shared module with the core video processing logic
- `bin/yt-dlp.exe`: yt-dlp binary for downloading YouTube videos

## How It Works

1. The master process listens for incoming requests on port 3000
2. When a request comes in, it's distributed to an available worker
3. If all workers are busy, the request is queued until a worker becomes available
4. Workers process the video extraction using the shared video-processor module
5. Results are sent back to the master, which responds to the client
6. Failed workers are automatically restarted

## Performance Benefits

- **Parallel Processing**: Multiple video extractions can happen simultaneously
- **Resource Management**: Limits the number of concurrent operations to prevent system overload
- **Fault Tolerance**: Failed workers are automatically restarted
- **Scalability**: Automatically adapts to the available CPU cores

## API Endpoints

- `POST /api/extract-clip`: Extract a clip from a YouTube video
- `GET /api/download/:filename`: Download the extracted clip
- `GET /health`: Health check endpoint

## Usage

Start the application:

```bash
npm start
```

The application will automatically start the master process and spawn worker processes based on the available CPU cores (up to 4).

To extract a clip:

```bash
curl -X POST http://localhost:3000/api/extract-clip \
  -H "Content-Type: application/json" \
  -d '{
    "youtubeUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
    "startTime": 10,
    "endTime": 20
 }'
