-- Vehicles table indexes
CREATE INDEX idx_vehicles_brand_model ON vehicles (brand, model);

CREATE INDEX idx_vehicles_license_plate ON vehicles (license_plate);

-- Maintenance table indexes
CREATE INDEX idx_maintenances_vehicle ON maintenances (vehicle_id);

CREATE INDEX idx_maintenances_performed_at ON maintenances (performed_at DESC);

CREATE INDEX idx_maintenances_vehicle_date ON maintenances (vehicle_id, performed_at DESC);

-- Transactions table indexes
CREATE INDEX idx_transactions_vehicle ON transactions (vehicle_id);

CREATE INDEX idx_transactions_vehicle_date ON transactions (vehicle_id, occurred_at DESC);

CREATE INDEX idx_transactions_date ON transactions (occurred_at DESC);

-- Tasks table indexes
CREATE INDEX idx_tasks_vehicle ON tasks (vehicle_id);

CREATE INDEX idx_tasks_status ON tasks (status);

CREATE INDEX idx_tasks_due_date ON tasks (due_date);

-- Logs table indexes
CREATE INDEX idx_comments_owner ON comments (owner_type, owner_id);

CREATE INDEX idx_comments_user ON comments (created_by_user_id);

-- Documents table indexes
CREATE INDEX idx_documents_owner ON documents (owner_type, owner_id);

CREATE INDEX idx_documents_mime ON documents (mime_type);

-- Logs table indexes
CREATE INDEX idx_logs_user ON logs (user_id);

CREATE INDEX idx_logs_entity ON logs (entity_type, entity_id);

CREATE INDEX idx_logs_action ON logs (action);

CREATE INDEX idx_logs_created_at ON logs (created_at DESC);