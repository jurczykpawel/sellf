'use client';

import React, { useEffect, useState } from 'react';
import Confetti from 'react-confetti';

// Custom hook for window size if react-use is not available
function useWindowSizeCustom() {
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    function handleResize() {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }
    
    window.addEventListener('resize', handleResize);
    handleResize();
    
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return windowSize;
}

interface NewOrderNotificationProps {
  amount: string;
  currency: string;
  onClose: () => void;
}

export default function NewOrderNotification({ amount, onClose }: NewOrderNotificationProps) {
  const { width, height } = useWindowSizeCustom();
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Auto close after 8 seconds
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 500); // Wait for exit animation
    }, 8000);

    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <>
      <div 
        className={`fixed top-0 left-0 w-full h-full pointer-events-none z-[100]`}
      >
        <Confetti
          width={width}
          height={height}
          recycle={false}
          numberOfPieces={400}
          gravity={0.2}
        />
      </div>

      <div 
        className={`
          fixed top-8 right-8 z-[101] max-w-sm w-full 
          transform transition-all duration-500 ease-out
          ${isVisible ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-full opacity-0 scale-95'}
        `}
      >
        <div className="bg-gradient-to-br from-emerald-500 to-green-600 overflow-hidden border border-green-400/50">
          <div className="relative p-6 text-center">
            {/* Background pattern */}
            <div className="absolute top-0 left-0 w-full h-full opacity-10">
              <svg width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg">
                <pattern id="grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M1 1h2v2H1V1z" fill="white" />
                </pattern>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
            </div>

            <div className="relative z-10">
              <div className="inline-flex items-center justify-center p-3 bg-white/20 mb-4 backdrop-blur-sm animate-bounce">
                <span className="text-3xl">🎉</span>
              </div>
              
              <h3 className="text-emerald-100 font-bold text-sm uppercase tracking-wider mb-1">
                New Order Received!
              </h3>
              
              <div className="text-5xl font-black text-white mb-2 drop-shadow-md">
                +{amount}
              </div>
              
              <div className="inline-flex items-center text-emerald-100 text-xs font-medium bg-emerald-700/30 px-3 py-1">
                Just now via Stripe
              </div>
            </div>

            <button 
              onClick={() => setIsVisible(false)}
              className="absolute top-3 right-3 text-emerald-200 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="h-1.5 w-full bg-emerald-800/30">
            <div 
              className="h-full bg-emerald-300/80 animate-[shrink_8s_linear_forwards]" 
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </div>
      
      <style jsx>{`
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </>
  );
}
