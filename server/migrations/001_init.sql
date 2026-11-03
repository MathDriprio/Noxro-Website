-- NoxroWebsite : schéma initial

-- ---------------------------------------------------------------- utilisateurs
CREATE TABLE users (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE invitations (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  email      text,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  used_by    integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ véhicules
CREATE TYPE vehicle_status AS ENUM ('sur_place', 'en_vue', 'terminee', 'en_vente');

CREATE TABLE vehicles (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  make        text NOT NULL,
  model       text NOT NULL,
  year        smallint CHECK (year BETWEEN 1885 AND 2100),
  plate       text,                -- immatriculation normalisée (majuscules, sans espaces/tirets)
  vin         text,
  engine      text,
  color       text,
  notes       text,
  status      vehicle_status NOT NULL DEFAULT 'sur_place',
  cover_document_id integer,       -- photo principale (FK ajoutée après la table documents)
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz          -- suppression douce
);
-- Unique sur TOUS les véhicules (supprimés compris) pour pouvoir réactiver au lieu de dupliquer.
CREATE UNIQUE INDEX vehicles_plate_uq ON vehicles (plate) WHERE plate IS NOT NULL;
CREATE INDEX vehicles_status_idx ON vehicles (status) WHERE deleted_at IS NULL;

-- Historique des propriétaires. Un véhicule sans propriétaire actif appartient au garage.
CREATE TABLE vehicle_owners (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id integer NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  since      date NOT NULL DEFAULT current_date,
  until      date,                 -- NULL = propriétaire actuel
  CHECK (until IS NULL OR until >= since)
);
CREATE UNIQUE INDEX vehicle_owners_current_uq ON vehicle_owners (vehicle_id, user_id) WHERE until IS NULL;
CREATE INDEX vehicle_owners_user_idx ON vehicle_owners (user_id);

-- ------------------------------------------------- entretiens et réparations
CREATE TYPE intervention_kind   AS ENUM ('entretien', 'reparation');
CREATE TYPE intervention_status AS ENUM ('planifie', 'en_cours', 'termine', 'annule');

CREATE TABLE interventions (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id   integer NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind         intervention_kind NOT NULL,
  category     text,               -- type libre : vidange, freins, pneus...
  title        text NOT NULL,
  description  text,
  status       intervention_status NOT NULL DEFAULT 'planifie',
  planned_date date,
  done_date    date,
  created_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'planifie' OR planned_date IS NOT NULL)
);
CREATE INDEX interventions_vehicle_idx ON interventions (vehicle_id);

-- ----------------------------------------------------------------- transactions
CREATE TYPE transaction_direction AS ENUM ('depense', 'revenu');
CREATE TYPE transaction_category  AS ENUM
  ('piece', 'reparation', 'entretien', 'achat_vehicule', 'vente_vehicule', 'frais_garage', 'autre');

CREATE TABLE transactions (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id      integer REFERENCES vehicles(id) ON DELETE CASCADE,  -- NULL = frais généraux du garage
  intervention_id integer REFERENCES interventions(id) ON DELETE SET NULL,
  direction       transaction_direction NOT NULL DEFAULT 'depense',
  category        transaction_category NOT NULL DEFAULT 'autre',
  label           text NOT NULL,
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  occurred_on     date NOT NULL DEFAULT current_date,
  notes           text,
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transactions_vehicle_idx ON transactions (vehicle_id);
CREATE INDEX transactions_intervention_idx ON transactions (intervention_id);

-- ----------------------------------------------------------------------- tâches
CREATE TYPE task_status   AS ENUM ('a_faire', 'en_cours', 'fait');
CREATE TYPE task_priority AS ENUM ('basse', 'normale', 'haute');

CREATE TABLE tasks (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id  integer REFERENCES vehicles(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  status      task_status NOT NULL DEFAULT 'a_faire',
  priority    task_priority NOT NULL DEFAULT 'normale',
  due_date    date,
  assignee_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_vehicle_idx ON tasks (vehicle_id);

-- -------------------------------------------------------------------- documents
CREATE TYPE document_category AS ENUM ('facture', 'carte_grise', 'photo', 'administratif', 'autre');

CREATE TABLE documents (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  original_name text NOT NULL,
  stored_name   text NOT NULL UNIQUE,
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL,
  category      document_category NOT NULL DEFAULT 'autre',
  title         text,
  uploaded_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Un document peut être lié à plusieurs éléments (ou à aucun : document général du garage).
-- Exactement une cible par ligne.
CREATE TABLE document_links (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id     integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id         integer REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id      integer REFERENCES vehicles(id) ON DELETE CASCADE,
  intervention_id integer REFERENCES interventions(id) ON DELETE CASCADE,
  transaction_id  integer REFERENCES transactions(id) ON DELETE CASCADE,
  task_id         integer REFERENCES tasks(id) ON DELETE CASCADE,
  position        integer NOT NULL DEFAULT 0,
  CHECK (num_nonnulls(user_id, vehicle_id, intervention_id, transaction_id, task_id) = 1)
);
CREATE UNIQUE INDEX document_links_uq ON document_links (
  document_id,
  coalesce(user_id, 0), coalesce(vehicle_id, 0), coalesce(intervention_id, 0),
  coalesce(transaction_id, 0), coalesce(task_id, 0)
);
CREATE INDEX document_links_vehicle_idx ON document_links (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX document_links_intervention_idx ON document_links (intervention_id) WHERE intervention_id IS NOT NULL;
CREATE INDEX document_links_transaction_idx ON document_links (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX document_links_task_idx ON document_links (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX document_links_user_idx ON document_links (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_cover_fk FOREIGN KEY (cover_document_id) REFERENCES documents(id) ON DELETE SET NULL;

-- ------------------------------------------------------------------ commentaires
CREATE TABLE comments (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id       integer REFERENCES users(id) ON DELETE SET NULL,
  body            text NOT NULL,
  vehicle_id      integer REFERENCES vehicles(id) ON DELETE CASCADE,
  intervention_id integer REFERENCES interventions(id) ON DELETE CASCADE,
  transaction_id  integer REFERENCES transactions(id) ON DELETE CASCADE,
  task_id         integer REFERENCES tasks(id) ON DELETE CASCADE,
  document_id     integer REFERENCES documents(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(vehicle_id, intervention_id, transaction_id, task_id, document_id) = 1)
);
CREATE INDEX comments_vehicle_idx ON comments (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX comments_intervention_idx ON comments (intervention_id) WHERE intervention_id IS NOT NULL;
CREATE INDEX comments_transaction_idx ON comments (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX comments_task_idx ON comments (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX comments_document_idx ON comments (document_id) WHERE document_id IS NOT NULL;

-- ------------------------------------------------------- historique interne (logs)
CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,        -- create | update | delete | restore | login ...
  entity_type text NOT NULL,
  entity_id   integer,
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
