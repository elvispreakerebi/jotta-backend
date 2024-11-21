import React from "react";

interface YoutubeVideoCardProps {
  thumbnail: string;
  title: string;
  onClick: () => void; // Callback for when the card is clicked
}

const YoutubeVideoCard: React.FC<YoutubeVideoCardProps> = ({ thumbnail, title, onClick }) => {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer bg-white border border-gray-200 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
    >
      <img src={thumbnail} alt={title} className="w-full h-48 object-cover" />
      <div className="p-4">
        <h4 className="text-md font-medium text-gray-800 line-clamp-2">{title}</h4>
      </div>
    </div>
  );
};

export default YoutubeVideoCard;