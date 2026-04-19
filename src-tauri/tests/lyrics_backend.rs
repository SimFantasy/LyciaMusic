#[path = "../src/music/lyrics.rs"]
mod lyrics;

use lyrics::build_structured_lyrics_payload;

#[test]
fn parses_yrc_fixture_payload() {
    let payload =
        build_structured_lyrics_payload(include_str!("../src/music/fixtures/lyrics/if_back_then.yrc").to_string());

    assert_eq!(payload.display_lines.len(), 2);
    assert_eq!(payload.display_lines[0].text, "如果当时 - 许嵩");
    assert_eq!(
        payload.display_lines[0]
            .words
            .as_ref()
            .map(|words| words.iter().map(|word| word.text.as_str()).collect::<Vec<_>>())
            .unwrap_or_default(),
        vec!["如", "果", "当", "时", " ", "-", " ", "许", "嵩"]
    );
    assert_eq!(payload.display_lines[1].text, "词：许嵩");
}

#[test]
fn parses_qrc_fixture_payload() {
    let payload =
        build_structured_lyrics_payload(include_str!("../src/music/fixtures/lyrics/baby.qrc").to_string());

    assert_eq!(payload.display_lines.len(), 2);
    assert_eq!(payload.display_lines[0].text, "You know you love me I know you care");
    assert_eq!(payload.display_lines[1].text, "你知道你爱我 我知道你在意");
}

#[test]
fn parses_lys_fixture_payload() {
    let payload =
        build_structured_lyrics_payload(include_str!("../src/music/fixtures/lyrics/from_that_day.lys").to_string());

    assert_eq!(payload.display_lines.len(), 2);
    assert_eq!(payload.display_lines[0].text, "その日から何もかも");
    assert_eq!(payload.display_lines[1].text, "忘れたくないこと");
}
