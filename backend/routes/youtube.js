const express = require("express");
const axios = require("axios");
const router = express.Router();

router.get("/video-details", async (req, res) => {
  const { videoId } = req.query;

  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required" });
  }

  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const response = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
      params: {
        part: "snippet",
        id: videoId,
        key: apiKey,
      },
    });

    const video = response.data.items[0];
    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    const { title, description } = video.snippet;
    res.json({ title, description });
  } catch (error) {
    console.error("Error fetching video details:", error);
    res.status(500).json({ error: "Failed to fetch video details" });
  }
});

module.exports = router;