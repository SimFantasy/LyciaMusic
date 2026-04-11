// music/types.rs - 数据结构定义

use serde::Serialize;
use tokio::sync::Semaphore;

/// 并发控制状态
pub struct ImageConcurrencyLimit(pub Semaphore);

#[derive(Serialize, Clone, Debug)]
pub struct Song {
    pub id: Option<i64>, // 数据库主键 (新增用于行为统计关联)
    pub name: String,
    pub title: String,
    pub path: String,
    pub artist: String,
    pub artist_names: Vec<String>,
    pub effective_artist_names: Vec<String>,
    pub album: String,
    pub album_artist: String,
    pub album_key: String,
    pub is_various_artists_album: bool,
    pub collapse_artist_credits: bool,
    pub duration: u32,
    pub bitrate: u32,
    pub sample_rate: u32,
    pub bit_depth: Option<u8>,
    pub format: String,
    pub container: Option<String>,
    pub codec: Option<String>,
    pub file_size: u64,
    pub added_at: Option<u64>,
    pub file_modified_at: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct LibrarySong {
    pub id: Option<i64>,
    pub name: String,
    pub title: String,
    pub path: String,
    pub artist: String,
    pub artist_names: Vec<String>,
    pub effective_artist_names: Vec<String>,
    pub album: String,
    pub album_artist: String,
    pub album_key: String,
    pub is_various_artists_album: bool,
    pub collapse_artist_credits: bool,
    pub duration: u32,
    pub bitrate: u32,
    pub sample_rate: u32,
    pub bit_depth: Option<u8>,
    pub format: String,
    pub added_at: Option<u64>,
    pub file_modified_at: Option<u64>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct SongDetail {
    pub path: String,
    pub genre: Option<String>,
    pub year: Option<String>,
    pub comment: Option<String>,
    pub container: Option<String>,
    pub codec: Option<String>,
    pub file_size: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ArtistCatalogItem {
    pub name: String,
    pub count: u32,
    pub first_song_path: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct AlbumCatalogItem {
    pub key: String,
    pub name: String,
    pub count: u32,
    pub artist: String,
    pub first_song_path: String,
}

#[derive(Serialize)]
pub struct GeneratedFolder {
    pub name: String,
    pub path: String,
    pub songs: Vec<Song>,
}

#[derive(Serialize, Clone, Debug)]
pub struct FolderNode {
    pub name: String,
    pub path: String,
    pub children: Vec<FolderNode>,
    pub child_count: usize,
    pub children_loaded: bool,
    pub song_count: usize,
    pub cover_song_path: Option<String>,
    pub is_expanded: bool,
}

#[derive(Serialize)]
pub struct LibraryFolder {
    pub path: String,
    pub song_count: usize,
}
