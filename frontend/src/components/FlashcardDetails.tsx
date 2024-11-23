import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import {
  Trash2Icon,
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";

interface Flashcard {
  content: string;
}

interface Video {
  title: string;
  flashcards: Flashcard[];
}

const FlashcardDetails: React.FC = () => {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [currentFlashcard, setCurrentFlashcard] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const fetchVideoDetails = async () => {
      try {
        const response = await axios.get(`http://localhost:3000/youtube/${videoId}`, {
          withCredentials: true,
        });
        setVideo(response.data);
      } catch (err) {
        console.error("Error fetching video details:", err);
        setError("Failed to load video details.");
      } finally {
        setLoading(false);
      }
    };

    fetchVideoDetails();
  }, [videoId]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await axios.delete(`http://localhost:3000/youtube/${videoId}`, {
        withCredentials: true,
      });
      navigate("/dashboard");
    } catch (err) {
      console.error("Error deleting video:", err);
      setError("Failed to delete the video. Please try again.");
    } finally {
      setDeleting(false);
      setShowModal(false);
    }
  };

  const handlePreviousFlashcard = () => {
    if (currentFlashcard !== null && currentFlashcard > 0) {
      setCurrentFlashcard(currentFlashcard - 1);
    }
  };

  const handleNextFlashcard = () => {
    if (currentFlashcard !== null && video && currentFlashcard < video.flashcards.length - 1) {
      setCurrentFlashcard(currentFlashcard + 1);
    }
  };

  if (loading) {
    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
          <div className="w-12 h-12 border-4 border-blue-500 border-dotted rounded-full animate-spin"></div>
        </div>
    );
  }

  if (error) {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-red-600">
          <p>{error}</p>
          <button
              onClick={() => navigate("/dashboard")}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go Back
          </button>
        </div>
    );
  }

  return (
      <div className="min-h-screen bg-gray-50">
        {/* Fixed Top Section */}
        <div className="w-full fixed top-0 bg-white shadow-sm z-10 flex justify-between items-center px-6 py-3">
          <div className="flex items-center space-x-4 mr-2">
            <ArrowLeftIcon
                className="w-6 h-6 cursor-pointer text-gray-800"
                onClick={() => navigate("/dashboard")}
            />
            <h1 className="text-lg font-semibold text-gray-800">{video?.title || "Loading..."}</h1>
          </div>
          <Trash2Icon
              className="w-6 h-6 cursor-pointer text-red-600"
              onClick={() => setShowModal(true)}
          />
        </div>

        {/* Confirmation Modal */}
        {showModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-20">
              <div className="bg-white p-6 rounded-lg shadow-lg">
                <h2 className="text-lg font-bold mb-4">Confirm Deletion</h2>
                <p>Are you sure you want to delete this video and its flashcards?</p>
                <div className="mt-4 flex justify-end space-x-2">
                  <button
                      onClick={() => setShowModal(false)}
                      className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                      disabled={deleting}
                  >
                    Cancel
                  </button>
                  <button
                      onClick={handleDelete}
                      className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                      disabled={deleting}
                  >
                    {deleting ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
        )}

        {/* Flashcards Section */}
        <div className="mt-16 px-6 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {video?.flashcards.length ? (
              video.flashcards.map((flashcard, index) => (
                  <div
                      key={index}
                      className="bg-white p-4 rounded-lg shadow-md cursor-pointer"
                      onClick={() => setCurrentFlashcard(index)}
                  >
                    {flashcard.content}
                  </div>
              ))
          ) : (
              <p className="text-gray-600 text-center col-span-full">
                No flashcards available for this video.
              </p>
          )}
        </div>

        {/* Flashcard Overlay */}
        {currentFlashcard !== null && video && (
            <div className="fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-30">
              {/* Flashcard Navigation and Content */}
              <div className="bg-white rounded-lg shadow-lg relative max-w-md w-full p-6 text-center">
                {/* Current Flashcard Number */}
                <p className="text-gray-600 mb-2">
                  Flashcard {currentFlashcard + 1} of {video.flashcards.length}
                </p>

                {/* Flashcard Content */}
                <p className="py-12 text-lg">{video.flashcards[currentFlashcard]?.content}</p>

                {/* Close Button */}
                <button
                    className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
                    onClick={() => setCurrentFlashcard(null)}
                >
                  Close
                </button>

                {/* Navigation Arrows */}
                <div className="hidden sm:flex justify-between items-center mt-4">
                  <div
                      className="flex items-center justify-center w-10 h-10 bg-gray-200 rounded-full cursor-pointer"
                      onClick={handlePreviousFlashcard}
                  >
                    <ChevronLeftIcon className="w-6 h-6 text-gray-700" />
                  </div>
                  <div
                      className="flex items-center justify-center w-10 h-10 bg-gray-200 rounded-full cursor-pointer"
                      onClick={handleNextFlashcard}
                  >
                    <ChevronRightIcon className="w-6 h-6 text-gray-700" />
                  </div>
                </div>
              </div>
            </div>
        )}
      </div>
  );
};

export default FlashcardDetails;
