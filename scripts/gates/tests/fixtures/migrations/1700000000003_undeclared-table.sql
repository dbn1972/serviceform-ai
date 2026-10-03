-- Up Migration
CREATE TABLE example.undeclared (id uuid PRIMARY KEY);
-- Down Migration
DROP TABLE example.undeclared;
