use super::EpgProgram;
use anyhow::{Context, Result};
use quick_xml::events::Event;
use quick_xml::Reader;

pub async fn fetch_and_parse(url: &str) -> Result<Vec<EpgProgram>> {
    let content = reqwest::get(url)
        .await
        .context("Failed to fetch EPG XML")?
        .text()
        .await
        .context("Failed to read EPG response")?;

    parse_xmltv(&content)
}

pub fn parse_xmltv(content: &str) -> Result<Vec<EpgProgram>> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);

    let mut programs: Vec<EpgProgram> = Vec::new();
    let mut buf = Vec::new();

    let mut current_program: Option<EpgProgram> = None;
    let mut in_title = false;
    let mut in_desc = false;
    let mut in_category = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => match e.name().as_ref() {
                b"programme" => {
                    let channel_id = attr_value(e, "channel").unwrap_or_default();
                    let start = attr_value(e, "start").unwrap_or_default();
                    let stop = attr_value(e, "stop").unwrap_or_default();
                    current_program = Some(EpgProgram {
                        channel_id,
                        title: String::new(),
                        start: normalize_xmltv_time(&start),
                        stop: normalize_xmltv_time(&stop),
                        description: None,
                        icon: None,
                        category: None,
                    });
                    in_title = false;
                    in_desc = false;
                    in_category = false;
                }
                b"title" => in_title = true,
                b"desc" => in_desc = true,
                b"category" => in_category = true,
                b"icon" => {
                    if let Some(ref mut prog) = current_program {
                        prog.icon = attr_value(e, "src");
                    }
                }
                _ => {}
            },
            Ok(Event::Text(ref e)) => {
                let text = e.unescape().unwrap_or_default().to_string();
                if let Some(ref mut prog) = current_program {
                    if in_title && prog.title.is_empty() {
                        prog.title = text;
                    } else if in_desc && prog.description.is_none() {
                        prog.description = Some(text);
                    } else if in_category && prog.category.is_none() {
                        prog.category = Some(text);
                    }
                }
            }
            Ok(Event::End(ref e)) => match e.name().as_ref() {
                b"programme" => {
                    if let Some(prog) = current_program.take() {
                        if !prog.channel_id.is_empty() && !prog.title.is_empty() {
                            programs.push(prog);
                        }
                    }
                    in_title = false;
                    in_desc = false;
                    in_category = false;
                }
                b"title" => in_title = false,
                b"desc" => in_desc = false,
                b"category" => in_category = false,
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(e) => {
                // Log but don't fail — EPG files are often malformed
                eprintln!("XMLTV parse warning at position {}: {:?}", reader.buffer_position(), e);
                break;
            }
            _ => {}
        }
        buf.clear();
    }

    Ok(programs)
}

fn attr_value(e: &quick_xml::events::BytesStart, name: &str) -> Option<String> {
    e.attributes()
        .filter_map(|a| a.ok())
        .find(|a| a.key.as_ref() == name.as_bytes())
        .and_then(|a| a.unescape_value().ok())
        .map(|v| v.to_string())
}

/// Convert XMLTV timestamp "20240101120000 +0000" → ISO 8601 "2024-01-01T12:00:00+00:00"
fn normalize_xmltv_time(ts: &str) -> String {
    // Common format: "20240101120000 +0000" (14 digits + optional timezone)
    if ts.len() < 14 {
        return ts.to_string();
    }
    let year = &ts[0..4];
    let month = &ts[4..6];
    let day = &ts[6..8];
    let hour = &ts[8..10];
    let min = &ts[10..12];
    let sec = &ts[12..14];
    let tz = ts.get(15..).unwrap_or("+0000").trim();
    let tz_fmt = if tz.len() == 5 {
        format!("{}:{}", &tz[..3], &tz[3..])
    } else {
        "+00:00".to_string()
    };
    format!("{}-{}-{}T{}:{}:{}{}", year, month, day, hour, min, sec, tz_fmt)
}
