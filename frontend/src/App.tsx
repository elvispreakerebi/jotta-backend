import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import FlashcardDetails from "./components/FlashcardDetails";

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/flashcards/:videoId" element={<FlashcardDetails />} />
      </Routes>
    </Router>
  );
};

export default App;
