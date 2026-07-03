CREATE TABLE
    users_vehicles (
        user_id BIGINT NOT NULL,
        vehicle_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
        deleted_at TIMESTAMPTZ NULL,
        CONSTRAINT pk_users_vehicles PRIMARY KEY (user_id, vehicle_id),
        CONSTRAINT fk_users_vehicles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_users_vehicles_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
    );