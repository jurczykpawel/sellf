'use client';

import React from 'react';

interface Step {
  label: string;
  number: number;
}

interface WizardStepIndicatorProps {
  steps: Step[];
  currentStep: number;
  onStepClick: (step: number) => void;
}

export const WizardStepIndicator: React.FC<WizardStepIndicatorProps> = ({
  steps,
  currentStep,
  onStepClick,
}) => {
  return (
    <div className="px-6 py-3 border-b border-gf-border">
      {/* Desktop view */}
      <div className="hidden sm:flex items-center justify-center">
        {steps.map((step, index) => {
          const isCompleted = step.number < currentStep;
          const isCurrent = step.number === currentStep;
          const isClickable = step.number < currentStep;

          return (
            <React.Fragment key={step.number}>
              {index > 0 && (
                <div
                  className={`h-0.5 w-16 mx-2 transition-colors duration-200 ${
                    isCompleted
                      ? 'bg-gf-accent'
                      : 'bg-gf-raised'
                  }`}
                />
              )}
              <button
                type="button"
                onClick={() => isClickable && onStepClick(step.number)}
                disabled={!isClickable}
                className={`flex items-center gap-2 group ${
                  isClickable ? 'cursor-pointer' : 'cursor-default'
                }`}
              >
                <div
                  className={`
                    flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold
                    transition-all duration-200 flex-shrink-0
                    ${isCompleted
                      ? 'bg-gf-accent text-gf-inverse'
                      : isCurrent
                        ? 'bg-gf-accent text-gf-inverse ring-2 ring-gf-accent-med'
                        : 'bg-gf-raised text-gf-muted'
                    }
                    ${isClickable ? 'group-hover:ring-2 group-hover:ring-gf-accent-med' : ''}
                  `}
                >
                  {isCompleted ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    step.number
                  )}
                </div>
                <span
                  className={`text-sm font-medium whitespace-nowrap ${
                    isCurrent
                      ? 'text-gf-accent'
                      : isCompleted
                        ? 'text-gf-body'
                        : 'text-gf-muted'
                  }`}
                >
                  {step.label}
                </span>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Mobile view */}
      <div className="flex sm:hidden items-center justify-between">
        <div className="flex items-center gap-2">
          {steps.map((step, index) => {
            const isCompleted = step.number < currentStep;
            const isCurrent = step.number === currentStep;
            const isClickable = step.number < currentStep;

            return (
              <React.Fragment key={step.number}>
                {index > 0 && (
                  <div
                    className={`h-0.5 w-6 transition-colors duration-200 ${
                      isCompleted
                        ? 'bg-gf-accent'
                        : 'bg-gf-raised'
                    }`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => isClickable && onStepClick(step.number)}
                  disabled={!isClickable}
                  className={`
                    flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold
                    transition-all duration-200
                    ${isCompleted
                      ? 'bg-gf-accent text-gf-inverse'
                      : isCurrent
                        ? 'bg-gf-accent text-gf-inverse ring-2 ring-gf-accent-med'
                        : 'bg-gf-raised text-gf-muted'
                    }
                  `}
                >
                  {isCompleted ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    step.number
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <span className="text-xs text-gf-muted">
          {steps[currentStep - 1]?.label}
        </span>
      </div>
    </div>
  );
};
