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
    return { title, thumbnail };
  } catch (error) {
    throw new Error("Failed to fetch video details.");
  }
};

// Helper function to download audio
const downloadAudio = async (videoId) => {
  const audioPath = path.resolve(__dirname, `../temp/${videoId}.mp3`);
  await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
    extractAudio: true,
    audioFormat: "mp3",
    output: audioPath,
    audioQuality: "128K",
  });

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found at path: ${audioPath}`);
  }

  return audioPath;
};

// Helper function to transcribe and summarize audio
const transcribeAndSummarize = async (audioPath) => {
  const uploadUrl = "https://api.assemblyai.com/v2/upload";
  const audioStream = fs.createReadStream(audioPath);

  // Upload the audio file
  const uploadResponse = await axios.post(uploadUrl, audioStream, {
    headers: {
      authorization: ASSEMBLYAI_API_KEY,
      "content-type": "application/json",
    },
  });

  const { upload_url: audioUrl } = uploadResponse.data;

  // Start transcription with summarization
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

  // Poll for transcription completion
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
      const { summary } = statusResponse.data;
      const flashcards = Array.isArray(summary)
        ? summary.map((item) => ({ content: item }))
        : summary.split("\n").map((line) => ({ content: line.trim() }));
      return { flashcards };
    }

    if (statusResponse.data.status === "failed") {
      throw new Error("AssemblyAI transcription failed.");
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
};

// Worker for processing flashcards generation
new Worker(
  "flashcardsQueue",
  async (job) => {
    const { videoId, userId } = job.data;

    try {
      // Fetch video details
      const { title, thumbnail } = await fetchVideoDetails(videoId);

      // Download audio
      const audioPath = await downloadAudio(videoId);

      // Transcribe and summarize the audio
      const { flashcards } = await transcribeAndSummarize(audioPath);

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
    } catch (error) {
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
    const existingVideo = await YouTubeVideo.findOne({
      videoId,
      userId: req.user._id,
    });

    if (existingVideo) {
      return res.status(400).json({
        error: "Flashcards for this video already exist for this user.",
      });
    }

    const job = await flashcardsQueue.add("generateFlashcards", {
      videoId,
      userId: req.user._id,
    });

    res.json({
      message: "Flashcards generation process has started.",
      jobId: job.id,
    });
  } catch (error) {
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
