export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
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

  CREATE TABLE IF NOT EXISTS session_tokens (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id),
    guest_id TEXT NOT NULL REFERENCES guests(id),
    revoked_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    provider TEXT NOT NULL DEFAULT 'google_drive',
    refresh_token TEXT NOT NULL,
    email TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    connection_id TEXT REFERENCES connections(id),
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
    heading TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    household_id TEXT UNIQUE NOT NULL REFERENCES households(id),
    chips TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_pins (
    id TEXT PRIMARY KEY,
    pin TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner', 'guest')),
    person_id TEXT NOT NULL REFERENCES persons(id),
    household_id TEXT NOT NULL REFERENCES households(id),
    guest_id TEXT REFERENCES guests(id),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS household_members (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    person_id TEXT NOT NULL REFERENCES persons(id),
    role TEXT NOT NULL CHECK(role IN ('owner')),
    created_at TEXT NOT NULL,
    UNIQUE(household_id, person_id)
  );
`;
