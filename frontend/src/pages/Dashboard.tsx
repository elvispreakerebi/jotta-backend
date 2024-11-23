import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, Transition } from "@headlessui/react";
import { ChevronDownIcon, LogOutIcon, FileTextIcon } from "lucide-react";
import { toast } from "react-toastify";
import axios from "axios";
import YoutubeVideoCard from "../components/YoutubeVideoCard";
import "react-toastify/dist/ReactToastify.css";

interface User {
  name: string;
  profileImage: string;
}

interface SavedVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  description: string;
}

const Dashboard = () => {
  const navigate = useNavigate();

  const [user, setUser] = useState<User | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [savedVideos, setSavedVideos] = useState<SavedVideo[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const fetchUserAndVideos = async () => {
      try {
        const userResponse = await axios.get("http://localhost:3000/auth/user", {
          withCredentials: true,
        });
        setUser(userResponse.data);
        await fetchSavedVideos();
      } catch (error) {
        console.error("Error fetching user or videos:", error);
        toast.error("Failed to fetch user or videos.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserAndVideos();

    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [pollingInterval]);

  const fetchSavedVideos = async () => {
    try {
      const videosResponse = await axios.get("http://localhost:3000/youtube/saved-videos", {
        withCredentials: true,
      });
      setSavedVideos(videosResponse.data);
    } catch (error) {
      console.error("Error fetching saved videos:", error);
      toast.error("Failed to fetch saved videos.");
    }
  };

  const checkVideoExists = async (videoId: string) => {
    try {
      const response = await axios.get(`http://localhost:3000/youtube/${videoId}`, {
        withCredentials: true,
      });
      return response.status === 200; // Video exists
    } catch (error) {
      return false; // Video does not exist yet
    }
  };

  const handleLogout = async () => {
    try {
      await axios.get("http://localhost:3000/auth/logout", { withCredentials: true });
      window.location.href = "/";
    } catch (error) {
      console.error("Error logging out:", error);
      toast.error("Failed to log out. Please try again.");
    }
  };

  const handleGenerate = async () => {
    try {
      setIsGenerating(true); // Start spinner
      const videoId = youtubeUrl.split("v=")[1]?.split("&")[0];
      if (!videoId) {
        toast.error("Invalid YouTube URL");
        setIsGenerating(false);
        return;
      }

      const response = await axios.post(
        "http://localhost:3000/youtube/generate",
        { videoId },
        { withCredentials: true }
      );

      toast.success(response.data.message); // Success message from backend
      setYoutubeUrl(""); // Clear the input field

      // Start polling to detect when the video is saved
      const interval = setInterval(async () => {
        const videoExists = await checkVideoExists(videoId);
        if (videoExists) {
          clearInterval(interval); // Stop polling once video exists
          setPollingInterval(null);
          await fetchSavedVideos(); // Refresh the video list
          setIsGenerating(false); // Stop spinner
          toast.success("Flashcards and video details have been saved!"); // Success toast
        }
      }, 2000); // Poll every 2 seconds

      setPollingInterval(interval); // Track polling interval
    } catch (error: any) {
      console.error("Error generating video details:", error);

      const errorMessage =
        error.response?.data?.error || "Failed to generate video details. Please try again.";
      toast.error(errorMessage);

      if (errorMessage === "Flashcards for this video already exist.") {
        setYoutubeUrl(""); // Clear the input field
      }

      setIsGenerating(false); // Stop spinner
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation Section */}
      <div className="w-full fixed top-0 bg-white shadow-sm z-10">
        <div className="flex justify-between items-center px-16 py-3">
          <h1 className="text-2xl font-bold text-gray-800">Jotta</h1>
          <div className="flex items-center space-x-4">
            {user ? (
              <>
                <img
                  src={user.profileImage || "https://via.placeholder.com/40"}
                  alt="User"
                  className="w-10 h-10 rounded-full border border-gray-300"
                />
                <p className="text-gray-800">{user.name}</p>
                <Menu as="div" className="relative">
                  <Menu.Button>
                    <ChevronDownIcon className="w-6 h-6 text-gray-600 cursor-pointer" />
                  </Menu.Button>
                  <Transition
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="opacity-100 scale-100"
                    leaveTo="opacity-0 scale-95"
                  >
                    <Menu.Items className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={handleLogout}
                            className={`${
                              active ? "bg-gray-100" : ""
                            } flex items-center w-full px-4 py-2 text-gray-800 text-sm`}
                          >
                            <LogOutIcon className="w-5 h-5 mr-2 text-gray-600" />
                            Log Out
                          </button>
                        )}
                      </Menu.Item>
                    </Menu.Items>
                  </Transition>
                </Menu>
              </>
            ) : (
              <p className="text-gray-800">Loading user...</p>
            )}
          </div>
        </div>
        <div className="py-4 px-16 max-w-2xl w-full mx-auto">
          <p className="text-gray-700 mb-4 text-center">
            {savedVideos.length > 0
              ? "Enter a YouTube video link to generate more flashcards or view your previously generated videos below."
              : "Enter a YouTube video link to get started with your first flashcards."}
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2 space-y-2 sm:space-y-0 max-w-2xl">
            <input
              type="text"
              placeholder="Enter YouTube video URL"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
            />
            <button
              onClick={handleGenerate}
              className={`w-full sm:w-auto px-4 py-2 rounded-lg text-white ${
                isGenerating ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
              }`}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <div className="flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-white border-dotted rounded-full animate-spin mr-2"></div>
                  Generating...
                </div>
              ) : (
                "Generate"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Video Cards Section */}
      <div className="px-6 py-64">
        {isLoading ? (
          <div className="flex justify-center items-center h-32">
            <div className="w-12 h-12 border-4 border-blue-500 border-dotted rounded-full animate-spin"></div>
          </div>
        ) : savedVideos.length > 0 ? (
          <>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Your Flashcard Videos</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {savedVideos.map((video) => (
                <YoutubeVideoCard
                  key={video.videoId}
                  thumbnail={video.thumbnail}
                  title={video.title}
                  onClick={() => navigate(`/flashcards/${video.videoId}`)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center mt-16 text-gray-600">
            <FileTextIcon className="w-16 h-16 mb-4" />
            <p className="text-lg">No YouTube video flashcards yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;