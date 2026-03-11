-- Global achievement-to-art binding.
-- Keeps art assignment stable across kids: same achievement => same badge_art_id.
CREATE TABLE IF NOT EXISTS achievement_badge_art (
  achievement_key VARCHAR NOT NULL,
  category_key VARCHAR NOT NULL DEFAULT '', -- '' = non-category-specific achievement
  badge_art_id INTEGER NOT NULL,
  PRIMARY KEY (achievement_key, category_key)
);
