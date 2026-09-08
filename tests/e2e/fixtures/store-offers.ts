// Dedicated local E2E values. Never import this file from application code;
// production promotion codes stay in server-only runtime configuration.
export const E2E_BONUS_CODE = 'E2E_ONLY_TWO_MONTHS';
export const E2E_TEST_OFFER_EMAIL = 'e2e-promo-test@example.test';
export const E2E_STORE_OFFER_ENV = {
  STORE_BILLING_BONUS_CODE: E2E_BONUS_CODE,
  STORE_BILLING_TEST_EMAILS: E2E_TEST_OFFER_EMAIL,
  STRIPE_PRICE_USD_MONTH: 'price_e2e_usd_month',
  STRIPE_PRICE_USD_YEAR: 'price_e2e_usd_year',
  STRIPE_PRICE_CAD_MONTH: 'price_e2e_cad_month',
  STRIPE_PRICE_CAD_YEAR: 'price_e2e_cad_year',
  STRIPE_PRICE_CAD_TEST_MONTH: 'price_e2e_cad_test_month',
};
