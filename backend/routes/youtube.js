const express = require("express");
const axios = require("axios");
const youtubeDl = require("youtube-dl-exec");
const fs = require("fs");
const path = require("path");
const YouTubeVideo = require("../models/YoutubeVideo");
const ensureAuthenticated = require("../middleware/ensureAuthenticated");
const { OpenAI } = require("openai");

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Ensure the `temp` directory exists
const tempDir = path.resolve(__dirname, "../temp");
if (!fs.existsSync(tempDir)) {
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch (err) {
    console.error("Failed to create temp directory:", err);
  }
}

// Generate Flashcards for a Video
router.post("/generate", ensureAuthenticated, async (req, res) => {
  const { videoId } = req.body;

  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required" });
  }

  try {
    // Check if the video already exists and has flashcards
    const existingVideo = await YouTubeVideo.findOne({ videoId, userId: req.user._id });
    if (existingVideo && existingVideo.flashcards && existingVideo.flashcards.length > 0) {
      return res.status(400).json({
        error: "Flashcards for this video already exist.",
        video: existingVideo,
      });
    }

    // Step 1: Fetch video metadata using YouTube API or youtube-dl
    const videoInfo = await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
      dumpSingleJson: true,
    });

    const { title, description, thumbnail } = videoInfo;
    console.log("Video Metadata:", { title, description, thumbnail });

    // Save or update video details in the database
    let video = existingVideo;
    if (!video) {
      video = new YouTubeVideo({
        videoId,
        title,
        description,
        thumbnail: thumbnail || "", // Use default thumbnail if missing
        userId: req.user._id,
        flashcards: [],
      });
    }

    // Step 2: Extract audio URL from YouTube
    const audioUrl = await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
      extractAudio: true,
      audioFormat: "mp3",
      getUrl: true,
    });
    console.log("Audio URL:", audioUrl);

    // Step 3: Download audio file locally
    const audioPath = path.resolve(tempDir, `${videoId}.mp3`);
    const writer = fs.createWriteStream(audioPath);
    const response = await axios({
      url: audioUrl,
      method: "GET",
      responseType: "stream",
    });

    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    // Step 4: Transcribe the audio file using OpenAI Whisper
    const transcriptionResponse = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
    });

    const transcription = transcriptionResponse.text;
    console.log("Transcription:", transcription);

    // Step 5: Generate flashcards using GPT-4
    const summaryResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            "You are a flashcard generator. Summarize the provided text into concise points suitable for flashcards.",
        },
        { role: "user", content: transcription },
      ],
    });

    const flashcards = summaryResponse.choices[0].message.content
      .split("\n")
      .filter((line) => line.trim());

    console.log("Generated Flashcards:", flashcards);

    // Step 6: Save flashcards to the database
    video.flashcards = flashcards.map((content) => ({ content }));
    await video.save();

    // Clean up: Remove downloaded audio file
    fs.unlinkSync(audioPath);

    console.log("Video details saved:", video);

    res.json({
      message: "Flashcards generated successfully",
      video: {
        videoId,
        title,
        description,
        thumbnail,
        flashcards,
      },
    });
  } catch (error) {
    console.error("Error generating flashcards:", error);
    res.status(500).json({ error: "Failed to generate flashcards." });
  }
});

// Get all saved videos for the logged-in user
router.get("/saved-videos", ensureAuthenticated, async (req, res) => {
  try {
    const videos = await YouTubeVideo.find({ userId: req.user._id });
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