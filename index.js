const express = require('express');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execPromise = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const ytDlpPath = path.join(__dirname, 'bin', 'yt-dlp');
let ytDlpWrap;
let isInitialized = false;
let ffmpegPath = null;
let ffprobePath = null;

async function checkFFmpeg() {
  try {
    const { stdout } = await execPromise('which ffmpeg');
    ffmpegPath = stdout.trim();
    const { stdout: probeOut } = await execPromise('which ffprobe');
    ffprobePath = probeOut.trim();

    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);

    console.log('FFmpeg found at:', ffmpegPath);
    console.log('FFprobe found at:', ffprobePath);
    return true;
  } catch (error) {
    console.error('FFmpeg not found in PATH. Install with: sudo apt-get install ffmpeg');
    return false;
  }
}

async function checkNodeJs() {
  try {
    const { stdout } = await execPromise('which node');
    const nodePath = stdout.trim();
    console.log('Node.js found at:', nodePath);
    return true;
  } catch (error) {
    console.warn('Node.js not found in PATH. Some YouTube features may not work optimally.');
    return false;
  }
}

async function initializeYtDlp() {
  if (isInitialized) return;

  const hasFFmpeg = await checkFFmpeg();
  if (!hasFFmpeg) {
    throw new Error('FFmpeg is required but not found in system PATH');
  }

  await checkNodeJs();

  const binDir = path.join(__dirname, 'bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  if (!fs.existsSync(ytDlpPath)) {
    console.log('Downloading yt-dlp binary...');
    try {
      await YTDlpWrap.downloadFromGithub(ytDlpPath);
      console.log('yt-dlp binary downloaded successfully');
      
      await execPromise(`chmod +x ${ytDlpPath}`);
      console.log('yt-dlp binary made executable');
    } catch (error) {
      console.error('Failed to download yt-dlp:', error);
      throw new Error('Failed to initialize yt-dlp');
    }
  }

  ytDlpWrap = new YTDlpWrap(ytDlpPath);
  isInitialized = true;
  console.log('yt-dlp initialized');
}

app.post('/api/extract-clip', async (req, res) => {
  const { youtubeUrl, startTime, endTime } = req.body;

  if (!youtubeUrl || startTime === undefined || endTime === undefined) {
    return res.status(400).json({
      error: 'Missing required fields: youtubeUrl, startTime, endTime'
    });
  }

  if (startTime >= endTime) {
    return res.status(400).json({
      error: 'startTime must be less than endTime'
    });
  }

  try {
    await initializeYtDlp();
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to initialize video downloader',
      details: error.message
    });
  }

  const duration = endTime - startTime;
  const outputFileName = `clip_${Date.now()}.mp4`;
  const outputPath = path.join(__dirname, outputFileName);

  try {
    console.log(`Getting stream URLs...`);

    // Enhanced yt-dlp options to bypass bot detection
    const ytDlpOptions = [
      youtubeUrl,
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--get-url',
      '--no-playlist',
      // Use cookies from browser (Firefox example, change to chrome/edge as needed)
      '--cookies-from-browser', 'firefox',
      // Alternative: specify player client to avoid JS requirement
      '--extractor-args', 'youtube:player_client=android,web',
      // Add user agent to appear more like a real browser
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      // Add referer
      '--referer', 'https://www.youtube.com/',
      // Avoid rate limiting
      '--sleep-requests', '1',
      '--sleep-interval', '2',
      // Additional headers
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    ];

    const videoUrl = await ytDlpWrap.execPromise(ytDlpOptions);

    const urls = videoUrl.trim().split('\n');
    console.log(`Downloading clip segment from ${startTime}s to ${endTime}s (${duration}s duration)`);

    await new Promise((resolve, reject) => {
      const cmd = ffmpeg();

      cmd.input(urls[0])
         .inputOptions([
           '-ss', startTime.toString(),
           '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
           '-headers', 'Referer: https://www.youtube.com/'
         ]);

      if (urls.length > 1) {
        cmd.input(urls[1])
           .inputOptions([
             '-ss', startTime.toString(),
             '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
             '-headers', 'Referer: https://www.youtube.com/'
           ]);
      }

      cmd.outputOptions([
           '-t', duration.toString(),
           '-c', 'copy',
           '-map', '0:v:0'
         ]);

      if (urls.length > 1) {
        cmd.outputOptions(['-map', '1:a:0']);
      } else {
        cmd.outputOptions(['-map', '0:a:0']);
      }

      cmd.output(outputPath)
         .on('start', (command) => console.log('FFmpeg command:', command))
         .on('end', () => {
           console.log('Clip extraction completed');
           resolve();
         })
         .on('error', (err) => {
           console.error('FFmpeg error:', err);
           reject(err);
         })
         .run();
    });

    console.log(`Clip saved to: ${outputPath}`);

    res.json({
      success: true,
      message: 'Clip extracted successfully',
      filePath: outputPath,
      fileName: outputFileName,
      duration: duration
    });

  } catch (error) {
    console.error('Error processing video:', error);

    if (fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
      } catch (cleanupErr) {
        console.error('Cleanup error:', cleanupErr);
      }
    }

    res.status(500).json({
      error: 'Failed to extract video clip',
      details: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`API endpoint: POST http://localhost:${PORT}/api/extract-clip`);
});
