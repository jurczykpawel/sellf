'use client';

import { useState } from 'react';

interface UseDragOrderReturn<T> {
  draggedIndex: number | null;
  handleDragStart: (index: number) => void;
  handleDragOver: (e: React.DragEvent, index: number) => void;
  handleDragEnd: () => void;
}

/**
 * Generic drag-and-drop reorder hook.
 * Mutates the items array via the provided setter.
 */
export function useDragOrder<T>(
  items: T[],
  setItems: (items: T[]) => void
): UseDragOrderReturn<T> {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  function handleDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newItems = [...items];
    const dragged = newItems[draggedIndex];
    newItems.splice(draggedIndex, 1);
    newItems.splice(index, 0, dragged);

    setItems(newItems);
    setDraggedIndex(index);
  }

  function handleDragEnd() {
    setDraggedIndex(null);
  }

  return { draggedIndex, handleDragStart, handleDragOver, handleDragEnd };
}
