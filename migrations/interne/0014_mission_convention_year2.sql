-- Tarif distinct du cas 2 ; NULL conserve les anciens montants regroupés.
ALTER TABLE mission_conventions ADD COLUMN year2_euros REAL CHECK (year2_euros IS NULL OR (year2_euros >= 0 AND year2_euros <= 100000));
