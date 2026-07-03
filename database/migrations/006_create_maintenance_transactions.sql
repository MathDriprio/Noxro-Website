CREATE TABLE
    maintenance_transactions (
        maintenance_id BIGINT NOT NULL,
        transaction_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
        deleted_at TIMESTAMPTZ NULL,
        CONSTRAINT pk_maintenance_transactions PRIMARY KEY (maintenance_id, transaction_id),
        CONSTRAINT fk_maintenance_transactions_maintenance FOREIGN KEY (maintenance_id) REFERENCES maintenances (id) ON DELETE CASCADE,
        CONSTRAINT fk_maintenance_transactions_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE
    );