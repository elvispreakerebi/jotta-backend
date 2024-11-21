const express = require("express");
const passport = require("passport");
const User = require("../models/User");

const router = express.Router(); // Define router

// Google Auth Route
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// Google Auth Callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login",
  }),
  async (req, res) => {
    try {
      const user = req.user;
      const existingUser = await User.findOne({ googleId: user.googleId });

      if (!existingUser) {
        req.flash("success", "Account created successfully");
      } else if (existingUser.createdAt && existingUser.updatedAt) {
        if (existingUser.createdAt.toISOString() === existingUser.updatedAt.toISOString()) {
          req.flash("success", "Account created successfully");
        } else {
          req.flash("success", "You've logged in");
        }
      } else {
        req.flash("success", "You've logged in");
      }

      // Redirect with flash messages
      res.redirect(`http://localhost:3001/dashboard?message=${encodeURIComponent(req.flash("success"))}`);
    } catch (err) {
      console.error(err);
      res.redirect("/login");
    }
  }
);

// Add the /user route
router.get("/user", (req, res) => {
  console.log("Request received at /user");
  if (req.isAuthenticated()) {
    console.log("Authenticated user:", req.user);
    res.json({
      name: req.user.name,
      profileImage: req.user.profilePicture,
    });
  } else {
    console.log("User not authenticated");
    res.status(401).json({ message: "Unauthorized" });
  }
});

// Logout Route
router.get("/logout", (req, res) => {
  console.log("Logout route hit"); // Debugging log
  req.logout((err) => {
    if (err) {
      console.error("Error during logout:", err);
      return res.status(500).send("Error logging out");
    }
    req.session.destroy(); // Destroy the session
    res.clearCookie("connect.sid"); // Clear session cookie
    res.status(200).send({ message: "Logout successful" }); // Send a JSON response
  });
});

module.exports = router; // Export router