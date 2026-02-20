CREATE SEQUENCE IF NOT EXISTS shared_deck_id_seq;
CREATE SEQUENCE IF NOT EXISTS shared_card_event_id_seq;
-- NOTE: card_action enum is created in shared_math_deck_db.py for idempotency across DuckDB versions.

CREATE TABLE IF NOT EXISTS deck (
  deck_id INTEGER PRIMARY KEY DEFAULT nextval('shared_deck_id_seq'),
  name VARCHAR NOT NULL,
  tags VARCHAR[] NOT NULL DEFAULT [],
  creator_family_id INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY DEFAULT nextval('shared_card_event_id_seq'),
  deck_id INTEGER NOT NULL,
  front VARCHAR NOT NULL,
  back VARCHAR NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  action card_action NOT NULL,
  FOREIGN KEY (deck_id) REFERENCES deck(deck_id)
);

CREATE INDEX IF NOT EXISTS idx_cards_deck_id_timestamp ON cards(deck_id, timestamp);
