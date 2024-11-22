const express = require("express");
const { Queue, Worker, QueueEvents } = require("bullmq");
const axios = require("axios");
const YouTubeVideo = require("../models/YoutubeVideo");
const ensureAuthenticated = require("../middleware/ensureAuthenticated");
const { OpenAI } = require("openai");
const path = require("path");
const fs = require("fs");
const youtubedl = require("youtube-dl-exec");

const router = express.Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// Worker for processing flashcards generation
new Worker(
  "flashcardsQueue",
  async (job) => {
    console.log("Processing job:", job.id);

    const { videoId, userId } = job.data;

    try {
      // Step 1: Fetch video details from YouTube
      const videoDetailsResponse = await axios.get(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      );
      const { title, thumbnail_url: thumbnail } = videoDetailsResponse.data;

      // Fetch video page for full description
      const videoPageResponse = await axios.get(
        `https://www.youtube.com/watch?v=${videoId}`
      );
      const descriptionMatch = videoPageResponse.data.match(
        /<meta name="description" content="(.*?)">/
      );
      const description = descriptionMatch
        ? descriptionMatch[1]
        : "No description available";

      console.log("Fetched video details:", { title, thumbnail, description });

      // Step 2: Download audio using yt-dlp
      const audioPath = path.resolve(__dirname, `../temp/${videoId}.mp3`);
      console.log("Downloading audio...");
      await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
        extractAudio: true,
        audioFormat: "mp3",
        output: audioPath,
      });
      console.log("Audio file saved:", audioPath);

      // Step 3: Transcribe audio file using OpenAI Whisper
      const transcriptionResponse = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: "whisper-1",
      });

      const transcription = transcriptionResponse.text;
      console.log("Transcription:", transcription);

      // Step 4: Generate flashcards using GPT-4
      const summaryResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content:
              "Summarize the provided transcription into concise points suitable for flashcards.",
          },
          { role: "user", content: transcription },
        ],
      });

      const flashcards = summaryResponse.choices[0].message.content
        .split("\n")
        .filter((line) => line.trim());

      console.log("Generated flashcards:", flashcards);

      // Step 5: Save video details and flashcards to the database
      const video = new YouTubeVideo({
        videoId,
        userId,
        title,
        description,
        thumbnail,
        flashcards: flashcards.map((content) => ({ content })),
      });
      await video.save();

      console.log("Video and flashcards saved successfully to the database.");

      // Clean up: Remove the temporary audio file
      fs.unlinkSync(audioPath);

      // Return a success message
      return `Flashcards created for "${title}"`;
    } catch (error) {
      console.error("Error processing job:", error);
      throw error; // Ensure the job logs the error
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
    // Check if video already exists in the database
    const existingVideo = await YouTubeVideo.findOne({
      videoId,
      userId: req.user._id,
    });
    if (existingVideo) {
      console.log("Flashcards for this video already exist.");
      return res
        .status(400)
        .json({ error: "Flashcards for this video already exist." });
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

module.exports = router;
