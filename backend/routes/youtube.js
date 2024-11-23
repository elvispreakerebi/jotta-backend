const express = require("express");
const { Queue, Worker, QueueEvents } = require("bullmq");
const axios = require("axios");
const YouTubeVideo = require("../models/YoutubeVideo");
const ensureAuthenticated = require("../middleware/ensureAuthenticated");
const { OpenAI } = require("openai");
const path = require("path");
const fs = require("fs");
const youtubedl = require("youtube-dl-exec");
const ffmpeg = require("fluent-ffmpeg");

const router = express.Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60000, maxRetries: 3 });

// Redis connection options
const connection = {
  host: "localhost",
  port: 6379,
};

// Create the queue and events tracker
const flashcardsQueue = new Queue("flashcardsQueue", { connection });
const queueEvents = new QueueEvents("flashcardsQueue", { connection });

// Listen for job completion and failure
queueEvents.on("completed", (jobId, result) => {
  console.log(`Job ${jobId} completed with result: ${result}`);
});
queueEvents.on("failed", (jobId, failedReason) => {
  console.error(`Job ${jobId} failed with reason: ${failedReason}`);
});

// Helper function to fetch YouTube video details
const fetchVideoDetails = async (videoId) => {
  const apiUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

  try {
    const response = await axios.get(apiUrl);
    const { title, thumbnail_url: thumbnail } = response.data;
    console.log("Fetched video details:", { title, thumbnail });
    return { title, thumbnail };
  } catch (error) {
    console.error("Error fetching video details:", error);
    throw new Error("Failed to fetch video details.");
  }
};

// Helper function to download audio
const downloadAudio = async (videoId) => {
  const audioPath = path.resolve(__dirname, `../temp/${videoId}.mp3`);

  console.log("Downloading audio...");
  await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
    extractAudio: true,
    audioFormat: "mp3",
    output: audioPath,
    audioQuality: "128K",
  });

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found at path: ${audioPath}`);
  }

  console.log("Audio file downloaded:", audioPath);
  return audioPath;
};

// Helper function to split audio
const splitAudio = async (inputPath, chunkDuration) => {
  const outputDir = path.resolve(__dirname, "../temp/chunks");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const outputPaths = [];
    const ffmpegProcess = ffmpeg(inputPath)
      .on("start", (command) => {
        console.log("FFmpeg process started with command:", command);
      })
      .on("end", () => {
        console.log("Audio splitting completed.");
        fs.readdir(outputDir, (err, files) => {
          if (err) {
            return reject(err);
          }
          files.forEach((file) => {
            if (file.endsWith(".mp3")) {
              outputPaths.push(path.join(outputDir, file));
            }
          });
          resolve(outputPaths);
        });
      })
      .on("error", (err) => {
        console.error("Error during audio splitting:", err);
        reject(err);
      });

    ffmpegProcess
      .output(`${outputDir}/chunk-%03d.mp3`)
      .outputOptions([
        "-map 0",
        `-segment_time ${chunkDuration}`,
        "-f segment",
        "-reset_timestamps 1",
      ])
      .run();
  });
};

// Helper function to summarize transcription
const summarizeTranscription = async (transcription) => {
  const maxInputLength = 3500;
  const transcriptionChunks = [];

  for (let i = 0; i < transcription.length; i += maxInputLength) {
    transcriptionChunks.push(transcription.slice(i, i + maxInputLength));
  }

  const summarizedChunks = [];
  for (const chunk of transcriptionChunks) {
    const summaryResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            "Summarize the provided transcription into concise points suitable for flashcards.",
        },
        { role: "user", content: chunk },
      ],
    });

    summarizedChunks.push(summaryResponse.choices[0].message.content.trim());
  }

  return summarizedChunks.join("\n");
};

// Worker for processing flashcards generation
new Worker(
  "flashcardsQueue",
  async (job) => {
    console.log("Processing job:", job.id);

    const { videoId, userId } = job.data;

    try {
      // Fetch video details
      const { title, thumbnail } = await fetchVideoDetails(videoId);

      // Download audio
      const audioPath = await downloadAudio(videoId);

      // Split audio into chunks
      const audioChunks = await splitAudio(audioPath, 300);
      let transcription = "";

      // Transcribe each chunk
      for (const chunk of audioChunks) {
        const transcriptionResponse = await openai.audio.transcriptions.create({
          file: fs.createReadStream(chunk),
          model: "whisper-1",
        });
        transcription += transcriptionResponse.text + " ";
        fs.unlinkSync(chunk);
      }

      console.log("Full transcription obtained.");

      // Summarize the transcription
      const summarizedTranscription = await summarizeTranscription(transcription);
      console.log("Summarized transcription:", summarizedTranscription);

      // Generate flashcards
      const flashcards = summarizedTranscription
        .split("\n")
        .filter((line) => line.trim())
        .map((content) => ({ content }));

      console.log("Generated flashcards:", flashcards);

      // Save to database
      const video = new YouTubeVideo({
        videoId,
        userId,
        title,
        thumbnail,
        flashcards,
      });

      await video.save();

      // Clean up
      fs.unlinkSync(audioPath);
      console.log("Job completed successfully.");
    } catch (error) {
      console.error("Error processing job:", error);
      throw error;
    }
  },
  { connection }
);

// Route to generate flashcards
router.post("/generate", ensureAuthenticated, async (req, res) => {
  const { videoId } = req.body;

  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required" });
  }

  try {
    // Check if video already exists for the user
    const existingVideo = await YouTubeVideo.findOne({
      videoId,
      userId: req.user._id, // Check videoId within the context of the user
    });

    if (existingVideo) {
      return res
        .status(400)
        .json({ error: "Flashcards for this video already exist for this user." });
    }

    // Add job to the queue for flashcards generation
    const job = await flashcardsQueue.add("generateFlashcards", {
      videoId,
      userId: req.user._id,
    });

    res.json({
      message: "Flashcards generation process has started.",
      jobId: job.id,
    });
  } catch (error) {
    console.error("Error adding job to queue:", error);
    res.status(500).json({ error: "Failed to process the video." });
  }
});

// Route to get all saved videos for the logged-in user
router.get("/saved-videos", ensureAuthenticated, async (req, res) => {
  try {
    const videos = await YouTubeVideo.find({ userId: req.user._id }).sort({
      createdAt: -1,
    }); // Sort from newest to oldest
    res.json(videos);
  } catch (error) {
    console.error("Error fetching saved videos:", error);
    res.status(500).json({ error: "Failed to fetch saved videos." });
  }
});

// Route to get video details by video ID
router.get("/:videoId", ensureAuthenticated, async (req, res) => {
  const { videoId } = req.params;

  try {
    const video = await YouTubeVideo.findOne({ videoId, userId: req.user._id });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    res.json(video);
  } catch (error) {
    console.error("Error fetching video details:", error);
    res.status(500).json({ error: "Failed to fetch video details." });
  }
});

// Route to delete a video by video ID
router.delete("/:videoId", ensureAuthenticated, async (req, res) => {
  const { videoId } = req.params;

  try {
    const video = await YouTubeVideo.findOneAndDelete({
      videoId,
      userId: req.user._id,
    });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    res.json({ message: "Video deleted successfully" });
  } catch (error) {
    console.error("Error deleting video:", error);
    res.status(500).json({ error: "Failed to delete video." });
  }
});

module.exports = router;