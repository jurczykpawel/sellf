// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const actions = vi.hoisted(() => ({ applyToProgram: vi.fn(), updateProgram: vi.fn(), updateMember: vi.fn(), getAdminOverview: vi.fn(), getAcceptedTerms: vi.fn(), getAffiliateSyncOverview: vi.fn(), retryAffiliateWork: vi.fn() }));
vi.mock('@/lib/affiliates/admin/actions', () => actions);
vi.mock('@/components/captcha/CaptchaWidget', () => ({ default: ({ onVerify }: { onVerify: (token: string) => void }) => <button type="button" onClick={() => onVerify('solved')}>Solve captcha</button> }));
import { AffiliateApplication, AffiliateAdmin } from '@/components/affiliates/admin/AffiliateAdmin';
import { affiliateAdminMessages } from '@/components/affiliates/admin/messages';
const program = { id: 'dddddddd-0000-4000-a000-000000000000', version: '1', enabled: true, hold_days: 30, buffer_days: 2, terms_version: 'v1', terms: { en: 'English terms', pl: 'Polski regulamin' }, thresholds: { PLN: '10000' } };
const member = { id: program.id, version: '1', status: 'pending', code: 'partner-a', display_name: 'Partner A', channel: '<script>buyer sentinel</script>', accepted_at: '2026-10-01T00:00:00Z', accepted_terms_version: 'v1', created_at: '2026-10-01T00:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); for (const action of Object.values(actions)) action.mockResolvedValue({ success: false, status: 409 }); });
afterEach(cleanup);
it.each(['en', 'pl'] as const)('validates and submits localized application %s, resets consumed captcha on conflict', async locale => {
  const t = affiliateAdminMessages[locale]; render(<AffiliateApplication locale={locale} program={program} />);
  expect(screen.getByText(program.terms[locale])).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t.code), { target: { value: 'partner-a' } }); fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'Partner A' } });
  fireEvent.click(screen.getByLabelText(t.accept)); fireEvent.click(screen.getByText('Solve captcha')); fireEvent.click(screen.getByRole('button', { name: t.apply }));
  await waitFor(() => expect(actions.applyToProgram).toHaveBeenCalledWith(expect.objectContaining({ terms_version: 'v1', accepted: true, captcha_token: 'solved' })));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', t.conflict); expect((screen.getByRole('button', { name: t.apply }) as HTMLButtonElement).disabled).toBe(true);
});
it.each(['en', 'pl'] as const)('keeps program-disabled and completed application states explicit %s', async locale => {
  const t = affiliateAdminMessages[locale]; const { rerender } = render(<AffiliateApplication locale={locale} program={{ ...program, enabled: false }} />); expect(screen.queryByRole('button', { name: t.apply })).toBeNull(); expect(screen.getByText(t.disabled)).toBeTruthy();
  rerender(<AffiliateApplication locale={locale} program={program} />); actions.applyToProgram.mockResolvedValue({ success: true, data: member });
  fireEvent.change(screen.getByLabelText(t.code), { target: { value: 'partner-a' } }); fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'Partner A' } }); fireEvent.click(screen.getByLabelText(t.accept)); fireEvent.click(screen.getByText('Solve captcha')); fireEvent.click(screen.getByRole('button', { name: t.apply }));
  expect(await screen.findByText(t.pending)).toBeTruthy(); expect(screen.queryByRole('button', { name: t.apply })).toBeNull();
});
it.each(['en', 'pl'] as const)('submits program and manual decisions with versions, offers accepted terms %s', async locale => {
  const t = affiliateAdminMessages[locale]; render(<AffiliateAdmin locale={locale} initial={{ program, members: [member], next_cursor: null }} />);
  fireEvent.click(screen.getByText(t.settings));
  fireEvent.click(screen.getByRole('button', { name: t.save })); await waitFor(() => expect(actions.updateProgram).toHaveBeenCalledWith(expect.objectContaining({ version: '1', thresholds: { PLN: '10000' } })));
  fireEvent.click(screen.getByRole('button', { name: t.rejected }));
  fireEvent.change(screen.getByLabelText(t.reason), { target: { value: 'Reviewed' } }); fireEvent.click(screen.getByRole('button', { name: t.rejected })); await waitFor(() => expect(actions.updateMember).toHaveBeenCalledWith({ member_id: member.id, version: '1', status: 'rejected', reason: 'Reviewed' }));
  actions.getAcceptedTerms.mockResolvedValue({ success: true, data: { terms_version: 'v1', terms: program.terms } }); fireEvent.click(screen.getByRole('button', { name: t.history })); expect(await screen.findByText(program.terms[locale])).toBeTruthy();
  expect(document.querySelector('script')).toBeNull(); expect(screen.getByText(member.channel)).toBeTruthy();
});
it('invalid thresholds and blank reason never call server actions', async () => {
  const t = affiliateAdminMessages.en; render(<AffiliateAdmin locale="en" initial={{ program, members: [member], next_cursor: null }} />);
  fireEvent.click(screen.getByText(t.settings));
  fireEvent.change(screen.getByRole('textbox', { name: new RegExp(new Intl.DisplayNames(['en'], { type: 'currency' }).of('PLN')!) }), { target: { value: '1.001' } }); fireEvent.click(screen.getByRole('button', { name: t.save })); expect(actions.updateProgram).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: t.rejected })); expect(actions.updateMember).not.toHaveBeenCalled();
});

it('approves a reviewed application in one click with an explicit audit reason', async () => {
  const t = affiliateAdminMessages.en; render(<AffiliateAdmin locale="en" initial={{ program, members: [member], next_cursor: null }} />);
  fireEvent.click(screen.getByRole('button', { name: t.approved })); await waitFor(() => expect(actions.updateMember).toHaveBeenCalledWith(expect.objectContaining({ reason: t.approvalReason })));
});

it.each(['en', 'pl'] as const)('shows only current-status actions and reveals a reason on demand %s', async locale => {
  const t = affiliateAdminMessages[locale];
  for (const [status, visible, hidden] of [
    ['pending', [t.approved, t.rejected], [t.suspended, t.terminated, t.restore]],
    ['approved', [t.suspended, t.terminated], [t.approved, t.rejected, t.restore]],
    ['suspended', [t.restore, t.terminated], [t.approved, t.rejected, t.suspended]],
    ['rejected', [], [t.approved, t.rejected, t.suspended, t.terminated, t.restore]],
    ['terminated', [], [t.approved, t.rejected, t.suspended, t.terminated, t.restore]],
  ] as const) {
    const view = render(<AffiliateAdmin locale={locale} initial={{ program, members: [{ ...member, status }], next_cursor: null }} />);
    for (const name of visible) expect(screen.getByRole('button', { name, exact: true })).toBeTruthy();
    for (const name of hidden) expect(screen.queryByRole('button', { name, exact: true })).toBeNull();
    expect(screen.queryByLabelText(t.reason)).toBeNull();
    if (status === 'pending' || status === 'approved' || status === 'suspended') {
      fireEvent.click(screen.getByRole('button', { name: status === 'pending' ? t.rejected : t.terminated }));
      expect(screen.getByLabelText(t.reason)).toBeTruthy(); expect(actions.updateMember).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: t.cancel })); expect(screen.queryByLabelText(t.reason)).toBeNull();
    }
    view.unmount();
  }
});
it('restores a suspended partner with a distinct audit reason in one click', async () => {
  const t = affiliateAdminMessages.en; render(<AffiliateAdmin locale="en" initial={{ program, members: [{ ...member, status: 'suspended' }], next_cursor: null }} />);
  fireEvent.click(screen.getByRole('button', { name: t.restore })); await waitFor(() => expect(actions.updateMember).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', reason: t.restoreReason })));
});

it.each(['en', 'pl'] as const)('keeps application values and identifies an invalid code in %s', async locale => {
  const t = affiliateAdminMessages[locale]; render(<AffiliateApplication locale={locale} program={program} />);
  fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'Anna Partner' } });
  fireEvent.change(screen.getByLabelText(t.code), { target: { value: 'Anna Test!' } });
  fireEvent.change(screen.getByLabelText(t.channel), { target: { value: 'Newsletter' } });
  fireEvent.click(screen.getByLabelText(t.accept)); fireEvent.click(screen.getByText('Solve captcha'));
  fireEvent.submit(screen.getByRole('button', { name: t.apply }).closest('form')!);
  await waitFor(() => expect(screen.getByLabelText(t.code).getAttribute('aria-invalid')).toBe('true'));
  expect((screen.getByLabelText(t.name) as HTMLInputElement).value).toBe('Anna Partner');
  expect((screen.getByLabelText(t.channel) as HTMLInputElement).value).toBe('Newsletter');
  expect((screen.getByLabelText(t.accept) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('button', { name: t.apply }) as HTMLButtonElement).disabled).toBe(false);
  expect(actions.applyToProgram).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(t.code), { target: { value: 'anna-test' } });
  fireEvent.submit(screen.getByRole('button', { name: t.apply }).closest('form')!);
  await waitFor(() => expect(actions.applyToProgram).toHaveBeenCalled());
});

it.each(['en', 'pl'] as const)('shows the saved pending application after a refresh in %s', locale => {
  const t = affiliateAdminMessages[locale];
  render(<AffiliateApplication locale={locale} program={{ ...program, applicationStatus: 'pending' }} />);
  expect(screen.getByRole('status').textContent).toContain(t.pending);
  expect(screen.queryByRole('button', { name: t.apply })).toBeNull();
  expect(screen.getByRole('link').getAttribute('href')).toContain('/my-affiliate');
});

it('shows the applicant email on the application card', () => {
  render(<AffiliateAdmin locale="en" initial={{ program, members: [{ ...member, email: 'partner@example.com' }], next_cursor: null }} />);
  expect(screen.getByText('partner@example.com')).toBeTruthy();
});
