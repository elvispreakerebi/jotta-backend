require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db");
const passport = require("passport");
const session = require("express-session");
const flash = require("connect-flash");
const cors = require("cors");
const youtubeRoutes = require("./routes/youtube");

const app = express();


// Middleware
app.use(
    cors({
      origin: "http://localhost:3001", // Your frontend URL
      credentials: true, // Allow cookies to be sent
    })
  );
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Connect to MongoDB
connectDB();

// Passport Configuration
require("./config/passport")(passport);

// Session Middleware
app.use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: false, // Set to true in production (HTTPS)
        sameSite: "lax",
      },
    })
  );

// Flash Middleware
app.use(flash());

// Passport Middleware
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use("/auth", require("./routes/auth"));
app.use("/youtube", youtubeRoutes);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));