use rusqlite::Connection;

pub(crate) fn configure_connection(conn: &Connection) -> Result<(), String> {
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "temp_store", "MEMORY")
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn ensure_base_schema(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            title TEXT,
            artist TEXT,
            artist_names TEXT,
            effective_artist_names TEXT,
            album TEXT,
            album_artist TEXT,
            album_key TEXT,
            is_various_artists_album INTEGER DEFAULT 0,
            collapse_artist_credits INTEGER DEFAULT 0,
            duration INTEGER,
            cover_path TEXT,
            bitrate INTEGER,
            sample_rate INTEGER,
            bit_depth INTEGER,
            format TEXT,
            container TEXT,
            codec TEXT,
            file_size INTEGER,
            track_number TEXT,
            disc_number TEXT,
            added_at INTEGER,
            file_modified_at INTEGER
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS artists (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            avatar_path TEXT
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS song_artists (
            song_id INTEGER NOT NULL,
            artist_id INTEGER NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (song_id, artist_id),
            FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE,
            FOREIGN KEY(artist_id) REFERENCES artists(id) ON DELETE CASCADE
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_song_artists_artist_id ON song_artists(artist_id)",
        [],
    )
    .ok();

    conn.execute(
        "CREATE TABLE IF NOT EXISTS library_folders (
            path TEXT PRIMARY KEY,
            added_at INTEGER
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS sidebar_folders (
            path TEXT PRIMARY KEY,
            added_at INTEGER
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS play_history (
            id INTEGER PRIMARY KEY,
            song_path TEXT NOT NULL,
            played_at INTEGER NOT NULL,
            event TEXT DEFAULT 'play'
        )",
        [],
    )
    .ok();

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_songs_added_at ON songs(added_at)",
        [],
    )
    .ok();
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_songs_album_key ON songs(album_key)",
        [],
    )
    .ok();
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_songs_album_artist ON songs(album_artist)",
        [],
    )
    .ok();
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at)",
        [],
    )
    .ok();

    Ok(())
}
