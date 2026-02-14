-- Flashcard decks
CREATE TABLE IF NOT EXISTS decks (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  description VARCHAR,
  tags VARCHAR[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Flashcards
CREATE TABLE IF NOT EXISTS cards (
  id VARCHAR PRIMARY KEY,
  deck_id VARCHAR NOT NULL,
  front VARCHAR NOT NULL,
  back VARCHAR NOT NULL,
  front_lang VARCHAR,  -- 'en' or 'zh'
  back_lang VARCHAR,   -- 'en' or 'zh'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deck_id) REFERENCES decks(id)
);

-- Quiz sessions
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR PRIMARY KEY,
  type VARCHAR NOT NULL,  -- 'flashcard' or 'math'
  deck_id VARCHAR,
  planned_count INTEGER,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  FOREIGN KEY (deck_id) REFERENCES decks(id)
);

-- Session results
CREATE TABLE IF NOT EXISTS session_results (
  id VARCHAR PRIMARY KEY,
  session_id VARCHAR NOT NULL,
  card_id VARCHAR,
  question VARCHAR,
  user_answer VARCHAR,
  correct BOOLEAN NOT NULL,
  response_time_ms INTEGER,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Persistent FIFO circular queue for practice order
CREATE TABLE IF NOT EXISTS practice_queue (
  deck_id VARCHAR NOT NULL,
  card_id VARCHAR PRIMARY KEY,
  queue_order BIGINT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

-- Queue cursor state by deck
CREATE TABLE IF NOT EXISTS practice_state_by_deck (
  deck_id VARCHAR PRIMARY KEY,
  queue_cursor INTEGER NOT NULL DEFAULT 0
);
