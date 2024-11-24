const express = require("express");
const { Queue, Worker, QueueEvents } = require("bullmq");
const axios = require("axios");
const YouTubeVideo = require("../models/YoutubeVideo");
const ensureAuthenticated = require("../middleware/ensureAuthenticated");
const path = require("path");
const fs = require("fs");
const youtubedl = require("youtube-dl-exec");
const ffmpeg = require("fluent-ffmpeg");

const router = express.Router();

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;

// Redis connection options
// const connection = {
//   host: "localhost",
//   port: 6379,
// };
const Redis = require("ioredis");
const redis = new Redis(process.env.REDIS_URL);
const connection = {
  redis,
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

// Helper function to transcribe audio using AssemblyAI
const transcribeAudio = async (audioPath) => {
  const uploadUrl = "https://api.assemblyai.com/v2/upload";

  console.log("Uploading audio to AssemblyAI...");
  const audioStream = fs.createReadStream(audioPath);

  const uploadResponse = await axios.post(uploadUrl, audioStream, {
    headers: {
      authorization: ASSEMBLYAI_API_KEY,
      "content-type": "application/json",
    },
  });

  const { upload_url: audioUrl } = uploadResponse.data;

  console.log("Audio uploaded. Starting transcription...");
  const transcriptResponse = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      { audio_url: audioUrl },
      {
        headers: {
          authorization: ASSEMBLYAI_API_KEY,
        },
      }
  );

  const { id: transcriptId } = transcriptResponse.data;

  let transcription;
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
      transcription = statusResponse.data.text;
      break;
    }

    if (statusResponse.data.status === "failed") {
      throw new Error("AssemblyAI transcription failed.");
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  console.log("Transcription completed:", transcription);
  return transcription;
};

// Helper function to summarize transcription using Hugging Face Inference API
const summarizeTranscription = async (transcription) => {
  const maxInputLength = 1024; // Hugging Face models often work best with limited input
  const transcriptionChunks = [];

  for (let i = 0; i < transcription.length; i += maxInputLength) {
    transcriptionChunks.push(transcription.slice(i, i + maxInputLength));
  }

  const summarizedChunks = [];
  for (const chunk of transcriptionChunks) {
    try {
      const prompt = `Summarize the following text into concise and important points suitable for flashcards:\n\n${chunk}\n\nSummary:`;
      const response = await axios.post(
          "https://api-inference.huggingface.co/models/facebook/bart-large-cnn", // Hugging Face Summarization Model
          { inputs: prompt },
          {
            headers: {
              Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 30000, // 30 seconds timeout
          }
      );

      if (response.data.error) {
        console.error("Hugging Face API Error:", response.data.error);
        throw new Error(response.data.error);
      }

      const summary = response.data[0].summary_text.trim();
      summarizedChunks.push(summary);
    } catch (error) {
      console.error("Detailed API error response:", error.response?.data || error.message);
      throw new Error("Failed to summarize transcription using Hugging Face.");
    }
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

        try {
          // Transcribe audio
          const transcription = await transcribeAudio(audioPath);
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

          console.log("Job completed successfully.");
        } finally {
          // Clean up audio file after processing
          if (fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
            console.log(`Audio file ${audioPath} removed.`);
          }
        }
      } catch (error) {
        console.error("Error processing job:", error);

        // Retry job if it's a transient error
        if (error.message.includes("Failed to summarize transcription") || error.message.includes("AssemblyAI transcription failed")) {
          console.log("Retrying job...");
          if (job.attemptsMade >= 5) {
            console.error("Max retries reached. Job will not be retried further.");
            return; // Prevent further retries
          }
          throw error; // BullMQ will handle retrying the job
        }

        throw error; // For other errors, let the job fail without retrying
      }
    },
    { connection, attempts: 5, backoff: { type: "fixed", delay: 5000 } } // Retry logic
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

module.exports = router;
