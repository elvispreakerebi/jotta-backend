const mongoose = require("mongoose");

const FlashcardSchema = new mongoose.Schema({
  content: String,
});

const YouTubeVideoSchema = new mongoose.Schema(
  {
    videoId: { type: String, required: true },
    title: { type: String, required: true },
    thumbnail: { type: String, required: true },
    flashcards: [FlashcardSchema],
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending", "transcribing", "completed", "failed"],
      default: "pending",
    },
    error: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Add a compound index to ensure videoId is unique per user
YouTubeVideoSchema.index({ userId: 1, videoId: 1 }, { unique: true });

module.exports = mongoose.model("YouTubeVideo", YouTubeVideoSchema);
