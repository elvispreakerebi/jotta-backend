require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db");
const passport = require("passport");
const session = require("express-session");
const cors = require("cors");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Connect DB
connectDB();

// Passport Configuration
require("./config/passport")(passport);

// Session Middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use("/auth", require("./routes/auth"));

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
