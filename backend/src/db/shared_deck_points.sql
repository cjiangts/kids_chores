CREATE SEQUENCE IF NOT EXISTS point_rule_id_seq;

CREATE TABLE IF NOT EXISTS point_rule (
  rule_id INTEGER PRIMARY KEY DEFAULT nextval('point_rule_id_seq'),
  family_id INTEGER NOT NULL,
  name VARCHAR NOT NULL,
  emoji VARCHAR,
  rule_kind VARCHAR NOT NULL,
  trigger_key VARCHAR,
  points_delta INTEGER,
  rating_1_points INTEGER,
  rating_2_points INTEGER,
  rating_3_points INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE point_rule ADD COLUMN IF NOT EXISTS trigger_key VARCHAR;

DROP TABLE IF EXISTS point_rule_app_trigger;

CREATE INDEX IF NOT EXISTS idx_point_rule_family_kind ON point_rule(family_id, rule_kind);
CREATE INDEX IF NOT EXISTS idx_point_rule_family_trigger ON point_rule(family_id, rule_kind, trigger_key);
