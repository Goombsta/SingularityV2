/// Minimal local HTTP proxy for HLS `.m3u8` segment requests.
/// Only used when HLS.js would otherwise send browser Origin/Referer headers
/// that IPTV CDNs reject. Activated exclusively for explicit .m3u8 streams.
use std::sync::OnceLock;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

static PROXY_PORT: OnceLock<u16> = OnceLock::new();

pub fn port() -> Option<u16> {
    PROXY_PORT.get().copied()
}

pub async fn start() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("HLS proxy: bind failed");
    let port = listener.local_addr().expect("HLS proxy: addr failed").port();
    let _ = PROXY_PORT.set(port);

    let client = reqwest::Client::builder()
        .build()
        .expect("HLS proxy: reqwest client failed");

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let c = client.clone();
                tokio::spawn(handle(stream, c));
            }
            Err(_) => {}
        }
    }
}

async fn handle(mut stream: TcpStream, client: reqwest::Client) {
    let mut buf = vec![0u8; 8192];
    let n = match stream.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let req = String::from_utf8_lossy(&buf[..n]);
    let first_line = req.lines().next().unwrap_or("");

    if first_line.starts_with("OPTIONS") {
        let _ = stream.write_all(
            b"HTTP/1.1 204 No Content\r\n\
              Access-Control-Allow-Origin: *\r\n\
              Access-Control-Allow-Methods: GET, OPTIONS\r\n\
              Access-Control-Allow-Headers: *\r\n\
              Connection: close\r\nContent-Length: 0\r\n\r\n",
        ).await;
        return;
    }

    let encoded = first_line
        .strip_prefix("GET /proxy?url=")
        .and_then(|s| s.split(' ').next())
        .unwrap_or("");

    if encoded.is_empty() {
        let _ = stream.write_all(
            b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        ).await;
        return;
    }

    let target = urlencoding::decode(encoded).unwrap_or_default().into_owned();

    // Forward select headers from the browser request (User-Agent, Accept, Accept-Language).
    // Strip Origin, Referer, Host, Cookie — those expose the browser's identity to the CDN.
    let mut req_builder = client.get(&target);
    for line in req.lines().skip(1) {
        if line.is_empty() { break; }
        if let Some(pos) = line.find(':') {
            let name = line[..pos].trim().to_lowercase();
            let value = line[pos + 1..].trim();
            match name.as_str() {
                "user-agent" | "accept" | "accept-language" | "accept-encoding" => {
                    req_builder = req_builder.header(&name, value);
                }
                _ => {}
            }
        }
    }

    match req_builder.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let final_url = resp.url().clone();
            let ct = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_owned();
            let raw = resp.bytes().await.unwrap_or_default();

            // If the response is an HLS playlist, rewrite every URL line so segments,
            // variants, and keys all come back through this proxy. Without this,
            // HLS.js may bypass our JS loader and fetch segments directly.
            let is_m3u8 = ct.contains("mpegurl")
                || ct.contains("m3u8")
                || target.to_lowercase().contains(".m3u8");
            let body: Vec<u8> = if is_m3u8 {
                match std::str::from_utf8(&raw) {
                    Ok(text) => rewrite_m3u8(text, &final_url).into_bytes(),
                    Err(_) => raw.to_vec(),
                }
            } else {
                raw.to_vec()
            };

            let header = format!(
                "HTTP/1.1 {status} OK\r\n\
                 Access-Control-Allow-Origin: *\r\n\
                 Content-Type: {ct}\r\n\
                 Content-Length: {}\r\n\
                 Connection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes()).await;
            let _ = stream.write_all(&body).await;
        }
        Err(e) => {
            let msg = format!("proxy error: {e}");
            let header = format!(
                "HTTP/1.1 502 Bad Gateway\r\n\
                 Access-Control-Allow-Origin: *\r\n\
                 Content-Length: {}\r\n\
                 Connection: close\r\n\r\n",
                msg.len()
            );
            let _ = stream.write_all(header.as_bytes()).await;
            let _ = stream.write_all(msg.as_bytes()).await;
        }
    }
}

/// Rewrite every URL in an HLS manifest to route through this proxy.
/// Handles:
///   - Absolute URLs on non-comment lines (segments, variant playlists)
///   - Relative URLs on non-comment lines (resolved against `base`)
///   - URI="..." attributes inside #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, etc.
fn rewrite_m3u8(text: &str, base: &reqwest::Url) -> String {
    let port = port().unwrap_or(0);
    let wrap = |u: &str| -> String {
        // Resolve relative URLs against the manifest's final (post-redirect) URL.
        let absolute = match base.join(u) {
            Ok(v) => v.to_string(),
            Err(_) => u.to_string(),
        };
        format!(
            "http://127.0.0.1:{port}/proxy?url={}",
            urlencoding::encode(&absolute)
        )
    };

    let mut out = String::with_capacity(text.len() + 256);
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            out.push('\n');
            continue;
        }
        if trimmed.starts_with('#') {
            // Rewrite any URI="..." attribute inside the tag.
            if let Some(start) = line.find("URI=\"") {
                let after = start + 5;
                if let Some(end_rel) = line[after..].find('"') {
                    let end = after + end_rel;
                    let uri = &line[after..end];
                    let replaced = wrap(uri);
                    out.push_str(&line[..after]);
                    out.push_str(&replaced);
                    out.push_str(&line[end..]);
                    out.push('\n');
                    continue;
                }
            }
            out.push_str(line);
            out.push('\n');
        } else {
            out.push_str(&wrap(trimmed));
            out.push('\n');
        }
    }
    out
}
