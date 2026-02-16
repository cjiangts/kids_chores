-- Sequences for auto-increment IDs
CREATE SEQUENCE IF NOT EXISTS decks_id_seq;
CREATE SEQUENCE IF NOT EXISTS cards_id_seq;
CREATE SEQUENCE IF NOT EXISTS sessions_id_seq;
CREATE SEQUENCE IF NOT EXISTS session_results_id_seq;
CREATE SEQUENCE IF NOT EXISTS writing_sheets_id_seq;

-- Flashcard decks
CREATE TABLE IF NOT EXISTS decks (
  id INTEGER PRIMARY KEY DEFAULT nextval('decks_id_seq'),
  name VARCHAR NOT NULL,
  description VARCHAR,
  tags VARCHAR[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Flashcards
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY DEFAULT nextval('cards_id_seq'),
  deck_id INTEGER NOT NULL,
  front VARCHAR NOT NULL,
  back VARCHAR NOT NULL,
  skip_practice BOOLEAN NOT NULL DEFAULT FALSE,
  hardness_score DOUBLE NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deck_id) REFERENCES decks(id)
);

-- Writing prompt audio metadata (actual audio files are stored on disk)
CREATE TABLE IF NOT EXISTS writing_audio (
  card_id INTEGER PRIMARY KEY,
  file_name VARCHAR NOT NULL,
  mime_type VARCHAR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

-- Quiz sessions
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY DEFAULT nextval('sessions_id_seq'),
  type VARCHAR NOT NULL,  -- 'flashcard', 'math', or 'writing'
  deck_id INTEGER,
  planned_count INTEGER,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  FOREIGN KEY (deck_id) REFERENCES decks(id)
);

-- Session results
CREATE TABLE IF NOT EXISTS session_results (
  id INTEGER PRIMARY KEY DEFAULT nextval('session_results_id_seq'),
  session_id INTEGER NOT NULL,
  card_id INTEGER,
  correct BOOLEAN NOT NULL,
  response_time_ms INTEGER,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Cursor state for circular practice rotation by deck
CREATE TABLE IF NOT EXISTS practice_state_by_deck (
  deck_id INTEGER PRIMARY KEY,
  queue_cursor INTEGER NOT NULL DEFAULT 0
);

-- Printable writing practice sheets
CREATE TABLE IF NOT EXISTS writing_sheets (
  id INTEGER PRIMARY KEY DEFAULT nextval('writing_sheets_id_seq'),
  status VARCHAR NOT NULL DEFAULT 'pending', -- 'pending' or 'done'
  practice_rows INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS writing_sheet_cards (
  sheet_id INTEGER NOT NULL,
  card_id INTEGER NOT NULL,
  PRIMARY KEY (sheet_id, card_id),
  FOREIGN KEY (sheet_id) REFERENCES writing_sheets(id),
  FOREIGN KEY (card_id) REFERENCES cards(id)
);
