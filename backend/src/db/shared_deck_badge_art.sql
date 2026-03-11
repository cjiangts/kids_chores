-- Badge art catalog lives in shared_decks DB so all kids/families reuse one source of truth.
-- The shipped catalog is intentionally minimal here. Active Noto badge assets are registered
-- dynamically from frontend/assets/badges-noto by shared_deck_db._sync_noto_badge_bank().
CREATE SEQUENCE IF NOT EXISTS badge_art_id_seq;

CREATE TABLE IF NOT EXISTS badge_art (
  badge_art_id INTEGER PRIMARY KEY DEFAULT nextval('badge_art_id_seq'),
  theme_key VARCHAR NOT NULL CHECK (
    theme_key IN ('starter', 'characters', 'writing', 'math', 'reading', 'gold', 'streak', 'effort', 'all', 'generic')
  ),
  image_path VARCHAR NOT NULL UNIQUE,
  source_url VARCHAR NOT NULL,
  license VARCHAR NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_badge_art_theme_active
  ON badge_art(theme_key, is_active, badge_art_id);
