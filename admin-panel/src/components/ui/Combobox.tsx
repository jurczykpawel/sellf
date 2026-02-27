'use client';

import React, { useState, useEffect, useRef, KeyboardEvent, ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { LucideSearch } from 'lucide-react'; // Assuming LucideReact is available

interface Option {
  value: string;
  label: string;
}

interface ComboboxProps {
  options: Option[];
  placeholder?: string;
  selectedValue: string;
  onSelect: (value: string) => void;
  className?: string;
  label?: string;
}

export const Combobox = ({ options, placeholder, selectedValue, onSelect, className, label }: ComboboxProps) => {
  const t = useTranslations('common');
  const displayPlaceholder = placeholder ?? t('selectOption');
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Reset searchTerm when selectedValue changes externally
  useEffect(() => {
    setSearchTerm('');
  }, [selectedValue]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
        setIsFocused(false);
        setSearchTerm('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % filteredOptions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 + filteredOptions.length) % filteredOptions.length);
    } else if (e.key === 'Enter') {
      if (highlightedIndex !== -1) {
        onSelect(filteredOptions[highlightedIndex].value);
        setSearchTerm('');
        setIsOpen(false);
        setHighlightedIndex(-1);
        setIsFocused(false);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setHighlightedIndex(-1);
      setIsFocused(false);
      setSearchTerm('');
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setIsOpen(true);
    setHighlightedIndex(-1); // Reset highlight on new search
  };

  const handleOptionClick = (value: string, label: string) => {
    onSelect(value);
    setSearchTerm('');
    setIsOpen(false);
    setHighlightedIndex(-1);
    setIsFocused(false);
  };

  const handleFocus = () => {
    setIsFocused(true);
    setIsOpen(true);
  };

  const handleBlur = () => {
    // Delay to allow click on option
    setTimeout(() => {
      setIsFocused(false);
      setSearchTerm('');
    }, 200);
  };

  // Find the label for the currently selected value
  const selectedLabel = options.find(opt => opt.value === selectedValue)?.label || '';

  // Determine what to show in input
  const displayValue = isFocused ? searchTerm : selectedLabel;

  return (
    <div className={clsx('relative', className)} ref={dropdownRef}>
      {label && <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={displayPlaceholder}
          className="w-full py-2 pl-3 pr-10 border border-gray-300 dark:border-gray-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm dark:bg-gray-800 dark:text-white"
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
          <LucideSearch className="h-4 w-4 text-gray-400" />
        </div>
      </div>
      {isOpen && filteredOptions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {filteredOptions.map((option, index) => (
            <li
              key={option.value}
              className={clsx(
                'px-3 py-2 cursor-pointer text-sm',
                index === highlightedIndex
                  ? 'bg-blue-500 text-white'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100'
              )}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => handleOptionClick(option.value, option.label)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
      {isOpen && searchTerm && filteredOptions.length === 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xl px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
          {t('noResults', { searchTerm })}
        </div>
      )}
    </div>
  );
};
