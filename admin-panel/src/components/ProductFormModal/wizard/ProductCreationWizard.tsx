'use client';

import React, { useState, useCallback, useEffect, useId, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Product } from '@/types';
import { BaseModal, ModalHeader, ModalBody, Message } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Modal';
import TutorialTrigger from '@/components/tutorials/TutorialTrigger';
import { useProductForm } from '../hooks';
import { EventSection } from '../sections/EventSection';
import { WizardFooter } from './WizardFooter';
import { FormSection } from './FormSection';
import { FormSectionNav } from './FormSectionNav';
import { BuyerSummary } from './BuyerSummary';
import { ScenarioBar } from './ScenarioBar';
import { applyScenario, type ScenarioId } from './scenarios';
import { BasicsPanel } from './panels/BasicsPanel';
import { DeliveryPanel } from './panels/DeliveryPanel';
import { CartPanel } from './panels/CartPanel';
import { OfferPanel } from './panels/OfferPanel';
import { SalesPanel } from './panels/SalesPanel';
import { FORM_SECTIONS, initialSection, sectionForErrors, type FormSectionId } from './form-sections';
import { headerPriceBadge } from './header-price-badge';
import { initialFormData, type ProductFormData } from '../types';

export interface ProductCreationWizardProps {
  tutorial?: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: ProductFormData) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
  product?: Product | null; // for edit or duplicate mode
  hasLicenseIssuance?: boolean;
  /** Seed a brand-new product as a bundle (new-product mode only). */
  defaultIsBundle?: boolean;
}

const ProductCreationWizard: React.FC<ProductCreationWizardProps> = ({
  isOpen,
  tutorial,
  onClose,
  onSubmit,
  isSubmitting,
  error,
  product,
  hasLicenseIssuance,
  defaultIsBundle,
}) => {
  const t = useTranslations('admin.products.form');
  const router = useRouter();
  const locale = useLocale();

  const isEditMode = !!(product && product.id);
  // A blank new product opens on "What are you selling?" instead of the name field.
  const isBlankNew = !product && !defaultIsBundle;

  const titleId = useId();
  const [currentSection, setCurrentSection] = useState<FormSectionId>(() => initialSection(tutorial));
  const sectionIndex = FORM_SECTIONS.indexOf(currentSection);
  const formRef = useRef<HTMLFormElement>(null);
  // A newly shown section starts at its heading, not at the previous section's scroll position.
  useEffect(() => { formRef.current?.parentElement?.scrollTo?.({ top: 0 }); }, [currentSection]);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [openingDuplicate, setOpeningDuplicate] = useState(!!product && !product.id);
  useEffect(() => {
    if (!openingDuplicate) return;
    const timer = setTimeout(() => setOpeningDuplicate(false), 500);
    return () => clearTimeout(timer);
  }, [openingDuplicate]);

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
    allTags,
    loadingTags,
    omnibusEnabled,
    shopDefaultVatRate,
    taxMode,
    shopConfigLoaded,
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
    rejectedSaves,
    validateStep1Fields,
    waitlistWarning,
    proceedWithSubmit,
    dismissWaitlistWarning,
    hasWaitlistWebhook,
  } = useProductForm({ product, isOpen, onSubmit, defaultIsBundle, focusName: !isBlankNew });

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
    // The "Dalej" button is disabled while shopConfigLoaded is false
    // (WizardFooter) — this guards against it firing anyway (e.g. a
    // keyboard-triggered click on a not-yet-re-rendered disabled state).
    // Basics validation depends on taxMode/vat_rate, which are only
    // trustworthy once the shop config fetch has settled.
    if (!shopConfigLoaded) return;
    if (currentSection === 'basics' && !validateStep1Fields()) return;
    const next = FORM_SECTIONS[sectionIndex + 1];
    if (next) setCurrentSection(next);
  }, [currentSection, sectionIndex, validateStep1Fields, shopConfigLoaded]);

  const handleBack = useCallback(() => {
    const previous = FORM_SECTIONS[sectionIndex - 1];
    if (previous) setCurrentSection(previous);
  }, [sectionIndex]);

  // Every refused save opens the section holding the first errored field and focuses that field.
  const [shownRejection, setShownRejection] = useState(rejectedSaves);
  const [focusError, setFocusError] = useState(0);
  if (shownRejection !== rejectedSaves) {
    setShownRejection(rejectedSaves);
    const section = sectionForErrors(Object.keys(fieldErrors));
    if (section) setCurrentSection(section);
    setFocusError(count => count + 1);
  }
  useEffect(() => {
    if (!focusError) return;
    const frame = window.requestAnimationFrame(() => {
      if (document.activeElement?.getAttribute('aria-invalid') === 'true') return;
      const field = document.querySelector<HTMLElement>('#wizard-form [aria-invalid="true"]');
      field?.scrollIntoView({ block: 'center' });
      field?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusError]);

  // Trigger the form submit via the hook's handleSubmit
  const handleWizardSubmit = useCallback(() => {
    // Create a synthetic form event to trigger handleSubmit
    const syntheticEvent = {
      preventDefault: () => {},
    } as React.FormEvent;
    handleSubmit(syntheticEvent);
  }, [handleSubmit]);

  // A scenario sets existing fields on the form as it is now; the price field shows the amount it set.
  const applyScenarioChange = useCallback((id: ScenarioId) => {
    const price = applyScenario(formData, id).price;
    if (price !== formData.price) setPriceDisplayValue(price ? String(price).replace('.', ',') : '');
    setFormData(prev => applyScenario(prev, id));
  }, [formData, setFormData, setPriceDisplayValue]);

  const priceBadge = headerPriceBadge(formData, priceDisplayValue, t('free'), locale);

  if (!isOpen) return null;

  return (
    <>
      <BaseModal isOpen={isOpen} onClose={handleClose} size="xl" closeOnBackdropClick={false} labelledBy={titleId} initialFocusSelector={isBlankNew ? '[data-scenario]' : undefined}>
        <ModalHeader
          title={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span id={titleId}>{isEditMode ? t('editProduct') : t('wizard.title')}</span>
              {formData.name && (
                <span className="inline-flex items-center gap-1.5 font-normal text-sf-muted">
                  <span className="truncate max-w-[180px]">{formData.name}</span>
                  {formData.slug && (
                    <span className="font-mono text-sf-muted truncate max-w-[140px]">/p/{formData.slug}</span>
                  )}
                  {priceBadge && (
                    <span className={`inline-flex items-center px-1.5 py-0.5 text-xs font-medium ${
                      priceBadge.free
                        ? 'bg-sf-success-soft text-sf-success'
                        : 'bg-sf-accent-soft text-sf-accent'
                    }`}>
                      {priceBadge.label}
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

        <FormSectionNav current={currentSection} formData={formData} onSelect={setCurrentSection} t={t} />

        <ModalBody>
          <TutorialTrigger id="product-form" />
          <ScenarioBar
            formData={formData}
            onApply={applyScenarioChange}
            t={t}
            startOpen={isBlankNew}
            pristine={product ? null : initialFormData}
            isStored={isEditMode}
          />
          {error && (
            <Message
              type="error"
              title={t('error')}
              message={error}
              className="mb-6"
            />
          )}

          <form ref={formRef} id="wizard-form" onSubmit={handleSubmit} noValidate onClickCapture={(event) => {
            if (openingDuplicate && event.detail > 0) { event.preventDefault(); event.stopPropagation(); }
          }}>
            <FormSection id={currentSection} t={t}>
              {currentSection === 'basics' && (
                <BasicsPanel
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
                  isEditing={isEditMode}
                />
              )}
              {currentSection === 'delivery' && (
                <DeliveryPanel
                  formData={formData}
                  setFormData={setFormData}
                  t={t}
                  urlValidation={urlValidation}
                  setUrlValidation={setUrlValidation}
                  validateContentItemUrl={validateContentItemUrl}
                  products={products}
                  currentProductId={product?.id}
                  hasLicenseIssuance={hasLicenseIssuance}
                  fieldErrors={fieldErrors}
                  setFieldErrors={setFieldErrors}
                />
              )}
              {currentSection === 'cart' && <CartPanel formData={formData} setFormData={setFormData} t={t} />}
              {currentSection === 'schedule' && <EventSection formData={formData} setFormData={setFormData} showErrors={'sessions' in fieldErrors} />}
              {currentSection === 'offer' && (
                <OfferPanel
                  formData={formData}
                  setFormData={setFormData}
                  t={t}
                  onIconSelect={handleIconSelect}
                  allCategories={allCategories}
                  loadingCategories={loadingCategories}
                  allTags={allTags}
                  loadingTags={loadingTags}
                  fieldErrors={fieldErrors}
                  setFieldErrors={setFieldErrors}
                />
              )}
              {currentSection === 'sales' && (
                <SalesPanel
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
            </FormSection>
          </form>
        </ModalBody>

        <BuyerSummary formData={formData} t={t} />

        <WizardFooter
          isFirstSection={sectionIndex === 0}
          isLastSection={sectionIndex === FORM_SECTIONS.length - 1}
          isSubmitting={isSubmitting}
          isEditMode={isEditMode}
          formData={formData}
          priceDisplayValue={priceDisplayValue}
          shopConfigLoaded={shopConfigLoaded}
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
