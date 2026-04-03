export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    google_refresh_token TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES persons(id),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guests (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    contact_type TEXT NOT NULL CHECK(contact_type IN ('email', 'phone')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'revoked')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invite_tokens (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id),
    guest_id TEXT NOT NULL REFERENCES guests(id),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_tokens (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id),
    guest_id TEXT NOT NULL REFERENCES guests(id),
    revoked_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    drive_file_id TEXT NOT NULL,
    title TEXT NOT NULL,
    markdown TEXT,
    status TEXT NOT NULL DEFAULT 'indexing' CHECK(status IN ('indexing', 'ready', 'error')),
    chunk_count INTEGER DEFAULT 0,
    last_synced TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households(id),
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    household_id TEXT UNIQUE NOT NULL REFERENCES households(id),
    chips TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;
