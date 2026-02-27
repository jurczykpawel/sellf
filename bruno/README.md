# Sellf API - Bruno Collection

Kolekcja requestów API dla [Bruno](https://www.usebruno.com/).

## Instalacja

1. Zainstaluj Bruno: https://www.usebruno.com/downloads
2. Otwórz Bruno → Open Collection → wybierz folder `bruno/`

## Konfiguracja

1. Utwórz API key w panelu admina: `/dashboard/api-keys`
2. Edytuj `environments/local.bru` i wstaw swój klucz:
   ```
   API_KEY: gf_live_TWOJ_KLUCZ
   ```
3. Wybierz środowisko "local" w Bruno

## Struktura

```
bruno/
├── environments/
│   └── local.bru          # localhost:3000
├── products/
│   ├── List Products.bru
│   ├── Get Product.bru
│   └── Create Product.bru
├── users/
│   └── List Users.bru
├── analytics/
│   └── Dashboard.bru
├── coupons/
│   ├── List Coupons.bru
│   └── Create Coupon.bru
├── api-keys/
│   ├── List API Keys.bru
│   └── Create API Key.bru
├── webhooks/
│   └── List Webhooks.bru
└── system/
    └── Status.bru
```

## Dostępne Scopes

| Scope | Opis |
|-------|------|
| `*` | Pełen dostęp |
| `products:read` | Odczyt produktów |
| `products:write` | Zapis produktów |
| `users:read` | Odczyt użytkowników |
| `users:write` | Zarządzanie dostępem |
| `coupons:read` | Odczyt kuponów |
| `coupons:write` | Zapis kuponów |
| `analytics:read` | Odczyt analityki |
| `webhooks:read` | Odczyt webhooków |
| `webhooks:write` | Zarządzanie webhookami |
