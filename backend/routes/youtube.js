const express = require("express");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const youtubeDl = require("youtube-dl-exec");
const YouTubeVideo = require("../models/YoutubeVideo");
const ensureAuthenticated = require("../middleware/ensureAuthenticated");
const { OpenAI } = require("openai");

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Start the transcription process and save video details
router.post("/generate", ensureAuthenticated, async (req, res) => {
  const { videoId } = req.body;

  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required." });
  }

  try {
    // Check if video already exists
    const existingVideo = await YouTubeVideo.findOne({ videoId, userId: req.user._id });
    if (existingVideo) {
      return res.status(400).json({ error: "Flashcards for this video already exist." });
    }

    // Fetch video details
    const videoDetails = await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
      dumpSingleJson: true,
      noCheckCertificates: true,
    });

    const newVideo = new YouTubeVideo({
      videoId,
      title: videoDetails.title,
      description: videoDetails.description,
      thumbnail: videoDetails.thumbnail,
      userId: req.user._id,
    });

    await newVideo.save();

    // Start transcription and summarization in the background
    transcribeAndGenerateFlashcards(newVideo._id);

    res.status(200).json({ message: "Processing started.", video: newVideo });
  } catch (error) {
    console.error("Error starting processing:", error);
    res.status(500).json({ error: "Failed to start processing." });
  }
});

// Check video status
router.get("/status/:videoId", ensureAuthenticated, async (req, res) => {
  const { videoId } = req.params;

  try {
    const video = await YouTubeVideo.findOne({ videoId, userId: req.user._id });
    if (!video) {
      return res.status(404).json({ error: "Video not found." });
    }

    res.json({ status: video.status, error: video.error, flashcards: video.flashcards });
  } catch (error) {
    console.error("Error fetching status:", error);
    res.status(500).json({ error: "Failed to fetch video status." });
  }
});

// Background processing function
const transcribeAndGenerateFlashcards = async (videoId) => {
  try {
    const video = await YouTubeVideo.findById(videoId);
    if (!video) return;

    video.status = "transcribing";
    await video.save();

    const audioUrl = await youtubeDl(`https://www.youtube.com/watch?v=${video.videoId}`, {
      extractAudio: true,
      audioFormat: "mp3",
      getUrl: true,
    });

    const audioPath = path.resolve(__dirname, `../temp/${video.videoId}.mp3`);
    const writer = fs.createWriteStream(audioPath);
    const response = await axios({ url: audioUrl, method: "GET", responseType: "stream" });
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    const transcriptionResponse = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
    });

    const transcription = transcriptionResponse.text;

    const summaryResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "Summarize the text into concise points for flashcards." },
        { role: "user", content: transcription },
      ],
    });

    const flashcards = summaryResponse.choices[0].message.content.split("\n").filter((line) => line.trim());
    video.flashcards = flashcards.map((content) => ({ content }));
    video.status = "completed";
    await video.save();

    fs.unlinkSync(audioPath);
  } catch (error) {
    console.error("Error processing video:", error);
    const video = await YouTubeVideo.findById(videoId);
    if (video) {
      video.status = "failed";
      video.error = error.message;
      await video.save();
    }
  }
};

module.exports = router;


// Get all saved videos for the logged-in user
// Get all saved videos for the logged-in user
router.get("/saved-videos", ensureAuthenticated, async (req, res) => {
  try {
    const videos = await YouTubeVideo.find({ userId: req.user._id })
      .sort({ createdAt: -1 }); // Sort by createdAt descending
    res.json(videos);
  } catch (error) {
    console.error("Error fetching saved videos:", error);
    res.status(500).json({ error: "Failed to fetch saved videos." });
  }
});

// Delete a video and its flashcards
router.delete("/delete/:videoId", ensureAuthenticated, async (req, res) => {
  const { videoId } = req.params;

  try {
    const video = await YouTubeVideo.findOneAndDelete({
      videoId,
      userId: req.user._id,
    });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    res.json({ message: "Video and flashcards deleted successfully." });
  } catch (error) {
    console.error("Error deleting video:", error);
    res.status(500).json({ error: "Failed to delete video." });
  }
});

// Get details of a specific video by videoId
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