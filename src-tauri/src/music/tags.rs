use id3::TagLike;
use lofty::config::ParseOptions;
use lofty::file::{FileType, TaggedFile, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::probe::Probe;
use lofty::properties::FileProperties;
use lofty::tag::{Accessor, ItemKey, ItemValue, Tag, TagItem, TagType};
use std::fs::File;
use std::io::{BufReader, Cursor, Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Default, Debug, Clone, PartialEq, Eq)]
pub struct TagTextMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
}

#[derive(Default, Debug, Clone, PartialEq, Eq)]
pub struct TagDetailMetadata {
    pub genre: Option<String>,
    pub year: Option<String>,
    pub track_number: Option<String>,
    pub disc_number: Option<String>,
    pub comment: Option<String>,
}

pub fn read_tagged_file_from_path(path: &Path) -> lofty::error::Result<TaggedFile> {
    read_tagged_file_from_path_with_cover_mode(path, true)
}

pub fn read_tagged_file_from_path_for_scan(path: &Path) -> lofty::error::Result<TaggedFile> {
    read_tagged_file_from_path_with_cover_mode(path, false)
}

fn read_tagged_file_from_path_with_cover_mode(
    path: &Path,
    read_cover_art: bool,
) -> lofty::error::Result<TaggedFile> {
    let options = ParseOptions::new().read_cover_art(read_cover_art);

    match Probe::open(path)?
        .guess_file_type()?
        .options(options)
        .read()
    {
        Ok(tagged_file) => Ok(tagged_file),
        Err(original_err) if is_wav_path(path) => {
            read_salvaged_wav_tags(path, read_cover_art).map_err(|_| original_err)
        }
        Err(original_err) => Err(original_err),
    }
}

pub fn extract_text_metadata<T>(tagged_file: &T) -> TagTextMetadata
where
    T: TaggedFileExt + ?Sized,
{
    let mut metadata = TagTextMetadata::default();

    for tag in ordered_tags(tagged_file) {
        if metadata.title.is_none() {
            metadata.title = read_title(tag);
        }

        if metadata.artist.is_none() {
            metadata.artist = read_artist(tag);
        }

        if metadata.album.is_none() {
            metadata.album = read_album(tag);
        }

        if metadata.album_artist.is_none() {
            metadata.album_artist = read_album_artist(tag);
        }

        if metadata.title.is_some()
            && metadata.artist.is_some()
            && metadata.album.is_some()
            && metadata.album_artist.is_some()
        {
            break;
        }
    }

    metadata
}

pub fn extract_detail_metadata<T>(tagged_file: &T) -> TagDetailMetadata
where
    T: TaggedFileExt + ?Sized,
{
    let mut metadata = TagDetailMetadata::default();

    for tag in ordered_tags(tagged_file) {
        if metadata.genre.is_none() {
            metadata.genre = tag
                .genre()
                .as_deref()
                .and_then(clean_text)
                .or_else(|| read_tag_text(tag, &[], &["GENRE", "TCON", "IGNR"]));
        }

        if metadata.year.is_none() {
            metadata.year = tag
                .get_string(&ItemKey::RecordingDate)
                .and_then(clean_text)
                .or_else(|| read_tag_text(tag, &[], &["DATE", "YEAR", "TYER", "TDRC", "ICRD"]));
        }

        if metadata.track_number.is_none() {
            metadata.track_number = tag
                .track()
                .map(|value| value.to_string())
                .or_else(|| {
                    read_tag_text(
                        tag,
                        &[ItemKey::TrackNumber],
                        &["TRACKNUMBER", "TRCK", "TRACK", "ITRK", "IPRT"],
                    )
                });
        }

        if metadata.disc_number.is_none() {
            metadata.disc_number = tag
                .disk()
                .map(|value| value.to_string())
                .or_else(|| {
                    read_tag_text(
                        tag,
                        &[ItemKey::DiscNumber],
                        &["DISCNUMBER", "DISC", "DISK", "TPOS"],
                    )
                });
        }

        if metadata.comment.is_none() {
            metadata.comment = tag
                .get_string(&ItemKey::Comment)
                .and_then(clean_text)
                .or_else(|| {
                    tag.items().find_map(|item| match item.key() {
                        ItemKey::Comment | ItemKey::Description => item_text(item),
                        ItemKey::Unknown(key)
                            if matches!(
                                key.to_ascii_uppercase().as_str(),
                                "COMMENT" | "COMMENTS" | "DESCRIPTION"
                            ) =>
                        {
                            item_text(item)
                        }
                        _ => None,
                    })
                });
        }

        if metadata.genre.is_some()
            && metadata.year.is_some()
            && metadata.track_number.is_some()
            && metadata.disc_number.is_some()
            && metadata.comment.is_some()
        {
            break;
        }
    }

    metadata
}

pub fn extract_embedded_lyrics<T>(tagged_file: &T) -> Option<String>
where
    T: TaggedFileExt + ?Sized,
{
    let tags = ordered_tags(tagged_file);

    for tag in &tags {
        if let Some(lyrics) = tag.get_string(&ItemKey::Lyrics).and_then(clean_text) {
            return Some(lyrics);
        }
    }

    for tag in &tags {
        for item in tag.items() {
            let Some(text) = item_text(item) else {
                continue;
            };

            let is_explicit_lyrics_field = match item.key() {
                ItemKey::Comment | ItemKey::Description => true,
                ItemKey::Unknown(key) => looks_like_lyrics_key(key),
                _ => false,
            } || looks_like_lyrics_description(item.description());

            if is_explicit_lyrics_field && seems_like_lyrics_text(&text) {
                return Some(text);
            }
        }
    }

    for tag in &tags {
        for item in tag.items() {
            let Some(text) = item_text(item) else {
                continue;
            };

            if contains_lrc_timestamp(&text) {
                return Some(text);
            }
        }
    }

    None
}

pub fn find_embedded_picture<'a, T>(tagged_file: &'a T) -> Option<&'a Picture>
where
    T: TaggedFileExt + ?Sized,
{
    let tags = ordered_tags(tagged_file);

    for tag in &tags {
        if let Some(picture) = tag
            .pictures()
            .iter()
            .find(|picture| picture.pic_type() == PictureType::CoverFront)
        {
            return Some(picture);
        }
    }

    for tag in &tags {
        if let Some(picture) = tag.pictures().first() {
            return Some(picture);
        }
    }

    None
}

pub fn contains_lrc_timestamp(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        if bytes[index] == b'[' {
            let mut cursor = index + 1;
            let mut minutes_digits = 0usize;

            while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
                minutes_digits += 1;
                cursor += 1;
            }

            if minutes_digits > 0 && cursor < bytes.len() && bytes[cursor] == b':' {
                cursor += 1;

                if cursor + 1 < bytes.len()
                    && bytes[cursor].is_ascii_digit()
                    && bytes[cursor + 1].is_ascii_digit()
                {
                    cursor += 2;

                    if cursor < bytes.len() && bytes[cursor] == b'.' {
                        cursor += 1;
                        let mut fraction_digits = 0usize;
                        while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
                            fraction_digits += 1;
                            cursor += 1;
                        }

                        if fraction_digits > 0 && cursor < bytes.len() && bytes[cursor] == b']' {
                            return true;
                        }
                    } else if cursor < bytes.len() && bytes[cursor] == b']' {
                        return true;
                    }
                }
            }
        }

        index += 1;
    }

    false
}

fn is_wav_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "wav" | "wave"))
        .unwrap_or(false)
}

fn read_salvaged_wav_tags(path: &Path, read_cover_art: bool) -> Result<TaggedFile, ()> {
    let file = File::open(path).map_err(|_| ())?;
    let mut reader = BufReader::new(file);
    let mut tags = Vec::new();

    let wav_start = match read_leading_id3_tag(&mut reader, &mut tags, read_cover_art)? {
        Some(id3_size) => id3_size,
        None => 0,
    };

    reader.seek(SeekFrom::Start(wav_start)).map_err(|_| ())?;
    tags.extend(parse_wav_chunks(&mut reader, read_cover_art)?);

    if tags.is_empty() {
        return Err(());
    }

    Ok(TaggedFile::new(
        FileType::Wav,
        FileProperties::default(),
        tags,
    ))
}

fn read_leading_id3_tag<R>(
    reader: &mut R,
    tags: &mut Vec<Tag>,
    read_cover_art: bool,
) -> Result<Option<u64>, ()>
where
    R: Read + Seek,
{
    let mut header = [0u8; 10];
    match reader.read_exact(&mut header) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof => {
            reader.seek(SeekFrom::Start(0)).map_err(|_| ())?;
            return Ok(None);
        }
        Err(_) => return Err(()),
    }

    let Some(id3_size) = leading_id3v2_size(&header).map(|size| size as u64) else {
        reader.seek(SeekFrom::Start(0)).map_err(|_| ())?;
        return Ok(None);
    };

    reader.seek(SeekFrom::Start(0)).map_err(|_| ())?;
    if let Some(id3_bytes) = read_chunk(reader, id3_size as usize) {
        push_id3_tag(tags, &id3_bytes, read_cover_art);
    }

    Ok(Some(id3_size))
}

fn leading_id3v2_size(bytes: &[u8]) -> Option<usize> {
    if bytes.len() < 10 || &bytes[..3] != b"ID3" {
        return None;
    }

    let size = ((bytes[6] as usize) << 21)
        | ((bytes[7] as usize) << 14)
        | ((bytes[8] as usize) << 7)
        | (bytes[9] as usize);

    Some(10 + size)
}

fn parse_wav_chunks<R>(reader: &mut R, read_cover_art: bool) -> Result<Vec<Tag>, ()>
where
    R: Read + Seek,
{
    if !has_wav_header(reader)? {
        return Ok(Vec::new());
    }

    let mut tags = Vec::new();
    loop {
        let mut chunk_header = [0u8; 8];
        match reader.read_exact(&mut chunk_header) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(_) => return Err(()),
        }

        let chunk_id = &chunk_header[..4];
        let chunk_size =
            u32::from_le_bytes(chunk_header[4..8].try_into().map_err(|_| ())?) as usize;

        match chunk_id {
            b"id3 " | b"ID3 " => {
                let Some(chunk_bytes) = read_chunk(reader, chunk_size) else {
                    break;
                };
                push_id3_tag(&mut tags, &chunk_bytes, read_cover_art);
            }
            b"LIST" => {
                let Some(chunk_bytes) = read_chunk(reader, chunk_size) else {
                    break;
                };
                if let Some(tag) = parse_riff_info_list(&chunk_bytes) {
                    tags.push(tag);
                }
            }
            _ => {
                if skip_chunk(reader, chunk_size as u64).is_err() {
                    break;
                }
            }
        }

        if chunk_size % 2 == 1 && skip_chunk(reader, 1).is_err() {
            break;
        }
    }

    Ok(tags)
}

fn read_chunk<R>(reader: &mut R, size: usize) -> Option<Vec<u8>>
where
    R: Read,
{
    let mut bytes = vec![0u8; size];
    reader.read_exact(&mut bytes).ok()?;
    Some(bytes)
}

fn skip_chunk<R>(reader: &mut R, size: u64) -> Result<(), ()>
where
    R: Seek,
{
    reader
        .seek(SeekFrom::Current(size as i64))
        .map(|_| ())
        .map_err(|_| ())
}

fn has_wav_header<R>(reader: &mut R) -> Result<bool, ()>
where
    R: Read,
{
    let mut header = [0u8; 12];
    match reader.read_exact(&mut header) {
        Ok(()) => Ok(&header[..4] == b"RIFF" && &header[8..12] == b"WAVE"),
        Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof => Ok(false),
        Err(_) => Err(()),
    }
}

fn push_id3_tag(tags: &mut Vec<Tag>, bytes: &[u8], read_cover_art: bool) {
    if let Ok(tag) = id3::Tag::read_from2(Cursor::new(bytes)) {
        tags.push(lofty_tag_from_id3(tag, read_cover_art));
    }
}

fn parse_riff_info_list(bytes: &[u8]) -> Option<Tag> {
    if bytes.len() < 4 || &bytes[..4] != b"INFO" {
        return None;
    }

    let mut tag = Tag::new(TagType::RiffInfo);
    let mut offset = 4usize;

    while offset + 8 <= bytes.len() {
        let key = &bytes[offset..offset + 4];
        let item_size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().ok()?) as usize;
        let data_start = offset + 8;
        let data_end = data_start.saturating_add(item_size);

        if data_end > bytes.len() {
            break;
        }

        if let Some(value) = decode_riff_info_text(&bytes[data_start..data_end]) {
            let key = String::from_utf8_lossy(key);
            let _ = tag.insert(TagItem::new(
                ItemKey::from_key(TagType::RiffInfo, &key),
                ItemValue::Text(value),
            ));
        }

        offset = offset.saturating_add(8 + item_size + (item_size % 2));
    }

    let has_items = tag.items().next().is_some();
    has_items.then_some(tag)
}

fn decode_riff_info_text(raw: &[u8]) -> Option<String> {
    let raw = raw
        .split(|byte| *byte == 0)
        .next()
        .unwrap_or(raw)
        .trim_ascii();

    if raw.is_empty() {
        return None;
    }

    if raw.len() >= 2 && raw.len() % 2 == 0 {
        let units: Vec<u16> = raw
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();

        if let Ok(decoded) = String::from_utf16(&units) {
            if let Some(text) = clean_text(&decoded) {
                return Some(text);
            }
        }
    }

    if let Ok(decoded) = std::str::from_utf8(raw) {
        if let Some(text) = clean_text(decoded) {
            return Some(text);
        }
    }

    let (decoded, _, _) = encoding_rs::GBK.decode(raw);
    clean_text(&decoded)
}

fn lofty_tag_from_id3(id3_tag: id3::Tag, read_cover_art: bool) -> Tag {
    let mut lofty_tag = Tag::new(TagType::Id3v2);

    insert_optional_text(&mut lofty_tag, ItemKey::TrackTitle, id3_tag.title());
    insert_optional_text(&mut lofty_tag, ItemKey::TrackArtist, id3_tag.artist());
    insert_optional_text(&mut lofty_tag, ItemKey::AlbumTitle, id3_tag.album());
    insert_optional_text(
        &mut lofty_tag,
        ItemKey::RecordingDate,
        id3_tag.year().map(|value| value.to_string()).as_deref(),
    );
    insert_optional_text(
        &mut lofty_tag,
        ItemKey::TrackNumber,
        id3_tag.track().map(|value| value.to_string()).as_deref(),
    );
    insert_optional_text(
        &mut lofty_tag,
        ItemKey::DiscNumber,
        id3_tag.disc().map(|value| value.to_string()).as_deref(),
    );

    for comment in id3_tag.comments() {
        let Some(text) = clean_text(&comment.text) else {
            continue;
        };
        let _ = lofty_tag.insert(TagItem::new(ItemKey::Comment, ItemValue::Text(text)));
    }

    for lyrics in id3_tag.lyrics() {
        let Some(text) = clean_text(&lyrics.text) else {
            continue;
        };
        let _ = lofty_tag.insert(TagItem::new(ItemKey::Lyrics, ItemValue::Text(text)));
    }

    if read_cover_art {
        for picture in id3_tag.pictures() {
            lofty_tag.push_picture(Picture::new_unchecked(
                PictureType::from_u8(u8::from(picture.picture_type)),
                Some(MimeType::from_str(&picture.mime_type)),
                clean_text(&picture.description),
                picture.data.clone(),
            ));
        }
    }

    lofty_tag
}

fn insert_optional_text(tag: &mut Tag, key: ItemKey, value: Option<&str>) {
    if let Some(value) = value.and_then(clean_text) {
        let _ = tag.insert_text(key, value);
    }
}

fn ordered_tags<'a, T>(tagged_file: &'a T) -> Vec<&'a Tag>
where
    T: TaggedFileExt + ?Sized,
{
    let mut tags = Vec::new();

    push_unique_tag(&mut tags, tagged_file.tag(TagType::Id3v2));
    push_unique_tag(&mut tags, tagged_file.primary_tag());
    push_unique_tag(&mut tags, tagged_file.tag(TagType::RiffInfo));

    for tag in tagged_file.tags() {
        push_unique_tag(&mut tags, Some(tag));
    }

    tags
}

fn push_unique_tag<'a>(tags: &mut Vec<&'a Tag>, candidate: Option<&'a Tag>) {
    let Some(candidate) = candidate else {
        return;
    };

    if !tags
        .iter()
        .any(|existing| std::ptr::eq(*existing, candidate))
    {
        tags.push(candidate);
    }
}

fn read_title(tag: &Tag) -> Option<String> {
    tag.title()
        .as_deref()
        .and_then(clean_text)
        .or_else(|| read_tag_text(tag, &[ItemKey::TrackTitle], &["TITLE", "INAM"]))
}

fn read_artist(tag: &Tag) -> Option<String> {
    tag.artist().as_deref().and_then(clean_text).or_else(|| {
        read_tag_text(
            tag,
            &[
                ItemKey::TrackArtist,
                ItemKey::AlbumArtist,
                ItemKey::Performer,
                ItemKey::Composer,
            ],
            &["ARTIST", "IART", "AUTHOR"],
        )
    })
}

fn read_album(tag: &Tag) -> Option<String> {
    tag.album().as_deref().and_then(clean_text).or_else(|| {
        read_tag_text(
            tag,
            &[ItemKey::AlbumTitle, ItemKey::OriginalAlbumTitle],
            &["ALBUM", "IPRD"],
        )
    })
}

fn read_album_artist(tag: &Tag) -> Option<String> {
    read_tag_text(
        tag,
        &[
            ItemKey::AlbumArtist,
            ItemKey::TrackArtist,
            ItemKey::Performer,
        ],
        &["ALBUMARTIST", "ALBUM ARTIST", "TPE2", "IART"],
    )
}

fn read_tag_text(tag: &Tag, keys: &[ItemKey], unknown_keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = tag.get_string(key).and_then(clean_text) {
            return Some(text);
        }
    }

    tag.items().find_map(|item| match item.key() {
        ItemKey::Unknown(key)
            if unknown_keys
                .iter()
                .any(|candidate| key.eq_ignore_ascii_case(candidate)) =>
        {
            item_text(item)
        }
        _ => None,
    })
}

fn item_text(item: &TagItem) -> Option<String> {
    item.value()
        .text()
        .or_else(|| item.value().locator())
        .and_then(clean_text)
}

fn clean_text(value: &str) -> Option<String> {
    let trimmed = value.trim_matches('\0').trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn looks_like_lyrics_key(raw_key: &str) -> bool {
    matches!(
        raw_key.to_ascii_uppercase().as_str(),
        "LYRICS" | "LYRIC" | "LRC" | "KLYRIC" | "UNSYNCEDLYRICS" | "SYNCEDLYRICS"
    )
}

fn looks_like_lyrics_description(description: &str) -> bool {
    let normalized = description.trim().to_ascii_uppercase();
    !normalized.is_empty() && (normalized.contains("LYRIC") || normalized.contains("LRC"))
}

fn seems_like_lyrics_text(text: &str) -> bool {
    contains_lrc_timestamp(text) || text.lines().filter(|line| !line.trim().is_empty()).count() >= 2
}

#[cfg(test)]
mod tests {
    use super::{
        extract_detail_metadata, extract_embedded_lyrics, extract_text_metadata, find_embedded_picture,
        read_tagged_file_from_path, read_tagged_file_from_path_for_scan,
    };
    use id3::frame::{Picture as Id3Picture, PictureType as Id3PictureType};
    use id3::TagLike;
    use id3::Version;
    use lofty::file::{FileType, TaggedFile, TaggedFileExt};
    use lofty::picture::{MimeType, Picture, PictureType};
    use lofty::probe::Probe;
    use lofty::properties::FileProperties;
    use lofty::tag::{ItemKey, ItemValue, Tag, TagItem, TagType};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_tagged_file(tags: Vec<Tag>) -> TaggedFile {
        TaggedFile::new(FileType::Wav, FileProperties::default(), tags)
    }

    fn minimal_wav_bytes() -> Vec<u8> {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&38u32.to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&44_100u32.to_le_bytes());
        wav.extend_from_slice(&88_200u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&2u32.to_le_bytes());
        wav.extend_from_slice(&[0, 0]);
        wav
    }

    fn create_id3_prefixed_wav_bytes(with_picture: bool) -> Vec<u8> {
        let mut id3_tag = id3::Tag::new();
        id3_tag.set_title("Fallback WAV");

        if with_picture {
            id3_tag.add_frame(Id3Picture {
                mime_type: "image/png".to_string(),
                picture_type: Id3PictureType::CoverFront,
                description: "front".to_string(),
                data: vec![137, 80, 78, 71],
            });
        }

        let mut bytes = Vec::new();
        id3_tag
            .write_to(&mut bytes, Version::Id3v24)
            .expect("id3 tag should serialize");
        bytes.extend_from_slice(&minimal_wav_bytes());
        bytes
    }

    #[test]
    fn prefers_id3v2_text_over_riff_info() {
        let mut riff = Tag::new(TagType::RiffInfo);
        riff.insert_text(ItemKey::TrackTitle, "RIFF Title".to_string());
        riff.insert_text(ItemKey::TrackArtist, "RIFF Artist".to_string());
        riff.insert_text(ItemKey::AlbumTitle, "RIFF Album".to_string());

        let mut id3 = Tag::new(TagType::Id3v2);
        id3.insert_text(ItemKey::TrackTitle, "ID3 Title".to_string());
        id3.insert_text(ItemKey::TrackArtist, "ID3 Artist".to_string());
        id3.insert_text(ItemKey::AlbumTitle, "ID3 Album".to_string());

        let metadata = extract_text_metadata(&make_tagged_file(vec![riff, id3]));

        assert_eq!(metadata.title.as_deref(), Some("ID3 Title"));
        assert_eq!(metadata.artist.as_deref(), Some("ID3 Artist"));
        assert_eq!(metadata.album.as_deref(), Some("ID3 Album"));
    }

    #[test]
    fn falls_back_to_riff_info_text() {
        let mut riff = Tag::new(TagType::RiffInfo);
        riff.insert_text(ItemKey::TrackTitle, "Wave Title".to_string());
        riff.insert_text(ItemKey::TrackArtist, "Wave Artist".to_string());
        riff.insert_text(ItemKey::AlbumTitle, "Wave Album".to_string());

        let metadata = extract_text_metadata(&make_tagged_file(vec![riff]));

        assert_eq!(metadata.title.as_deref(), Some("Wave Title"));
        assert_eq!(metadata.artist.as_deref(), Some("Wave Artist"));
        assert_eq!(metadata.album.as_deref(), Some("Wave Album"));
    }

    #[test]
    fn extracts_lyrics_from_comment_when_it_contains_lrc() {
        let mut id3 = Tag::new(TagType::Id3v2);
        id3.insert(TagItem::new(
            ItemKey::Comment,
            ItemValue::Text("[00:01.00]line one\n[00:02.00]line two".to_string()),
        ));

        let lyrics = extract_embedded_lyrics(&make_tagged_file(vec![id3]));

        assert_eq!(
            lyrics.as_deref(),
            Some("[00:01.00]line one\n[00:02.00]line two")
        );
    }

    #[test]
    fn extracts_track_and_disc_numbers_from_detail_metadata() {
        let mut id3 = Tag::new(TagType::Id3v2);
        id3.insert_text(ItemKey::TrackNumber, "7".to_string());
        id3.insert_text(ItemKey::DiscNumber, "2".to_string());

        let metadata = extract_detail_metadata(&make_tagged_file(vec![id3]));

        assert_eq!(metadata.track_number.as_deref(), Some("7"));
        assert_eq!(metadata.disc_number.as_deref(), Some("2"));
    }

    #[test]
    fn prefers_front_cover_picture() {
        let mut id3 = Tag::new(TagType::Id3v2);
        id3.push_picture(Picture::new_unchecked(
            PictureType::CoverBack,
            Some(MimeType::Jpeg),
            None,
            vec![1, 2, 3],
        ));

        let mut riff = Tag::new(TagType::RiffInfo);
        riff.push_picture(Picture::new_unchecked(
            PictureType::CoverFront,
            Some(MimeType::Png),
            None,
            vec![4, 5, 6],
        ));

        let tagged_file = make_tagged_file(vec![id3, riff]);
        let picture = find_embedded_picture(&tagged_file).expect("picture should exist");

        assert_eq!(picture.pic_type(), PictureType::CoverFront);
        assert_eq!(picture.data(), &[4, 5, 6]);
    }

    #[test]
    fn reads_wav_with_leading_id3v2_header_via_fallback() {
        let temp_name = format!(
            "lycia_id3_prefixed_{}.wav",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let temp_path = std::env::temp_dir().join(temp_name);

        fs::write(&temp_path, create_id3_prefixed_wav_bytes(false))
            .expect("temp wav should be written");

        let extension_only = Probe::open(&temp_path).expect("probe should open").read();
        assert!(extension_only.is_err());

        let tagged_file =
            read_tagged_file_from_path(&temp_path).expect("fallback parser should read the wav");
        assert_eq!(tagged_file.file_type(), FileType::Wav);

        let _ = fs::remove_file(temp_path);
    }

    #[test]
    fn scan_reader_skips_cover_art_for_wav_fallback() {
        let temp_name = format!(
            "lycia_id3_prefixed_cover_{}.wav",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let temp_path = std::env::temp_dir().join(temp_name);

        fs::write(&temp_path, create_id3_prefixed_wav_bytes(true))
            .expect("temp wav should be written");

        let full_tagged_file =
            read_tagged_file_from_path(&temp_path).expect("full parser should retain pictures");
        let scan_tagged_file = read_tagged_file_from_path_for_scan(&temp_path)
            .expect("scan parser should still read text tags");

        assert!(find_embedded_picture(&full_tagged_file).is_some());
        assert!(find_embedded_picture(&scan_tagged_file).is_none());

        let _ = fs::remove_file(temp_path);
    }
}
