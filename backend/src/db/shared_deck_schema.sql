CREATE SEQUENCE IF NOT EXISTS shared_deck_id_seq;
CREATE SEQUENCE IF NOT EXISTS shared_card_id_seq;

CREATE TABLE IF NOT EXISTS deck (
  deck_id INTEGER PRIMARY KEY DEFAULT nextval('shared_deck_id_seq'),
  name VARCHAR NOT NULL UNIQUE,
  tags VARCHAR[] NOT NULL DEFAULT [],
  creator_family_id INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deck_category (
  category_key VARCHAR PRIMARY KEY,
  behavior_type VARCHAR NOT NULL,
  has_chinese_specific_logic BOOLEAN NOT NULL DEFAULT FALSE,
  is_shared_with_non_super_family BOOLEAN NOT NULL DEFAULT FALSE,
  display_name VARCHAR,
  emoji VARCHAR
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY DEFAULT nextval('shared_card_id_seq'),
  deck_id INTEGER NOT NULL,
  front VARCHAR NOT NULL,
  back VARCHAR NOT NULL,
  UNIQUE (deck_id, front)
);

CREATE TABLE IF NOT EXISTS deck_generator_definition (
  deck_id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  is_multichoice_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cards_deck_id_front ON cards(deck_id, front);
