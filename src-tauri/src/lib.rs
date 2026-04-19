mod app_runtime;
mod database;
pub mod error;
mod foreground_window;
mod music;
mod player;
mod statistics;
mod system_fonts;
mod toolbox;
mod window_boundary;
mod window_material;
mod window_theme;
mod window_z_order;

use app_runtime::{consume_pending_open_paths, handle_single_instance, setup_app};
use database::clear_all_app_data;
use foreground_window::get_foreground_fullscreen_state;
use music::{
    add_library_folder, add_sidebar_folder, batch_move_music_files, create_folder, delete_folder,
    delete_music_file, get_folder_children, get_folder_first_song, get_library_album_catalog,
    get_library_artist_catalog, get_library_folders, get_library_hierarchy,
    get_library_song_paths_by_album, get_library_song_paths_by_artist,
    get_library_song_paths_for_all_view, get_library_song_paths_for_folder_view,
    get_library_songs_cached, get_sidebar_folders, get_sidebar_hierarchy, get_song_cover,
    get_song_cover_thumbnail, get_song_detail, get_song_lyrics, is_directory,
    move_file_to_folder, move_music_file, parse_audio_files, remove_library_folder,
    remove_sidebar_folder,
    scan_folder_as_playlists, scan_library, scan_music_folder, show_in_folder,
    clear_cover_cache,
};
use player::{
    get_current_output_device, get_output_devices, get_playback_progress, pause_audio, play_audio,
    resume_audio, seek_audio, set_output_device, set_volume, update_playback_metadata,
};
use statistics::{
    add_to_history, clear_recent_history, get_behavior_stats, get_favorite_album_catalog,
    get_favorite_artist_catalog, get_favorite_song_paths_view, get_format_distribution,
    get_library_stats, get_quality_distribution, get_recent_album_catalog, get_recent_history,
    get_recent_playlist_catalog, get_recent_song_paths_view, import_recent_history,
    import_statistics_file, preview_statistics_import, record_play, remove_from_recent_history,
    export_statistics_file,
};
use system_fonts::get_system_fonts;
use toolbox::{apply_rename, open_external_program, preview_rename, refresh_folder_songs};
use window_boundary::set_mini_boundary_enabled;
use window_material::get_window_material_capabilities;
use window_theme::set_dark_mode_for_window;
use window_z_order::{refresh_current_window_topmost, start_topmost_guard, stop_topmost_guard};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_single_instance(app, argv);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| setup_app(app))
        .invoke_handler(tauri::generate_handler![
            scan_music_folder,
            parse_audio_files,
            scan_folder_as_playlists,
            get_song_cover_thumbnail,
            get_song_cover,
            clear_cover_cache,
            get_song_lyrics,
            get_song_detail,
            batch_move_music_files,
            move_music_file,
            show_in_folder,
            delete_music_file,
            play_audio,
            update_playback_metadata,
            pause_audio,
            resume_audio,
            seek_audio,
            set_volume,
            get_playback_progress,
            preview_rename,
            apply_rename,
            get_output_devices,
            get_current_output_device,
            set_output_device,
            get_library_folders,
            is_directory,
            add_library_folder,
            remove_library_folder,
            get_library_songs_cached,
            get_library_artist_catalog,
            get_library_album_catalog,
            get_library_song_paths_by_artist,
            get_library_song_paths_by_album,
            get_library_song_paths_for_all_view,
            get_library_song_paths_for_folder_view,
            scan_library,
            get_library_hierarchy,
            get_folder_children,
            // Deprecated compatibility commands for legacy sidebar_folders.
            get_sidebar_folders,
            add_sidebar_folder,
            remove_sidebar_folder,
            get_sidebar_hierarchy,
            create_folder,
            delete_folder,
            move_file_to_folder,
            get_folder_first_song,
            get_library_stats,
            add_to_history,
            record_play,
            get_recent_history,
            get_favorite_artist_catalog,
            get_favorite_album_catalog,
            get_favorite_song_paths_view,
            get_recent_album_catalog,
            get_recent_song_paths_view,
            get_recent_playlist_catalog,
            import_recent_history,
            export_statistics_file,
            preview_statistics_import,
            import_statistics_file,
            remove_from_recent_history,
            clear_recent_history,
            get_behavior_stats,
            get_quality_distribution,
            get_format_distribution,
            clear_all_app_data,
            open_external_program,
            refresh_folder_songs,
            set_mini_boundary_enabled,
            get_window_material_capabilities,
            get_foreground_fullscreen_state,
            set_dark_mode_for_window,
            refresh_current_window_topmost,
            start_topmost_guard,
            stop_topmost_guard,
            consume_pending_open_paths,
            get_system_fonts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
