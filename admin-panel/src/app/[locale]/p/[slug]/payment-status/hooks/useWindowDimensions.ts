import { useEffect, useState } from 'react';

interface WindowDimensions {
  width: number;
  height: number;
}

function readDimensions(): WindowDimensions {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

export function useWindowDimensions(): WindowDimensions {
  // SSR and the first client render must use the same snapshot. Reading window
  // in the initializer renders confetti only on the client and breaks hydration.
  const [dimensions, setDimensions] = useState<WindowDimensions>({ width: 0, height: 0 });

  useEffect(() => {
    const handleResize = () => {
      setDimensions(readDimensions());
    };

    window.addEventListener('resize', handleResize, { passive: true });
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return dimensions;
}
