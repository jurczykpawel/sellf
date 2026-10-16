import React, { useEffect } from 'react';
export const applyToProgram = async () => ({ success: true });
export const updateProgram = async () => ({ success: false, status: 409 });
export const updateMember = async () => ({ success: false, status: 409 });
export const getAcceptedTerms = async () => ({ success: false, status: 404 });
export const getAdminOverview = async () => ({ success: false, status: 500 });
export default function Captcha({ onVerify }: { onVerify: (token: string) => void }) {
  useEffect(() => onVerify('browser-fixture'), [onVerify]);
  return <p className="text-sm text-sf-body">{document.documentElement.lang === 'pl' ? 'Weryfikacja bezpieczeństwa zakończona' : 'Security verification complete'}</p>;
}
