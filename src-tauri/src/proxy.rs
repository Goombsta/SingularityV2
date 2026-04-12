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
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
             AppleWebKit/537.36 (KHTML, like Gecko) \
             Chrome/120.0.0.0 Safari/537.36",
        )
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

    match client.get(&target).send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let ct = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_owned();
            let body = resp.bytes().await.unwrap_or_default();
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
