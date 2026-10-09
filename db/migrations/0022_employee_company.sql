-- Which company an employee works for, so the team clock can show Bargain Bay
-- and RS Solutions together and still tell them apart. Nullable: existing rows
-- and anyone not yet sorted stay valid and show as "Unassigned".
ALTER TABLE employees ADD COLUMN IF NOT EXISTS company text
  CHECK (company IS NULL OR company IN ('bargain_bay','rs_solutions'));
