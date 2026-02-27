'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PRODUCT_ICONS } from '@/utils/themeUtils';

interface IconSelectorProps {
  selectedIcon: string;
  onSelectIcon: (icon: string) => void;
}

// Create icon options from the emoji icons
const ICONS = Object.entries(PRODUCT_ICONS).map(([id, emoji]) => ({ id, emoji }));

const IconSelector: React.FC<IconSelectorProps> = ({ selectedIcon, onSelectIcon }) => {
  const t = useTranslations('common');
  const [isOpen, setIsOpen] = useState(false);

  const toggleDropdown = () => setIsOpen(!isOpen);

  const handleSelectIcon = (iconId: string) => {
    // Get the emoji from our icon list
    const iconObj = ICONS.find(icon => icon.id === iconId);
    if (iconObj) {
      // Pass the emoji directly to the parent component
      onSelectIcon(iconObj.emoji);
      setIsOpen(false);
    }
  };

  // Helper function to determine if a string is an emoji
  const isEmoji = (str: string): boolean => {
    // Basic check if the string is a single character or two characters (some emojis are two chars)
    return str.length === 1 || str.length === 2 || 
      // Check for emoji-like Unicode ranges for more complex emojis
      /[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(str);
  };

  // Find the currently selected icon - handle both icon IDs and emoji characters
  let currentIcon;
  if (isEmoji(selectedIcon)) {
    // If it's an emoji, try to find a matching emoji in our list
    currentIcon = ICONS.find(icon => icon.emoji === selectedIcon);
    // If we couldn't find it, default to first icon but show the emoji
    if (!currentIcon) {
      currentIcon = { 
        id: 'custom', 
        emoji: selectedIcon 
      };
    }
  } else {
    // If it's an icon ID, find it or use the first icon
    currentIcon = ICONS.find(icon => icon.id === selectedIcon) || ICONS[0];
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggleDropdown}
        className="mt-1 flex items-center justify-between w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500"
      >
        <div className="flex items-center space-x-2">
          <span className="text-xl">{currentIcon.emoji}</span>
          <span>{currentIcon.id !== 'custom' ? currentIcon.id : t('custom')}</span>
        </div>
        <svg className="h-5 w-5 text-gray-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-10 mt-1 w-full rounded-md bg-white dark:bg-gray-700 shadow-lg border border-gray-300 dark:border-gray-600">
          <div className="p-2 grid grid-cols-4 gap-2">
            {ICONS.map((icon) => (
              <div 
                key={icon.id}
                onClick={() => handleSelectIcon(icon.id)}
                className={`cursor-pointer p-2 rounded-md flex flex-col items-center ${
                  icon.id === selectedIcon
                    ? 'bg-blue-500 text-white' 
                    : 'hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                <span className="text-2xl">{icon.emoji}</span>
                <span className={`text-xs mt-1 ${
                  icon.id === selectedIcon
                    ? 'text-white' 
                    : 'text-gray-600 dark:text-gray-300'
                }`}>{icon.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default IconSelector;
