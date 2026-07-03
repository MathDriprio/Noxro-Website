CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS
$$
BEGIN
    -- On force updated_at à l'heure actuelle à chaque UPDATE
    NEW.updated_at = NOW();

    RETURN NEW;
END;
$$
LANGUAGE plpgsql;