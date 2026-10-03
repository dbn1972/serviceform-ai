-- CMP-037 webhook routing table (PLAN-REVIEW Q1; SECURITY-PRECHECK P-005-1; ADR-0006).
-- PLATFORM_OPERATIONAL: SELECT USING true so a webhook can resolve tenant without SECURITY DEFINER.
-- DML granted to sf_cmp037_rw only (not sf_app). No UPDATE/DELETE.

-- Up Migration

-- sf:isolation sf_integration_hub.webhook_route PLATFORM_OPERATIONAL owner=CMP-037
CREATE TABLE sf_integration_hub.webhook_route (
  binding_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  FOREIGN KEY (tenant_id, binding_id)
    REFERENCES sf_integration_hub.connector_binding (tenant_id, connector_binding_id)
);
ALTER TABLE sf_integration_hub.webhook_route ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_integration_hub.webhook_route FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_route_select ON sf_integration_hub.webhook_route
  FOR SELECT TO sf_app USING (true);
CREATE POLICY webhook_route_insert ON sf_integration_hub.webhook_route
  FOR INSERT TO sf_app WITH CHECK (tenant_id = sf_platform.current_tenant_id());

GRANT SELECT, INSERT ON sf_integration_hub.webhook_route TO sf_cmp037_rw;
REVOKE ALL ON sf_integration_hub.webhook_route FROM PUBLIC;
ALTER TABLE sf_integration_hub.webhook_route OWNER TO sf_migrator;

-- Down Migration
DROP TABLE IF EXISTS sf_integration_hub.webhook_route;
