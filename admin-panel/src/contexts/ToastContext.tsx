'use client';

import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import Toast, { ToastType } from '@/components/Toast';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

type ToastAction =
  | { type: 'ADD_TOAST'; toast: Omit<Toast, 'id'> }
  | { type: 'REMOVE_TOAST'; id: string };

interface ToastContextProps {
  toasts: Toast[];
  addToast: (message: string, type: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextProps | undefined>(undefined);

const toastReducer = (state: Toast[], action: ToastAction): Toast[] => {
  switch (action.type) {
    case 'ADD_TOAST':
      return [
        ...state,
        {
          id: Date.now().toString(),
          ...action.toast,
        },
      ];
    case 'REMOVE_TOAST':
      return state.filter((toast) => toast.id !== action.id);
    default:
      return state;
  }
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, dispatch] = useReducer(toastReducer, []);

  const addToast = (message: string, type: ToastType, duration = 3000) => {
    dispatch({
      type: 'ADD_TOAST',
      toast: { message, type, duration },
    });
  };

  const removeToast = (id: string) => {
    dispatch({ type: 'REMOVE_TOAST', id });
  };

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 max-h-[80vh] overflow-y-auto">
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              message={toast.message}
              type={toast.type}
              duration={toast.duration}
              onClose={() => removeToast(toast.id)}
            />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextProps => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
