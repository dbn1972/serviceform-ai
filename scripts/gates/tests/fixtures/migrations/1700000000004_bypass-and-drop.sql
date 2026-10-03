-- Up Migration
ALTER ROLE sf_app BYPASSRLS;
ALTER TABLE example.thing NO FORCE ROW LEVEL SECURITY;
DROP TABLE example.old;
-- Down Migration
SELECT 1;
