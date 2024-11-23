const express = require("express");
const { Queue, Worker, QueueEvents } = require("bullmq");
const axios = require("axios");
const YouTubeVideo = require("../models/YoutubeVideo");
const ensureAuthenticated = require("../middleware/ensureAuthenticated");
const path = require("path");
const fs = require("fs");
const youtubedl = require("youtube-dl-exec");

const router = express.Router();

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;

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
  console.log(`[QUEUE] Job ${jobId} completed with result: ${result}`);
});
queueEvents.on("failed", (jobId, failedReason) => {
  console.error(`[QUEUE] Job ${jobId} failed with reason: ${failedReason}`);
});

// Helper function to fetch YouTube video details
const fetchVideoDetails = async (videoId) => {
  const apiUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

  console.log(`[FETCH] Fetching video details for video ID: ${videoId}`);
  try {
    const response = await axios.get(apiUrl);
    const { title, thumbnail_url: thumbnail } = response.data;
    console.log(`[FETCH] Fetched details: Title="${title}", Thumbnail="${thumbnail}"`);
    return { title, thumbnail };
  } catch (error) {
    console.error(`[FETCH] Failed to fetch video details: ${error.message}`);
    throw new Error("Failed to fetch video details.");
  }
};

// Helper function to download audio
const downloadAudio = async (videoId) => {
  const audioPath = path.resolve(__dirname, `../temp/${videoId}.mp3`);
  console.log(`[DOWNLOAD] Downloading audio for video ID: ${videoId}`);

  await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
    extractAudio: true,
    audioFormat: "mp3",
    output: audioPath,
    audioQuality: "128K",
  });

  if (!fs.existsSync(audioPath)) {
    console.error(`[DOWNLOAD] Audio file not found at path: ${audioPath}`);
    throw new Error(`Audio file not found at path: ${audioPath}`);
  }

  console.log(`[DOWNLOAD] Audio downloaded successfully: ${audioPath}`);
  return audioPath;
};

// Helper function to transcribe and summarize audio
const transcribeAndSummarize = async (audioPath) => {
  console.log(`[TRANSCRIBE] Uploading audio for transcription: ${audioPath}`);
  const uploadUrl = "https://api.assemblyai.com/v2/upload";
  const audioStream = fs.createReadStream(audioPath);

  const uploadResponse = await axios.post(uploadUrl, audioStream, {
    headers: {
      authorization: ASSEMBLYAI_API_KEY,
      "content-type": "application/json",
    },
  });

  const { upload_url: audioUrl } = uploadResponse.data;
  console.log(`[TRANSCRIBE] Audio uploaded successfully: ${audioUrl}`);

  console.log("[TRANSCRIBE] Starting transcription and summarization...");
  const transcriptResponse = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      {
        audio_url: audioUrl,
        summarization: true,
        summary_type: "bullets",
        summary_model: "informative",
      },
      {
        headers: {
          authorization: ASSEMBLYAI_API_KEY,
        },
      }
  );

  const { id: transcriptId } = transcriptResponse.data;
  console.log(`[TRANSCRIBE] Transcription started with ID: ${transcriptId}`);

  while (true) {
    const statusResponse = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: {
            authorization: ASSEMBLYAI_API_KEY,
          },
        }
    );

    if (statusResponse.data.status === "completed") {
      console.log("[TRANSCRIBE] Transcription completed successfully.");
      const { summary } = statusResponse.data;
      const flashcards = Array.isArray(summary)
          ? summary.map((item) => ({ content: item }))
          : summary.split("\n").map((line) => ({ content: line.trim() }));
      console.log(`[TRANSCRIBE] Flashcards generated: ${flashcards.length}`);
      return { flashcards };
    }

    if (statusResponse.data.status === "failed") {
      console.error("[TRANSCRIBE] Transcription failed.");
      throw new Error("AssemblyAI transcription failed.");
    }

    console.log("[TRANSCRIBE] Transcription in progress...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
};

// Worker for processing flashcards generation
new Worker(
    "flashcardsQueue",
    async (job) => {
      const { videoId, userId } = job.data;

      try {
        console.log(`[WORKER] Processing job for video ID: ${videoId}, User ID: ${userId}`);

        // Fetch video details
        const { title, thumbnail } = await fetchVideoDetails(videoId);

        // Download audio
        const audioPath = await downloadAudio(videoId);

        // Transcribe and summarize the audio
        const { flashcards } = await transcribeAndSummarize(audioPath);

        // Save to database
        console.log(`[DATABASE] Saving flashcards and video details to the database.`);
        const video = new YouTubeVideo({
          videoId,
          userId,
          title,
          thumbnail,
          flashcards,
        });

        await video.save();
        console.log(`[DATABASE] Video saved successfully: ${title}`);

        // Clean up
        fs.unlinkSync(audioPath);
        console.log(`[CLEANUP] Audio file deleted: ${audioPath}`);
      } catch (error) {
        console.error(`[WORKER] Error processing job: ${error.message}`);
        throw error;
      }
    },
    { connection }
);

// Route to generate flashcards
router.post("/generate", ensureAuthenticated, async (req, res) => {
  const { videoId } = req.body;

  if (!videoId) {
    console.log("[REQUEST] Missing video ID in request.");
    return res.status(400).json({ error: "Video ID is required" });
  }

  try {
    console.log(`[REQUEST] Received request to generate flashcards for video ID: ${videoId}`);
    const existingVideo = await YouTubeVideo.findOne({
      videoId,
      userId: req.user._id,
    });

    if (existingVideo) {
      console.log("[REQUEST] Flashcards already exist for this video.");
      return res.status(400).json({
        error: "Flashcards for this video already exist for this user.",
      });
    }

    const job = await flashcardsQueue.add("generateFlashcards", {
      videoId,
      userId: req.user._id,
    });

    console.log(`[QUEUE] Job added to queue with ID: ${job.id}`);
    res.json({
      message: "Flashcards generation process has started.",
      jobId: job.id,
    });
  } catch (error) {
    console.error(`[REQUEST] Error processing generate request: ${error.message}`);
    res.status(500).json({ error: "Failed to process the video." });
  }
});

// Route to get saved videos
router.get("/saved-videos", ensureAuthenticated, async (req, res) => {
  try {
    const videos = await YouTubeVideo.find({ userId: req.user._id }).sort({
      createdAt: -1,
    });
    res.json(videos);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch saved videos." });
  }
});

// Route to get video details
router.get("/:videoId", ensureAuthenticated, async (req, res) => {
  const { videoId } = req.params;

  try {
    const video = await YouTubeVideo.findOne({ videoId, userId: req.user._id });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    res.json(video);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch video details." });
  }
});

// Route to delete a video
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
    res.status(500).json({ error: "Failed to delete video." });
  }
});

// Route for full search
router.get("/search", ensureAuthenticated, async (req, res) => {
  const { query } = req.query; // Extract query parameter

  if (!query || query.trim() === "") {
    return res.status(400).json({ error: "Search query cannot be empty." });
  }

  try {
    const videos = await YouTubeVideo.find({
      title: { $regex: query, $options: "i" }, // Case-insensitive regex search
      userId: req.user._id, // Ensure results are specific to the logged-in user
    });

    if (videos.length === 0) {
      return res.status(404).json({ message: "No videos found." });
    }

    res.json(videos);
  } catch (error) {
    console.error("Error searching videos:", error);
    res.status(500).json({ error: "Failed to search for videos." });
  }
});

// Route for auto-suggestions while typing
router.get("/search-suggestions", ensureAuthenticated, async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: "Query parameter is required" });
  }

  try {
    const videos = await YouTubeVideo.find({
      title: { $regex: query, $options: "i" },
      userId: req.user._id,
    }).limit(10); // Limit suggestions to 10 items
    res.json(videos);
  } catch (error) {
    console.error("Error fetching search suggestions:", error);
    res.status(500).json({ error: "Failed to fetch search suggestions." });
  }
});


module.exports = router;
