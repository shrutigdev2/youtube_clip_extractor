const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execPromise = promisify(exec);

// Create temp directory if it doesn't exist - USE ABSOLUTE PATH
const tempDir = path.resolve(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
  console.log('Temp directory created at:', tempDir);
}

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
    console.error('FFmpeg not found in PATH', error);
    return false;
  }
}


async function initializeYtDlp() {
  if (isInitialized) return;

  const hasFFmpeg = await checkFFmpeg();
  if (!hasFFmpeg) {
    throw new Error('FFmpeg is required but not found in system PATH');
  }

  const binDir = path.join(__dirname, 'bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  if (!fs.existsSync(ytDlpPath)) {
  console.log('Downloading yt-dlp binary...');
  try {
    await YTDlpWrap.downloadFromGithub(ytDlpPath);
    fs.chmodSync(ytDlpPath, 0o755); // Make executable
    console.log('yt-dlp binary downloaded successfully');
  } catch (error) {
    console.error('Failed to download yt-dlp:', error);
    throw new Error('Failed to initialize yt-dlp');
  }
}


  ytDlpWrap = new YTDlpWrap(ytDlpPath);
  isInitialized = true;
  console.log('yt-dlp initialized');
}

// Function to validate and normalize YouTube URLs
function validateAndNormalizeYouTubeUrl(url) {
  if (!url || typeof url !== 'string') {
    return { isValid: false, error: 'URL is required and must be a string' };
  }

  try {
    // Remove whitespace
    url = url.trim();

    // Common YouTube URL patterns
    const patterns = [
      /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
      /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?.*[&?]v=([a-zA-Z0-9_-]{11})/,
      /^(https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /^(https?:\/\/)?(www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      /^(https?:\/\/)?(www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
      /^(https?:\/\/)?(m\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    ];

    let videoId = null;

    // Try to extract video ID from various formats
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        // Video ID is typically in the last capture group
        videoId = match[match.length - 1];
        break;
      }
    }

    // If no pattern matched, try to extract from query parameters
    if (!videoId) {
      try {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        videoId = urlObj.searchParams.get('v');
      } catch (e) {
        // URL parsing failed
      }
    }

    if (!videoId || videoId.length !== 11) {
      return { 
        isValid: false, 
        error: 'Invalid YouTube URL format. Please provide a valid YouTube video URL' 
      };
    }

    // Return normalized URL (standard watch format)
    const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    return { 
      isValid: true, 
      normalizedUrl: normalizedUrl,
      videoId: videoId
    };

  } catch (error) {
    return { 
      isValid: false, 
      error: 'Failed to parse URL: ' + error.message 
    };
  }
}

// Function to extract video clip
async function extractVideoClip(youtubeUrl, startTime, endTime) {
  // Validate and normalize YouTube URL
  const urlValidation = validateAndNormalizeYouTubeUrl(youtubeUrl);
  if (!urlValidation.isValid) {
    throw new Error(urlValidation.error);
  }

  const normalizedUrl = urlValidation.normalizedUrl;
  const videoId = urlValidation.videoId;

  console.log(`Original URL: ${youtubeUrl}`);
  console.log(`Normalized URL: ${normalizedUrl}`);
  console.log(`Video ID: ${videoId}`);

  if (startTime >= endTime) {
    throw new Error('startTime must be less than endTime');
  }

  if (startTime < 0 || endTime < 0) {
    throw new Error('startTime and endTime must be positive numbers');
  }

  // Initialize yt-dlp
  try {
    await initializeYtDlp();
  } catch (error) {
    throw new Error(`Initialization failed: ${error.message}`);
  }

  const duration = endTime - startTime;
  const outputFileName = `clip_${Date.now()}.mp4`;
  // FIXED: Use absolute path to ensure file goes in temp directory
  const outputPath = path.resolve(tempDir, outputFileName);

  console.log('Output path:', outputPath);

  try {
    console.log(`Getting stream URLs for: ${normalizedUrl}`);

    const videoUrl = await ytDlpWrap.execPromise([
      normalizedUrl,
      '--cookies', path.join(__dirname, 'cookies', 'cookies.txt'),
      '--extractor-args', 'youtube:player_client=default',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--get-url',
      '--no-playlist',
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--get-url',
      '--no-playlist'
    ]);

    const urls = videoUrl.trim().split('\n');
    console.log(`Processing clip: ${startTime}s to ${endTime}s (${duration}s duration)`);

    await new Promise((resolve, reject) => {
      const cmd = ffmpeg();

      cmd.input(urls[0])
         .inputOptions(['-ss', startTime.toString()]);

      if (urls.length > 1) {
        cmd.input(urls[1])
           .inputOptions(['-ss', startTime.toString()]);
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
         .on('progress', (progress) => {
           if (progress.percent) {
             console.log(`Processing: ${progress.percent.toFixed(1)}% done`);
           }
         })
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

    // Verify file was created
    if (!fs.existsSync(outputPath)) {
      throw new Error('File was not created successfully');
    }

    const fileStats = fs.statSync(outputPath);
    const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);

    console.log(`Clip saved to: ${outputPath} (${fileSizeMB} MB)`);

    return {
      downloadUrl: `/api/download/${outputFileName}`,
      fileName: outputFileName,
      fileSize: fileSizeMB + ' MB',
      duration: duration,
      startTime: startTime,
      endTime: endTime,
      videoId: videoId,
      originalUrl: youtubeUrl,
      normalizedUrl: normalizedUrl,
      createdAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('Error processing video:', error);

    // Cleanup on error
    if (fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
        console.log('Cleaned up partial file');
      } catch (cleanupErr) {
        console.error('Cleanup error:', cleanupErr);
      }
    }

    throw new Error(`Processing failed: ${error.message || 'Failed to extract video clip'}`);
  }
}

// Function to clean up old files in temp directory (older than 15 minutes)
function cleanupOldFiles() {
  const fifteenMinutesAgo = Date.now() - (15 * 60 * 1000);

  fs.readdir(tempDir, (err, files) => {
    if (err) {
      console.error('Error reading temp directory:', err);
      return;
    }

    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`Error getting stats for ${filePath}:`, err);
          return;
        }

        if (stats.isFile() && stats.mtime.getTime() < fifteenMinutesAgo) {
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error(`Error deleting old file ${filePath}:`, err);
            } else {
              console.log(`Deleted old file: ${filePath}`);
            }
          });
        }
      });
    });
  });
}

module.exports = {
  extractVideoClip,
  validateAndNormalizeYouTubeUrl,
  cleanupOldFiles,
  tempDir
};
