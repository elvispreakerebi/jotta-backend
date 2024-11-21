const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  googleId: { type: String, required: true },
  name: { type: String },
  email: { type: String },
  profilePicture: { type: String },
});

module.exports = mongoose.model("User", UserSchema);