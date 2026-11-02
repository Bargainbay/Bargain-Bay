-- A client company had an email and a phone but no PERSON, and nothing on any
-- screen could edit them once added. Canadian Discount Appliances' contact is
-- Matt Graham; this fills it in where the company already exists. It only
-- UPDATES — a migration that seeds rows would make a fresh database non-empty.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_name text;

UPDATE clients
   SET contact_name  = 'Matt Graham',
       contact_email = 'Matt@grahams.ca',
       contact_phone = '(519) 658-3409'
 WHERE lower(name) LIKE '%canadian discount appliances%'
    OR lower(name) = 'cda';
