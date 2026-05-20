'use client';

import React from 'react';
import { Button } from '@/components/ui/Modal';
import type { TranslationFunction, ProductFormData } from '../types';
import { PublishChecklist, getPublishChecklist } from './PublishChecklist';

interface WizardFooterProps {
  currentStep: number;
  totalSteps: number;
  isSubmitting: boolean;
  isEditMode: boolean;
  formData: ProductFormData;
  priceDisplayValue: string;
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
  formData,
  priceDisplayValue,
  onBack,
  onContinue,
  onSubmit,
  onCancel,
  t,
}) => {
  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === totalSteps;
  const checklist = getPublishChecklist(formData, priceDisplayValue, t);
  const missing = checklist.filter((c) => !c.ok);
  const canPublish = isEditMode || missing.length === 0;
  const submitLabel = isEditMode ? t('updateProduct') : t('publish.cta');
  const tooltip = canPublish
    ? undefined
    : t('publish.disabledTooltip', { missing: missing.map((m) => m.label).join(', ') });

  return (
    <div className="px-6 py-3 border-t border-sf-border bg-sf-raised space-y-2">
      {!isEditMode && (
        <PublishChecklist
          formData={formData}
          priceDisplayValue={priceDisplayValue}
          t={t}
        />
      )}
      <div className="flex items-center justify-between">
        <div>
          {isFirstStep ? (
            <Button onClick={onCancel} variant="ghost">
              {t('wizard.cancel')}
            </Button>
          ) : (
            <Button onClick={onBack} variant="ghost">
              <svg
                className="w-4 h-4 mr-1.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              {t('wizard.back')}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3" title={tooltip}>
          <Button
            onClick={onSubmit}
            variant="primary"
            disabled={isSubmitting || !canPublish}
            loading={isSubmitting}
          >
            {submitLabel}
          </Button>
          {!isLastStep && (
            <Button onClick={onContinue} variant="ghost">
              {t('wizard.continueSetup')}
              <svg
                className="w-4 h-4 ml-1.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
