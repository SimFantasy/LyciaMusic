#[path = "../src/music/lyrics.rs"]
mod lyrics;

use lyrics::build_structured_lyrics_payload;

fn find_display_line_by_time(
    payload: &lyrics::StructuredLyricsPayload,
    time: f64,
) -> Option<&lyrics::LyricLinePayload> {
    payload
        .display_lines
        .iter()
        .find(|line| (line.time - time).abs() < 0.001)
}

#[test]
fn parses_yrc_fixture_payload() {
    let payload = build_structured_lyrics_payload(
        include_str!("../src/music/fixtures/lyrics/if_back_then.yrc").to_string(),
    );

    assert_eq!(payload.display_lines.len(), 2);
    assert_eq!(payload.display_lines[0].text, "如果当时 - 许嵩");
    assert_eq!(
        payload.display_lines[0]
            .words
            .as_ref()
            .map(|words| words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>())
            .unwrap_or_default(),
        vec!["如", "果", "当", "时", " ", "-", " ", "许", "嵩"]
    );
    assert_eq!(payload.display_lines[1].text, "词：许嵩");
}

#[test]
fn parses_qrc_fixture_payload() {
    let payload = build_structured_lyrics_payload(
        include_str!("../src/music/fixtures/lyrics/baby.qrc").to_string(),
    );

    assert_eq!(payload.display_lines.len(), 2);
    assert_eq!(
        payload.display_lines[0].text,
        "You know you love me I know you care"
    );
    assert_eq!(payload.display_lines[1].text, "你知道你爱我 我知道你在意");
}

#[test]
fn parses_lys_fixture_payload() {
    let payload = build_structured_lyrics_payload(
        include_str!("../src/music/fixtures/lyrics/from_that_day.lys").to_string(),
    );

    assert_eq!(payload.display_lines.len(), 2);
    assert_eq!(payload.display_lines[0].text, "その日から何もかも");
    assert_eq!(payload.display_lines[1].text, "忘れたくないこと");
}

#[test]
fn keeps_bilingual_english_lines_as_single_display_rows() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:22.26]Hey you",
            "[00:22.26]嘿 亲爱的",
            "[00:25.15]I wrote these words",
            "[00:25.15]我写下这些字句",
            "[00:26.73]Got something to say to you",
            "[00:26.73]有些话想对你说",
            "[00:30.66]Lovers turn to strangers",
            "[00:30.66]恋人终成陌路",
            "[00:32.71]But they stay fools stay fools",
            "[00:32.71]但痴心人依然执迷不悟",
        ]
        .join("\n"),
    );

    assert_eq!(payload.display_lines.len(), 5);
    assert_eq!(
        payload
            .display_lines
            .iter()
            .map(|line| (line.time * 1000.0).round() as i64)
            .collect::<std::collections::HashSet<_>>()
            .len(),
        payload.display_lines.len(),
    );
    assert_eq!(payload.display_lines[0].text, "Hey you");
    assert_eq!(payload.display_lines[0].translation, "嘿 亲爱的");
    assert!(payload
        .display_lines
        .iter()
        .all(|line| line.romaji.is_empty()));
}

#[test]
fn keeps_japanese_romaji_and_translation_grouped_for_short_lines() {
    let payload = build_structured_lyrics_payload(
        [
            "[04:50.560]<04:50.560>da i jo u bu ki mi wa hi to ri ja na i<04:52.500>",
            "[04:50.560]<04:50.560>大丈夫 君は一人じゃない<04:52.500>",
            "[04:50.560]<04:50.560>没问题 你不孤单<04:52.500>",
            "[04:53.260]<04:53.260>kyo u yo ri a shi ta wa tsu yo ku a re<04:55.590>",
            "[04:53.260]<04:53.260>今日より明日は 強くあれ<04:55.590>",
            "[04:53.260]<04:53.260>明天会比今天更坚强<04:55.590>",
            "[04:55.590]<04:55.590>i tsu de mo ki mi wa hi to ri ja na i<04:57.880>",
            "[04:55.590]<04:55.590>いつでも君は 一人じゃない<04:57.880>",
            "[04:55.590]<04:55.590>一直以来你都不孤单<04:57.880>",
            "[04:57.880]<04:57.880>ha ge ma shi a u na ka ma ga i ru<05:00.140>",
            "[04:57.880]<04:57.880>励まし合う 仲間がいる<05:00.140>",
            "[04:57.880]<04:57.880>有互相鼓励的朋友<05:00.140>",
            "[05:00.140]<05:00.140>da i jo u bu<05:01.270>",
            "[05:00.140]<05:00.140>大丈夫<05:01.270>",
            "[05:00.140]<05:00.140>没问题<05:01.270>",
            "[05:03.480]<05:03.480>ko re ka ra mo hi to ri ja na i<05:14.050>",
            "[05:03.480]<05:03.480>これからも 一人じゃない<05:14.050>",
            "[05:03.480]<05:03.480>从今往后你也不会孤单<05:14.050>",
            "[05:14.050]<05:14.050>o wa ri<05:15.050>",
            "[05:14.050]<05:14.050>終わり<05:15.050>",
            "[05:14.050]<05:14.050>终<05:15.050>",
        ]
        .join("\n"),
    );

    let short_line = find_display_line_by_time(&payload, 300.140).expect("short line exists");
    assert_eq!(short_line.text, "大丈夫");
    assert_eq!(short_line.romaji, "da i jo u bu");
    assert_eq!(short_line.translation, "没问题");

    let ending_line = find_display_line_by_time(&payload, 303.480).expect("ending line exists");
    assert_eq!(ending_line.text, "これからも 一人じゃない");
    assert_eq!(ending_line.romaji, "ko re ka ra mo hi to ri ja na i");
    assert_eq!(ending_line.translation, "从今往后你也不会孤单");

    let final_line = find_display_line_by_time(&payload, 314.050).expect("final line exists");
    assert_eq!(final_line.text, "終わり");
    assert_eq!(final_line.romaji, "o wa ri");
    assert_eq!(final_line.translation, "终");
}

#[test]
fn preserves_inline_english_main_lines_inside_japanese_song() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:20.699]<00:20.699>ha ji me te no ru bu ru wa<00:22.434>",
            "[00:20.699]<00:20.699>初めてのルーブルは<00:22.434>",
            "[00:20.699]<00:20.699>第一次参观卢浮宫<00:23.011>",
            "[00:23.011]<00:23.011>na n te ko to wa na ka tsu ta wa<00:25.100>",
            "[00:23.011]<00:23.011>なんてことはなかったわ<00:25.100>",
            "[00:23.011]<00:23.011>却并不觉得震撼<00:25.100>",
            "[00:25.100]<00:25.100>wa ta shi da ke no mo na ri za<00:26.828>",
            "[00:25.100]<00:25.100>私だけのモナリザ<00:26.828>",
            "[00:25.100]<00:25.100>因为我早已遇见<00:26.828>",
            "[00:26.942]<00:26.942>mo u to kku ni de a't te ta ka ra<00:29.044>",
            "[00:26.942]<00:26.942>もうとっくに出会ってたから<00:29.044>",
            "[00:26.942]<00:26.942>独属于我的蒙娜丽莎<00:29.374>",
            "[00:47.751]<00:47.751>(Can you give me one last kiss?)<00:52.399>",
            "[00:47.751]<00:47.751>(可以给我最后一个吻吗?)<00:52.399>",
            "[01:09.631]<01:09.631>I love you more than you'll ever know<01:12.607>",
            "[01:09.631]<01:09.631>我比你想象中更爱你<01:20.847>",
            "[01:20.847]<01:20.847>sha shi n wa ni ga te na n da<01:22.783>",
            "[01:20.847]<01:20.847>「写真は苦手なんだ」<01:22.783>",
            "[01:20.847]<01:20.847>“我不擅长摄影”<01:22.783>",
            "[01:26.907]<01:26.907>wa ta shi no ko ko ro no pu ro je ku ta<01:29.120>",
            "[01:26.907]<01:26.907>私の心のプロジェクター<01:29.120>",
            "[01:26.907]<01:26.907>早已将你的身影深深烙印<01:29.266>",
        ]
        .join("\n"),
    );

    let japanese_line = find_display_line_by_time(&payload, 26.942).expect("japanese line exists");
    assert_eq!(japanese_line.text, "もうとっくに出会ってたから");
    assert_eq!(japanese_line.romaji, "mo u to kku ni de a't te ta ka ra");
    assert_eq!(japanese_line.translation, "独属于我的蒙娜丽莎");

    let english_line = find_display_line_by_time(&payload, 47.751).expect("english line exists");
    assert_eq!(english_line.text, "(Can you give me one last kiss?)");
    assert_eq!(english_line.translation, "(可以给我最后一个吻吗?)");
    assert!(english_line.romaji.is_empty());

    let projector_line =
        find_display_line_by_time(&payload, 86.907).expect("projector line exists");
    assert_eq!(projector_line.text, "私の心のプロジェクター");
    assert_eq!(
        projector_line.romaji,
        "wa ta shi no ko ko ro no pu ro je ku ta"
    );
    assert_eq!(projector_line.translation, "早已将你的身影深深烙印");
}

#[test]
fn keeps_mixed_japanese_and_english_lines_as_main_when_no_romaji_track_exists() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:43.314]I don't know what I wanted or you made me do",
            "[00:43.314]我不知自己心之所向 亦不知你对我期望怎样",
            "[00:49.283]散り散りに刻む",
            "[00:49.283]于颠沛流离中铭刻下生命的印记",
            "[00:54.353]本当の世界で笑えるか?",
            "[00:54.353]在现实世界里还能够展颜欢笑吗",
            "[01:00.455]Don't you get there?",
            "[01:00.455]你是否还未抵达目的地？",
        ]
        .join("\n"),
    );

    let english_line = find_display_line_by_time(&payload, 43.314).expect("english line exists");
    assert_eq!(
        english_line.text,
        "I don't know what I wanted or you made me do"
    );
    assert_eq!(
        english_line.translation,
        "我不知自己心之所向 亦不知你对我期望怎样"
    );
    assert!(english_line.romaji.is_empty());

    let japanese_line = find_display_line_by_time(&payload, 49.283).expect("japanese line exists");
    assert_eq!(japanese_line.text, "散り散りに刻む");
    assert_eq!(japanese_line.translation, "于颠沛流离中铭刻下生命的印记");
    assert!(japanese_line.romaji.is_empty());

    let final_english_line =
        find_display_line_by_time(&payload, 60.455).expect("final english line exists");
    assert_eq!(final_english_line.text, "Don't you get there?");
    assert_eq!(final_english_line.translation, "你是否还未抵达目的地？");
    assert!(final_english_line.romaji.is_empty());
}

#[test]
fn keeps_french_lines_as_main_with_chinese_translation() {
    let payload = build_structured_lyrics_payload(
        [
            "[01:03.014]Et quand tu briseras ta cage",
            "[01:03.014]当你挣脱内心的牢笼",
            "[01:06.009]On ira a la foire",
            "[01:06.009]我们将一起前往那欢乐的圣地",
        ]
        .join("\n"),
    );

    let first_line = find_display_line_by_time(&payload, 63.014).expect("first french line exists");
    assert_eq!(first_line.text, "Et quand tu briseras ta cage");
    assert_eq!(first_line.translation, "当你挣脱内心的牢笼");
    assert!(first_line.romaji.is_empty());

    let second_line =
        find_display_line_by_time(&payload, 66.009).expect("second french line exists");
    assert_eq!(second_line.text, "On ira a la foire");
    assert_eq!(second_line.translation, "我们将一起前往那欢乐的圣地");
    assert!(second_line.romaji.is_empty());
}

#[test]
fn keeps_latin_main_when_chinese_translation_contains_repeated_latin_words() {
    let payload = build_structured_lyrics_payload(
        [
            "[by:燕如兮]",
            "[00:19.76]Deine Zeit ist da",
            "[00:19.76]正是出海的好时候",
            "[00:21.00]mach dich auf mein Jung",
            "[00:21.00]出发吧我的少年",
            "[00:22.21]denn die Segel sind gehisst.",
            "[00:22.21]船帆已经高悬",
            "[00:24.58]Seit ich denken kann",
            "[00:24.58]你是个好孩子",
            "[00:25.81]willst du mit uns fahr'n",
            "[00:25.81]来和我们一起航行",
            "[00:27.02]weit hinaus auf unsrem Schiff.",
            "[00:27.02]一起乘风破浪",
            "[00:29.62]Du bist alt genug",
            "[00:29.62]你已经是男子汉了",
            "[00:30.68]wenn du willst dann komm",
            "[00:30.68]你该有自己的选择",
            "[00:31.92]aber schnell wir laufen aus.",
            "[00:31.92]决定了就快跳上甲板",
            "[00:34.36]Junge eile dich",
            "[00:34.36]年轻人，别磨蹭",
            "[00:35.56]denn am Himmel ziehn",
            "[00:35.56]看一眼远方天际",
            "[00:37.02]dunkle Wolken auf.",
            "[00:37.02]浓云正在聚集",
            "[00:38.88]Johnny Boy, Johnny Boy",
            "[00:38.88]Johnny小子，Johnny小子！",
            "[00:41.62]we're bound for stormy weather",
            "[00:41.62]我们本就为风暴而生",
            "[00:43.66]Johnny Boy, Johnny Boy",
            "[00:43.66]Johnny小子，Johnny小子！",
            "[00:46.41]better wish you lads farewell",
            "[00:46.41]所有的祝福都给你",
            "[00:48.55]Somewhere out far away",
            "[00:48.55]在某个遥远海域",
        ]
        .join("\n"),
    );

    let first_refrain =
        find_display_line_by_time(&payload, 38.88).expect("first refrain line exists");
    let storm_line = find_display_line_by_time(&payload, 41.62).expect("storm line exists");
    let second_refrain =
        find_display_line_by_time(&payload, 43.66).expect("second refrain line exists");
    let farewell_line = find_display_line_by_time(&payload, 46.41).expect("farewell line exists");
    let faraway_line = find_display_line_by_time(&payload, 48.55).expect("faraway line exists");

    assert_eq!(first_refrain.text, "Johnny Boy, Johnny Boy");
    assert_eq!(first_refrain.translation, "Johnny小子，Johnny小子！");
    assert_eq!(storm_line.text, "we're bound for stormy weather");
    assert_eq!(storm_line.translation, "我们本就为风暴而生");
    assert_eq!(second_refrain.text, "Johnny Boy, Johnny Boy");
    assert_eq!(second_refrain.translation, "Johnny小子，Johnny小子！");
    assert_eq!(farewell_line.text, "better wish you lads farewell");
    assert_eq!(farewell_line.translation, "所有的祝福都给你");
    assert_eq!(faraway_line.text, "Somewhere out far away");
    assert_eq!(faraway_line.translation, "在某个遥远海域");
}
