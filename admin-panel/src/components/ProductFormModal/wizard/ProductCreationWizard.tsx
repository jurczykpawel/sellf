'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Product } from '@/types';
import { BaseModal, ModalHeader, ModalBody, Message } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Modal';
import { useProductForm } from '../hooks';
import { WizardStepIndicator } from './WizardStepIndicator';
import { WizardFooter } from './WizardFooter';
import { StepEssentials } from './steps/StepEssentials';
import { StepContentDetails } from './steps/StepContentDetails';
import { StepSalesSettings } from './steps/StepSalesSettings';
import { getCurrencySymbol } from '@/lib/constants';
import type { ProductFormData } from '../types';

const TOTAL_STEPS = 3;

export interface ProductCreationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: ProductFormData) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
  product?: Product | null; // for edit or duplicate mode
}

const ProductCreationWizard: React.FC<ProductCreationWizardProps> = ({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  error,
  product,
}) => {
  const t = useTranslations('admin.products.form');
  const router = useRouter();
  const locale = useLocale();

  const isEditMode = !!(product && product.id);

  const [currentStep, setCurrentStep] = useState(1);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const {
    formData,
    setFormData,
    priceDisplayValue,
    setPriceDisplayValue,
    salePriceDisplayValue,
    setSalePriceDisplayValue,
    slugModified,
    setSlugModified,
    currentDomain,
    nameInputRef,
    products,
    loadingProducts,
    allCategories,
    loadingCategories,
    omnibusEnabled,
    shopDefaultVatRate,
    taxMode,
    oto,
    setOto,
    urlValidation,
    setUrlValidation,
    handleIconSelect,
    handleSubmit,
    generateSlug,
    validateContentItemUrl,
    fieldErrors,
    setFieldErrors,
    validateRequiredFields,
    waitlistWarning,
    proceedWithSubmit,
    dismissWaitlistWarning,
    hasWaitlistWebhook,
  } = useProductForm({ product, isOpen, onSubmit });

  // Check if form has been touched (for exit confirmation)
  const isFormDirty = useCallback(() => {
    if (isEditMode) {
      // In edit mode, form is always considered dirty (pre-filled)
      return true;
    }
    return formData.name !== '' || formData.price > 0 || formData.description !== '';
  }, [formData.name, formData.price, formData.description, isEditMode]);

  const handleClose = useCallback(() => {
    if (isFormDirty()) {
      setShowExitConfirm(true);
    } else {
      onClose();
    }
  }, [isFormDirty, onClose]);

  const handleContinue = useCallback(() => {
    if (currentStep === 1 && !validateRequiredFields()) {
      return;
    }
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(prev => prev + 1);
    }
  }, [currentStep, validateRequiredFields]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  const handleStepClick = useCallback((step: number) => {
    if (step < currentStep) {
      setCurrentStep(step);
    }
  }, [currentStep]);

  // Navigate to step 1 when field errors appear (required fields are on step 1)
  React.useEffect(() => {
    if (Object.keys(fieldErrors).length > 0 && currentStep !== 1) {
      setCurrentStep(1);
    }
  }, [fieldErrors, currentStep]);

  // Trigger the form submit via the hook's handleSubmit
  const handleWizardSubmit = useCallback(() => {
    // Create a synthetic form event to trigger handleSubmit
    const syntheticEvent = {
      preventDefault: () => {},
    } as React.FormEvent;
    handleSubmit(syntheticEvent);
  }, [handleSubmit]);

  const steps = [
    { number: 1, label: t('wizard.step1') },
    { number: 2, label: t('wizard.step2') },
    { number: 3, label: t('wizard.step3') },
  ];

  if (!isOpen) return null;

  return (
    <>
      <BaseModal isOpen={isOpen} onClose={handleClose} size="xl" closeOnBackdropClick={false}>
        <ModalHeader
          title={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{isEditMode ? t('editProduct') : t('wizard.title')}</span>
              {formData.name && (
                <span className="inline-flex items-center gap-1.5 font-normal text-sf-muted">
                  <span className="truncate max-w-[180px]">{formData.name}</span>
                  {formData.slug && (
                    <span className="font-mono text-sf-muted truncate max-w-[140px]">/p/{formData.slug}</span>
                  )}
                  {priceDisplayValue !== '' && (
                    <span className={`inline-flex items-center px-1.5 py-0.5 text-xs font-medium ${
                      formData.price === 0
                        ? 'bg-sf-success-soft text-sf-success'
                        : 'bg-sf-accent-soft text-sf-accent'
                    }`}>
                      {formData.price === 0 ? t('free') : `${getCurrencySymbol(formData.currency)}${formData.price}`}
                    </span>
                  )}
                </span>
              )}
            </span>
          }
          subtitle={!formData.name ? (isEditMode ? t('editing', { name: product!.name }) : t('wizard.subtitle')) : undefined}
          icon={
            <span className="text-2xl">{formData.icon}</span>
          }
          badge={isEditMode ? (
            !formData.is_active
              ? { text: t('inactive'), variant: 'neutral' as const }
              : !formData.is_listed
                ? { text: t('active'), variant: 'warning' as const }
                : { text: t('active'), variant: 'success' as const }
          ) : undefined}
        />

        <WizardStepIndicator
          steps={steps}
          currentStep={currentStep}
          onStepClick={handleStepClick}
        />

        <ModalBody>
          {error && (
            <Message
              type="error"
              title={t('error')}
              message={error}
              className="mb-6"
            />
          )}

          <form id="wizard-form" onSubmit={handleSubmit}>
            {currentStep === 1 && (
              <StepEssentials
                formData={formData}
                setFormData={setFormData}
                t={t}
                nameInputRef={nameInputRef}
                slugModified={slugModified}
                setSlugModified={setSlugModified}
                currentDomain={currentDomain}
                generateSlug={generateSlug}
                fieldErrors={fieldErrors}
                setFieldErrors={setFieldErrors}
                priceDisplayValue={priceDisplayValue}
                setPriceDisplayValue={setPriceDisplayValue}
                shopDefaultVatRate={shopDefaultVatRate}
                taxMode={taxMode}
              />
            )}

            {currentStep === 2 && (
              <StepContentDetails
                formData={formData}
                setFormData={setFormData}
                t={t}
                onIconSelect={handleIconSelect}
                urlValidation={urlValidation}
                setUrlValidation={setUrlValidation}
                validateContentItemUrl={validateContentItemUrl}
                allCategories={allCategories}
                loadingCategories={loadingCategories}
              />
            )}

            {currentStep === 3 && (
              <StepSalesSettings
                formData={formData}
                setFormData={setFormData}
                t={t}
                salePriceDisplayValue={salePriceDisplayValue}
                setSalePriceDisplayValue={setSalePriceDisplayValue}
                omnibusEnabled={omnibusEnabled}
                hasWaitlistWebhook={hasWaitlistWebhook}
                products={products}
                loadingProducts={loadingProducts}
                currentProductId={product?.id}
                oto={oto}
                setOto={setOto}
              />
            )}
          </form>
        </ModalBody>

        <WizardFooter
          currentStep={currentStep}
          totalSteps={TOTAL_STEPS}
          isSubmitting={isSubmitting}
          isEditMode={isEditMode}
          onBack={handleBack}
          onContinue={handleContinue}
          onSubmit={handleWizardSubmit}
          onCancel={handleClose}
          t={t}
        />

        {/* Waitlist Warning Modal */}
        {waitlistWarning.show && (
          <BaseModal isOpen={true} onClose={dismissWaitlistWarning} size="sm">
            <ModalHeader
              title={t('waitlistWarning.title')}
              icon={<span className="text-2xl">&#9888;&#65039;</span>}
            />
            <ModalBody>
              <p className="text-sf-body mb-4">
                {t('waitlistWarning.description')}
              </p>
              <p className="text-sm text-sf-muted">
                {t('waitlistWarning.consequence')}
              </p>
            </ModalBody>
            <div className="px-6 py-4 border-t border-sf-border bg-sf-raised flex items-center justify-end space-x-3">
              <Button onClick={dismissWaitlistWarning} variant="secondary">
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  dismissWaitlistWarning();
                  router.push(`/${locale}/dashboard/webhooks`);
                }}
                variant="secondary"
              >
                {t('waitlistWarning.configureWebhook')}
              </Button>
              <Button onClick={proceedWithSubmit} variant="danger">
                {t('waitlistWarning.saveAnyway')}
              </Button>
            </div>
          </BaseModal>
        )}
      </BaseModal>

      {/* Exit Confirmation Modal */}
      {showExitConfirm && (
        <BaseModal isOpen={true} onClose={() => setShowExitConfirm(false)} size="sm">
          <ModalHeader
            title={t('wizard.exitTitle')}
          />
          <ModalBody>
            <p className="text-sf-body">
              {t('wizard.exitMessage')}
            </p>
          </ModalBody>
          <div className="px-6 py-4 border-t border-sf-border bg-sf-raised flex items-center justify-end space-x-3">
            <Button onClick={() => setShowExitConfirm(false)} variant="secondary">
              {t('wizard.exitKeepEditing')}
            </Button>
            <Button
              onClick={() => {
                setShowExitConfirm(false);
                onClose();
              }}
              variant="danger"
            >
              {t('wizard.exitDiscard')}
            </Button>
          </div>
        </BaseModal>
      )}
    </>
  );
};

export default ProductCreationWizard;
