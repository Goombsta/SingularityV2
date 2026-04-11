use super::types::Channel;
use anyhow::{Context, Result};
use serde::Deserialize;

pub struct StalkerClient {
    pub portal_url: String,
    pub mac: String,
    client: reqwest::Client,
}

impl StalkerClient {
    pub fn new(portal_url: &str, mac: &str) -> Self {
        Self {
            portal_url: portal_url.trim_end_matches('/').to_string(),
            mac: mac.to_string(),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap(),
        }
    }

    fn headers(&self, token: &str) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("User-Agent", "Mozilla/5.0 (QtEmbedded; U; Linux; C)".parse().unwrap());
        headers.insert("X-User-Agent", "Model: MAG250; Link: WiFi".parse().unwrap());
        headers.insert(
            "Cookie",
            format!("mac={}; stb_lang=en; timezone=Europe/London", self.mac)
                .parse()
                .unwrap(),
        );
        if !token.is_empty() {
            headers.insert(
                "Authorization",
                format!("Bearer {}", token).parse().unwrap(),
            );
        }
        headers
    }

    async fn handshake(&self) -> Result<String> {
        #[derive(Deserialize)]
        struct HandshakeResponse {
            js: HandshakeJs,
        }
        #[derive(Deserialize)]
        struct HandshakeJs {
            token: String,
        }

        let url = format!("{}/portal.php?action=handshake&type=stb&token=", self.portal_url);
        let resp: HandshakeResponse = self
            .client
            .get(&url)
            .headers(self.headers(""))
            .send()
            .await
            .context("Stalker handshake failed")?
            .json()
            .await
            .context("Stalker handshake parse failed")?;

        Ok(resp.js.token)
    }

    pub async fn get_channels(&self, playlist_id: &str) -> Result<Vec<Channel>> {
        let token = self.handshake().await?;

        #[derive(Deserialize)]
        struct ChannelListResponse {
            js: ChannelListJs,
        }
        #[derive(Deserialize)]
        struct ChannelListJs {
            data: Vec<StalkerChannel>,
        }
        #[derive(Deserialize)]
        struct StalkerChannel {
            id: Option<String>,
            name: Option<String>,
            logo: Option<String>,
            cmd: Option<String>,
            tv_genre_id: Option<String>,
        }

        let url = format!(
            "{}/portal.php?action=get_all_channels&type=itv&action=get_ordered_list&genre=*&force_ch_link_check=&fav=0&sortby=number&hd=0&p=1",
            self.portal_url
        );

        let resp: ChannelListResponse = self
            .client
            .get(&url)
            .headers(self.headers(&token))
            .send()
            .await
            .context("Failed to fetch Stalker channels")?
            .json()
            .await
            .context("Failed to parse Stalker channels")?;

        Ok(resp
            .js
            .data
            .into_iter()
            .filter_map(|ch| {
                let name = ch.name?;
                let cmd = ch.cmd?;
                // Stalker stream URLs come as "ffrt http://..." — strip the prefix
                let stream_url = cmd
                    .strip_prefix("ffrt ")
                    .or(cmd.strip_prefix("ffrt3 "))
                    .unwrap_or(&cmd)
                    .to_string();

                Some(Channel {
                    id: ch.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                    name,
                    stream_url,
                    logo: ch.logo,
                    group_title: ch.tv_genre_id,
                    epg_channel_id: None,
                    playlist_id: playlist_id.to_string(),
                    stream_id: None,
                })
            })
            .collect())
    }
}
