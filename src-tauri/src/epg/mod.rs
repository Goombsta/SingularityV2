pub mod xmltv;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpgProgram {
    pub channel_id: String,
    pub title: String,
    pub start: String,
    pub stop: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpgSource {
    pub id: String,
    pub url: String,
    pub name: String,
}

pub struct EpgCache {
    /// channel_id → list of programs
    pub programs: Mutex<HashMap<String, Vec<EpgProgram>>>,
    pub sources: Mutex<Vec<EpgSource>>,
}

impl EpgCache {
    pub fn new() -> Self {
        Self {
            programs: Mutex::new(HashMap::new()),
            sources: Mutex::new(Vec::new()),
        }
    }
}
