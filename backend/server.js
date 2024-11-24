require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db");
const passport = require("passport");
const session = require("express-session");
const flash = require("connect-flash");
const cors = require("cors");
const MongoStore = require("connect-mongo");

const app = express();

// Middleware
app.use(
    cors({
        origin: "http://localhost:3001", // Frontend URL
        credentials: true, // Allow cookies
    })
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Connect to MongoDB
connectDB();

// Passport Configuration
require("./config/passport")(passport);

// Session Middleware using MongoDB
app.use(
    session({
        store: MongoStore.create({
            mongoUrl: process.env.MONGO_URI, // MongoDB connection string
            collectionName: "sessions", // Collection to store sessions
        }),
        secret: process.env.SESSION_SECRET || "default_secret",
        resave: false, // Avoid resaving unchanged sessions
        saveUninitialized: false, // Don't save empty sessions
        cookie: {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production", // Use secure cookies in production
            sameSite: "lax",
        },
    })
);

// Flash Middleware
app.use(flash());

// Passport Middleware
app.use(passport.initialize());
app.use(passport.session());

// Debugging Middleware
app.use((req, res, next) => {
    console.log("Session Data:", req.session);
    console.log("Authenticated User:", req.user);
    next();
});

// Routes
app.use("/auth", require("./routes/auth"));
app.use("/youtube", require("./routes/youtube"));

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
