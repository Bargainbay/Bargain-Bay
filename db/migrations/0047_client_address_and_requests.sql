-- The company address printed under "Invoice for" on a client's invoice.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address text;

UPDATE clients
   SET address = '808 Courtland Ave, Kitchener'
 WHERE (lower(name) LIKE '%canadian discount appliances%' OR lower(name) = 'cda')
   AND address IS NULL;
