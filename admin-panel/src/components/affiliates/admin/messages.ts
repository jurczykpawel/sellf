/** A1.2 locale fixtures; central message wiring belongs to A1.8. @see AffiliateAdmin.tsx */
export const affiliateAdminMessages = {
  en: {
    newTermsVersion: 'These terms were already published. Give the changed terms a new version and save again.',
    codeHint: 'Use 3–40 lowercase letters, numbers, hyphens or underscores.', amountInvalid: 'Enter a valid payout amount for each currency. Use a dot or comma for decimals.', reasonRequired: 'Enter a reason before changing this partner’s status.',
    applicationHint: 'Tell us how you plan to promote our products. We review every application.',
    subtitle: 'Review partners and set clear rules for your program.', settings: 'Program settings', settingsHint: 'Terms, payout minimums and waiting periods', currency: 'Currency', addCurrency: 'Add currency', remove: 'Remove',
    timing: 'When commissions become payable', timingHint: 'A commission waits for both the hold and the refund window to end. The buffer adds time after the refund deadline.', termsHint: 'Partners accept the version shown here. Previous accepted terms stay in your history.',
    stateApproved: 'Approved', stateRejected: 'Rejected', stateSuspended: 'Suspended', stateTerminated: 'Terminated', statePending: 'Awaiting review', empty: 'No applications in this view.', approvalReason: 'Application reviewed and approved', reasonHint: 'Required when rejecting, suspending or ending a partnership.',
    title: 'Affiliate program', enabled: 'Program enabled', termsVersion: 'Terms version', termsEn: 'Terms (English)', termsPl: 'Terms (Polish)',
    hold: 'Hold (days)', buffer: 'Refund buffer (days)', thresholds: 'Minimum payout', save: 'Save program',
    applications: 'Partner applications', code: 'Partner code', name: 'Display name', channel: 'Promotion channel', reason: 'Decision reason',
    approved: 'Approve', rejected: 'Reject', suspended: 'Suspend', terminated: 'Terminate', pending: 'Application pending manual approval',
    status: 'Status', history: 'Accepted terms', next: 'Next page', refresh: 'Refresh', all: 'All statuses', apply: 'Apply to program',
    accept: 'I accept these terms', disabled: 'Applications are currently closed.', success: 'Saved.', conflict: 'This record or terms changed, or the code is already used. Refresh before retrying.',
    invalid: 'Check the required fields and try again.', error: 'Unable to complete this request.', limited: 'Too many attempts. Try again later.', unauthorized: 'Sign in with a verified account.', forbidden: 'Access denied.',
  },
  pl: {
    newTermsVersion: 'Ten regulamin został już opublikowany. Nadaj zmienionej treści nową wersję i zapisz ponownie.',
    codeHint: 'Użyj 3–40 małych liter, cyfr, myślników lub podkreśleń.', amountInvalid: 'Wpisz poprawną kwotę wypłaty w każdej walucie. Grosze oddziel przecinkiem lub kropką.', reasonRequired: 'Wpisz powód przed zmianą statusu partnera.',
    applicationHint: 'Opowiedz, jak chcesz promować nasze produkty. Każde zgłoszenie sprawdzamy osobiście.',
    subtitle: 'Sprawdzaj zgłoszenia i ustal jasne zasady współpracy.', settings: 'Ustawienia programu', settingsHint: 'Regulamin, progi wypłat i okresy oczekiwania', currency: 'Waluta', addCurrency: 'Dodaj walutę', remove: 'Usuń',
    timing: 'Kiedy prowizje można wypłacić', timingHint: 'Prowizja czeka na koniec wstrzymania i okresu zwrotów. Bufor wydłuża czas po terminie zwrotu.', termsHint: 'Partnerzy akceptują widoczną tu wersję. Poprzednie zaakceptowane regulaminy zachowujemy w historii.',
    stateApproved: 'Zaakceptowany', stateRejected: 'Odrzucony', stateSuspended: 'Zawieszony', stateTerminated: 'Współpraca zakończona', statePending: 'Czeka na decyzję', empty: 'Brak zgłoszeń w tym widoku.', approvalReason: 'Zgłoszenie sprawdzone i zaakceptowane', reasonHint: 'Wymagany przy odrzuceniu, zawieszeniu i zakończeniu współpracy.',
    title: 'Program partnerski', enabled: 'Program włączony', termsVersion: 'Wersja regulaminu', termsEn: 'Regulamin (angielski)', termsPl: 'Regulamin (polski)',
    hold: 'Okres wstrzymania (dni)', buffer: 'Bufor zwrotów (dni)', thresholds: 'Minimalna wypłata', save: 'Zapisz program',
    applications: 'Zgłoszenia partnerów', code: 'Kod partnera', name: 'Nazwa wyświetlana', channel: 'Kanał promocji', reason: 'Powód decyzji',
    approved: 'Akceptuj', rejected: 'Odrzuć', suspended: 'Zawieś', terminated: 'Zakończ współpracę', pending: 'Zgłoszenie czeka na ręczną akceptację',
    status: 'Status', history: 'Zaakceptowany regulamin', next: 'Następna strona', refresh: 'Odśwież', all: 'Wszystkie statusy', apply: 'Zgłoś się do programu',
    accept: 'Akceptuję ten regulamin', disabled: 'Zgłoszenia są obecnie zamknięte.', success: 'Zapisano.', conflict: 'Dane lub regulamin zmieniły się albo kod jest zajęty. Odśwież przed ponowną próbą.',
    invalid: 'Sprawdź wymagane pola i spróbuj ponownie.', error: 'Nie udało się wykonać operacji.', limited: 'Zbyt wiele prób. Spróbuj później.', unauthorized: 'Zaloguj się na zweryfikowane konto.', forbidden: 'Brak dostępu.',
  },
};
export type AffiliateAdminLocale = keyof typeof affiliateAdminMessages;
