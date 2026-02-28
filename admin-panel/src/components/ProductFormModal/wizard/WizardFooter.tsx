'use client';

import React from 'react';
import { Button } from '@/components/ui/Modal';
import type { TranslationFunction } from '../types';

interface WizardFooterProps {
  currentStep: number;
  totalSteps: number;
  isSubmitting: boolean;
  isEditMode: boolean;
  onBack: () => void;
  onContinue: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  t: TranslationFunction;
}

export const WizardFooter: React.FC<WizardFooterProps> = ({
  currentStep,
  totalSteps,
  isSubmitting,
  isEditMode,
  onBack,
  onContinue,
  onSubmit,
  onCancel,
  t,
}) => {
  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === totalSteps;

  return (
    <div className="px-6 py-4 border-t border-gf-border bg-gf-raised rounded-b-2xl">
      <div className="flex items-center justify-between">
        {/* Left side: Cancel / Back */}
        <div>
          {isFirstStep ? (
            <Button onClick={onCancel} variant="ghost">
              {t('wizard.cancel')}
            </Button>
          ) : (
            <Button onClick={onBack} variant="ghost">
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {t('wizard.back')}
            </Button>
          )}
        </div>

        {/* Right side: Create/Update + Continue */}
        <div className="flex items-center gap-3">
          <Button
            onClick={onSubmit}
            variant="primary"
            disabled={isSubmitting}
            loading={isSubmitting}
          >
            {isEditMode ? t('updateProduct') : t('wizard.createProduct')}
          </Button>
          {!isLastStep && (
            <Button onClick={onContinue} variant="ghost">
              {t('wizard.continueSetup')}
              <svg className="w-4 h-4 ml-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
