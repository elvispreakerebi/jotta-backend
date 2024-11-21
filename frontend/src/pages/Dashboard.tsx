import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Menu, Transition } from "@headlessui/react"; // For dropdown
import { ChevronDownIcon, LogOutIcon } from "lucide-react"; // Lucide icons
import axios from "axios";

// Define the type for the user state
interface User {
  name: string;
  profileImage: string;
}

const Dashboard = () => {
  const location = useLocation();
  const [message, setMessage] = useState("");
  const [user, setUser] = useState<User | null>(null); // Explicitly type the user state

  // Fetch user info from the backend
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await axios.get("http://localhost:3000/auth/user", {
          withCredentials: true, // Ensures cookies are sent
        });
        console.log("User data fetched:", response.data); // Log the response
        setUser(response.data); // Set the user data in state
      } catch (error) {
        console.error("Error fetching user data:", error); // Log any errors
      }
    };
  
    fetchUser();
  }, []);

  // Handle flash messages
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const msg = params.get("message");
    if (msg) {
      setMessage(msg);

      const timer = setTimeout(() => {
        setMessage("");
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [location]);

  // Handle logout
  const handleLogout = async () => {
    try {
      const response = await axios.get("http://localhost:3000/auth/logout", {
        withCredentials: true, // Ensures cookies are included
      });
      console.log(response.data.message); // Debugging
      window.location.href = "/"; // Redirect to the home page
    } catch (error) {
      console.error("Error logging out:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Fixed Top Section */}
      <div className="w-full fixed top-0 bg-white shadow-sm z-10">
        {/* Row 1 */}
        <div className="flex justify-between items-center px-16 py-3">
          {/* Brand Name */}
          <h1 className="text-2xl font-bold text-gray-800">Jotta</h1>

          {/* User Info and Dropdown */}
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
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
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
            <p className="text-gray-800">Loading user...</p> // Better feedback
          )}
        </div>
        </div>

        {/* Row 2 */}
        <div className="py-4 px-16 max-w-2xl w-full mx-auto">
          {message && (
            <div
              className="bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded-lg mb-4 shadow-md"
              role="alert"
            >
              {message}
            </div>
          )}
          <p className="text-gray-700 mb-4 text-center">
            Enter a YouTube video link to get started or view your previously
            generated flashcards below.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2 space-y-2 sm:space-y-0 max-w-2xl">
            <input
                type="text"
                placeholder="Enter YouTube video URL"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Generate
            </button>
          </div>
        </div>
      </div>

      {/* Content Below Fixed Section */}
      <div className="px-6 py-64">
        <div className="max-w-2xl w-full mx-auto">
          <h3 className="text-lg font-medium text-gray-700 mb-4">
            Previously Generated Flashcards
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Example Flashcard */}
            <div className="bg-white border border-gray-200 rounded-lg shadow-md p-4">
              <img
                src="https://via.placeholder.com/150"
                alt="YouTube Thumbnail"
                className="w-full rounded-md mb-3"
              />
              <h4 className="text-md font-medium text-gray-700">
                Sample Video Title
              </h4>
              <button className="mt-2 text-blue-600 hover:underline">
                View Details
              </button>
            </div>
            {/* Add more flashcards here */}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
