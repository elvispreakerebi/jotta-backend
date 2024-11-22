import React, { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ToastContainer, toast } from "react-toastify"; // Import ToastContainer and toast
import "react-toastify/dist/ReactToastify.css"; // Import Toastify CSS
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import FlashcardDetails from "./components/FlashcardDetails";

const App = () => {


  return (
    <Router>
      <ToastContainer autoClose={3000} /> {/* Configure ToastContainer */}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/flashcards/:videoId" element={<FlashcardDetails />} />
      </Routes>
    </Router>
  );
};

export default App;
