-- Kid-local badge awards. One table per kid DB.
CREATE SEQUENCE IF NOT EXISTS kid_badge_award_id_seq;

CREATE TABLE IF NOT EXISTS kid_badge_award (
  award_id INTEGER PRIMARY KEY DEFAULT nextval('kid_badge_award_id_seq'),
  achievement_key VARCHAR NOT NULL,
  category_key VARCHAR NOT NULL DEFAULT '', -- '' = global achievement
  badge_art_id INTEGER NOT NULL, -- app-level reference to shared_decks.badge_art
  reason_text VARCHAR NOT NULL,
  evidence_json VARCHAR NOT NULL,
  awarded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  celebration_seen_at TIMESTAMP,
  UNIQUE (achievement_key, category_key)
);

CREATE INDEX IF NOT EXISTS idx_kid_badge_award_awarded_at
  ON kid_badge_award(awarded_at, award_id);

CREATE INDEX IF NOT EXISTS idx_kid_badge_award_celebration
  ON kid_badge_award(celebration_seen_at, awarded_at);
