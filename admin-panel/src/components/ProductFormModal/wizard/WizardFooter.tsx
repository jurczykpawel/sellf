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
  /**
   * False until the shop config fetch (getMyShopConfig, in useProductForm)
   * has settled at least once for this modal-open session. taxMode and
   * vat_rate default to placeholder values (`'local'` / `null`) until then,
   * so "Dalej" and "Publikuj" stay disabled — advancing or submitting
   * against those placeholders can wrongly block a valid product (vat_rate
   * still loading) or, in edit mode, save vat_rate=null for good (no
   * insert-time DB fallback runs on update).
   */
  shopConfigLoaded: boolean;
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
  shopConfigLoaded,
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
  const tooltip = !shopConfigLoaded
    ? t('wizard.loadingConfig')
    : canPublish
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
            disabled={isSubmitting || !canPublish || !shopConfigLoaded}
            loading={isSubmitting || !shopConfigLoaded}
          >
            {submitLabel}
          </Button>
          {!isLastStep && (
            <Button
              onClick={onContinue}
              variant="ghost"
              disabled={!shopConfigLoaded}
              loading={!shopConfigLoaded}
            >
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
