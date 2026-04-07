import { Database } from "bun:sqlite";

// macOS ships a SQLite build that doesn't support extensions.
// Use Homebrew's vanilla SQLite instead. On Linux, the system
// SQLite supports extensions out of the box.
if (process.platform === "darwin") {
  Database.setCustomSQLite("/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib");
}
