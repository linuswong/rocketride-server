-- NON-DEPLOYABLE schema experiment. SQLite requires foreign_keys ON on EVERY
-- connection. This schema does not authenticate or authorize its callers.
PRAGMA foreign_keys = ON;
CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, configuration_ref TEXT);
CREATE TABLE tickets (
  id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id),
  customer_ref TEXT NOT NULL, subject TEXT NOT NULL, description TEXT NOT NULL,
  status TEXT NOT NULL, category TEXT NOT NULL, priority TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  UNIQUE (organization_id, id)
);
CREATE INDEX tickets_org_created ON tickets(organization_id, created_at, id);
CREATE TABLE investigations (
  id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, ticket_id TEXT NOT NULL,
  pipeline_ref TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
  FOREIGN KEY (organization_id, ticket_id) REFERENCES tickets(organization_id, id),
  UNIQUE (organization_id, id)
);
CREATE INDEX investigations_ticket ON investigations(organization_id, ticket_id);
CREATE TRIGGER investigation_binding_immutable BEFORE UPDATE OF organization_id, ticket_id ON investigations
WHEN NEW.organization_id <> OLD.organization_id OR NEW.ticket_id <> OLD.ticket_id
BEGIN SELECT RAISE(ABORT, 'investigation binding is immutable'); END;
CREATE TABLE evidence_metadata (
  id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, investigation_id TEXT NOT NULL,
  source_tool TEXT NOT NULL, reference TEXT NOT NULL, collected_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, investigation_id) REFERENCES investigations(organization_id, id)
);
PRAGMA user_version = 1;
