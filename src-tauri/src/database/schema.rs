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
            cover_thumb_path TEXT,
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
        "CREATE TABLE IF NOT EXISTS statistics_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS global_stats (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            total_play_count INTEGER NOT NULL DEFAULT 0,
            total_play_time_ms INTEGER NOT NULL DEFAULT 0,
            first_played_at TEXT,
            last_played_at TEXT
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS song_stats (
            id INTEGER PRIMARY KEY,
            strict_identity_key TEXT NOT NULL UNIQUE,
            title TEXT,
            artist TEXT,
            album TEXT,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            track_number INTEGER,
            play_count INTEGER NOT NULL DEFAULT 0,
            play_time_ms INTEGER NOT NULL DEFAULT 0,
            full_play_count INTEGER NOT NULL DEFAULT 0,
            skip_count INTEGER NOT NULL DEFAULT 0,
            first_played_at TEXT,
            last_played_at TEXT
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS daily_stats (
            date TEXT PRIMARY KEY,
            play_count INTEGER NOT NULL DEFAULT 0,
            play_time_ms INTEGER NOT NULL DEFAULT 0,
            unique_songs INTEGER NOT NULL DEFAULT 0,
            unique_artists INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS hourly_stats (
            hour INTEGER PRIMARY KEY,
            play_count INTEGER NOT NULL DEFAULT 0,
            play_time_ms INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS daily_unique_song_entries (
            date TEXT NOT NULL,
            song_identity_key TEXT NOT NULL,
            PRIMARY KEY (date, song_identity_key)
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS daily_unique_artist_entries (
            date TEXT NOT NULL,
            artist_key TEXT NOT NULL,
            PRIMARY KEY (date, artist_key)
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS recent_plays (
            id INTEGER PRIMARY KEY,
            recent_dedupe_key TEXT NOT NULL UNIQUE,
            played_at TEXT NOT NULL,
            title TEXT,
            artist TEXT,
            album TEXT,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            listened_ms INTEGER NOT NULL DEFAULT 0,
            is_full_play INTEGER NOT NULL DEFAULT 0,
            is_skip INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS imported_exports_log (
            export_id TEXT PRIMARY KEY,
            imported_at TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

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
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_song_stats_play_count ON song_stats(play_count DESC)",
        [],
    )
    .ok();
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_song_stats_play_time_ms ON song_stats(play_time_ms DESC)",
        [],
    )
    .ok();
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_recent_plays_played_at ON recent_plays(played_at DESC)",
        [],
    )
    .ok();

    Ok(())
}
