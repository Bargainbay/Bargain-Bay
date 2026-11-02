-- Sellers can be paid by Interac e-transfer as well as by bank account.
--
-- An e-transfer payout method lives in the same table as a bank account so it goes through the
-- SAME safety path: owner-only submit, an admin verifies it and attests the name, a 5-day
-- cooling-off when it replaces one already in use, and an email to everyone on the account.
-- It carries an email address instead of institution / transit / account number.
ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS etransfer_email text;

ALTER TABLE vendor_bank_accounts ALTER COLUMN institution DROP NOT NULL;
ALTER TABLE vendor_bank_accounts ALTER COLUMN transit DROP NOT NULL;
ALTER TABLE vendor_bank_accounts ALTER COLUMN account_enc DROP NOT NULL;
ALTER TABLE vendor_bank_accounts ALTER COLUMN account_last4 DROP NOT NULL;

ALTER TABLE vendor_bank_accounts DROP CONSTRAINT IF EXISTS vendor_bank_accounts_method_check;
ALTER TABLE vendor_bank_accounts ADD CONSTRAINT vendor_bank_accounts_method_check
  CHECK (method IN ('direct_deposit','wire','etransfer'));

ALTER TABLE vendor_bank_accounts DROP CONSTRAINT IF EXISTS vendor_bank_accounts_verified_how_check;
ALTER TABLE vendor_bank_accounts ADD CONSTRAINT vendor_bank_accounts_verified_how_check
  CHECK (verified_how IS NULL OR verified_how IN ('void_cheque','bank_letter','test_deposit','etransfer_test'));

-- Each method must carry what it needs: a bank account needs all four bank fields, an
-- e-transfer needs an email. (The column CHECKs above still apply to whatever is present.)
ALTER TABLE vendor_bank_accounts DROP CONSTRAINT IF EXISTS vendor_payout_method_complete;
ALTER TABLE vendor_bank_accounts ADD CONSTRAINT vendor_payout_method_complete CHECK (
  (method = 'etransfer' AND etransfer_email IS NOT NULL AND etransfer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  OR (method <> 'etransfer' AND institution IS NOT NULL AND transit IS NOT NULL
      AND account_enc IS NOT NULL AND account_last4 IS NOT NULL));
