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
  // Lazy init reads window once on first render (client only). This avoids the
  // mount → effect → setState → re-render cascade that the previous version
  // produced on every consumer of the hook.
  const [dimensions, setDimensions] = useState<WindowDimensions>(readDimensions);

  useEffect(() => {
    const handleResize = () => {
      setDimensions(readDimensions());
    };

    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return dimensions;
}
