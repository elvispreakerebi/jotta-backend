const mongoose = require("mongoose");

const FlashcardSchema = new mongoose.Schema({
  content: { type: String, required: true },
});

const YouTubeVideoSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  videoId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  thumbnail: { type: String, required: true },
  flashcards: [FlashcardSchema], // Array of flashcards
  createdAt: { type: Date, default: Date.now },
}, 
{ timestamps: true }
);

module.exports = mongoose.model("YouTubeVideo", YouTubeVideoSchema);
