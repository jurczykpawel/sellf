/** Local product settings copy; app wiring belongs to A1.8. @see Settings.tsx */
export const productAffiliateMessages = {
  en: {
    title: 'Affiliate commission', enabled: 'Enabled', percentage: 'Percentage', fixed: 'Fixed amount',
    bps: 'Commission (%)', minor: 'Commission amount', currency: 'Currency', type: 'Commission type',
    save: 'Save commission', loading: 'Loading…', saved: 'Saved. Product details are saved separately.',
    error: 'Could not load or save settings. Try again using Reload settings.', invalid: 'Check the commission fields.',
    conflict: 'Changed elsewhere. Reload settings before saving again.', reload: 'Reload settings',
    subscription: 'Subscriptions earn no commission in Phase 1.',
    unlimited: 'Unlimited refunds: commissions stay on hold and never become payable automatically.',
    policy: 'Set what your partner earns per purchase. Waiting periods follow your program settings; previous purchases keep their original commission.',
    owner: 'Coupon affiliate owner', partner: 'Approved partner', choose: 'Search partners by name…', assign: 'Assign coupon',
    invalidOwner: 'Choose an approved partner. If their status changed, reload settings.', noPartners: 'No approved partners yet. Approve an application in Affiliates first.', current: 'Assigned to', next: 'More results', searching: 'Searching…', archive: 'Archive (keep history)',
  },
  pl: {
    title: 'Prowizja partnerska', enabled: 'Włączona', percentage: 'Procentowa', fixed: 'Stała kwota',
    bps: 'Prowizja (%)', minor: 'Kwota prowizji', currency: 'Waluta', type: 'Typ prowizji',
    save: 'Zapisz prowizję', loading: 'Ładowanie…', saved: 'Zapisano. Szczegóły produktu zapiszesz osobno.',
    error: 'Nie udało się wczytać lub zapisać ustawień. Wybierz Wczytaj ponownie i spróbuj jeszcze raz.', invalid: 'Sprawdź pola prowizji.',
    conflict: 'Ustawienia zmieniono gdzie indziej. Wczytaj je ponownie przed zapisem.', reload: 'Wczytaj ponownie',
    subscription: 'Subskrypcje nie naliczają prowizji w fazie 1.',
    unlimited: 'Bezterminowe zwroty: prowizje pozostają wstrzymane i nie będą automatycznie gotowe do wypłaty.',
    policy: 'Ustal zarobek partnera za zakup. Czas oczekiwania wynika z ustawień programu; wcześniejsze zakupy zachowują pierwotną prowizję.',
    owner: 'Partner przypisany do kuponu', partner: 'Zatwierdzony partner', choose: 'Szukaj partnera po nazwie…', assign: 'Przypisz kupon',
    invalidOwner: 'Wybierz zatwierdzonego partnera. Jeśli zmienił się jego status, wczytaj ustawienia ponownie.', noPartners: 'Brak zatwierdzonych partnerów. Najpierw zaakceptuj zgłoszenie w sekcji Partnerzy.', current: 'Przypisany partner', next: 'Więcej wyników', searching: 'Szukanie…', archive: 'Archiwizuj (zachowaj historię)',
  },
} as const;
