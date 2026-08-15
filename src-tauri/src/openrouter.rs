use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

pub const OPENROUTER_BASE: &str = "https://openrouter.ai/api/v1";

/// Shared blocking client with a connection pool — building a fresh
/// `Client::new()` on every key-verify / model-fetch call is wasteful.
fn http_client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("failed to build OpenRouter HTTP client")
    })
}

/// Cache the free-model list so re-opening Settings (or re-mounting the app)
/// doesn't re-hit the OpenRouter API every time. Keyed by API key; cleared if
/// the key changes. A short TTL keeps the list fresh without hammering the API.
struct ModelCache {
    api_key: String,
    models: Vec<OpenRouterModel>,
    fetched_at: std::time::Instant,
}

fn models_cache() -> &'static Mutex<Option<ModelCache>> {
    static CACHE: OnceLock<Mutex<Option<ModelCache>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

const MODEL_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(300);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenRouterModel {
    pub id: String,
    pub name: String,
    pub pricing: Option<Pricing>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pricing {
    pub prompt: Option<String>,
    pub completion: Option<String>,
    pub request: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<RawModel>,
}

#[derive(Debug, Deserialize)]
struct RawModel {
    id: String,
    name: Option<String>,
    pricing: Option<Pricing>,
}

fn is_free(m: &RawModel) -> bool {
    let Some(pricing) = m.pricing.as_ref() else {
        return false;
    };
    let zero = |s: Option<&String>| {
        s.and_then(|v| v.parse::<f64>().ok())
            .map(|v| v == 0.0)
            .unwrap_or(false)
    };
    // A field is considered zero if it's explicitly "0" or missing entirely
    // (OpenRouter omits request/web_search for most models).
    let zero_or_missing = |s: Option<&String>| zero(s) || s.is_none();
    zero_or_missing(pricing.prompt.as_ref())
        && zero_or_missing(pricing.completion.as_ref())
        && zero_or_missing(pricing.request.as_ref())
}

fn fetch_json(url: &str, api_key: &str) -> Result<serde_json::Value, String> {
    let client = http_client();
    let res = client
        .get(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn verify_api_key(api_key: String) -> Result<(), String> {
    let json = fetch_json(&format!("{OPENROUTER_BASE}/models"), &api_key)?;
    if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
        if !data.is_empty() {
            return Ok(());
        }
    }
    Err("No models returned".into())
}

#[tauri::command]
pub fn fetch_free_models(api_key: String) -> Result<Vec<OpenRouterModel>, String> {
    // Serve from cache if present, fresh, and for the same key.
    {
        let cache = models_cache().lock().unwrap();
        if let Some(c) = cache.as_ref() {
            if c.api_key == api_key && c.fetched_at.elapsed() < MODEL_CACHE_TTL {
                return Ok(c.models.clone());
            }
        }
    }

    let json = fetch_json(&format!("{OPENROUTER_BASE}/models"), &api_key)?;
    let parsed: ModelsResponse = serde_json::from_value(json).map_err(|e| e.to_string())?;
    let mut models: Vec<OpenRouterModel> = parsed
        .data
        .into_iter()
        .filter(is_free)
        .map(|m| OpenRouterModel {
            id: m.id,
            name: m.name.unwrap_or_default(),
            pricing: m.pricing,
        })
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));

    // Populate the cache so Settings / app re-mounts are instant.
    let mut cache = models_cache().lock().unwrap();
    *cache = Some(ModelCache {
        api_key,
        models: models.clone(),
        fetched_at: std::time::Instant::now(),
    });

    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_models_without_request_field_are_included() {
        // Real API shape: free models have pricing = {"prompt": "0", "completion": "0"}, no request field.
        let model = RawModel {
            id: "test/free:free".into(),
            name: Some("Test Free".into()),
            pricing: Some(Pricing {
                prompt: Some("0".into()),
                completion: Some("0".into()),
                request: None,
            }),
        };
        assert!(is_free(&model), "free model with missing request field must be included");
    }

    #[test]
    fn paid_models_are_excluded() {
        let model = RawModel {
            id: "test/paid".into(),
            name: Some("Test Paid".into()),
            pricing: Some(Pricing {
                prompt: Some("0.00000095".into()),
                completion: Some("0.000004".into()),
                request: None,
            }),
        };
        assert!(!is_free(&model), "paid model must be excluded");
    }

    #[test]
    fn all_zero_pricing_is_free() {
        let model = RawModel {
            id: "test/all-zero".into(),
            name: None,
            pricing: Some(Pricing {
                prompt: Some("0".into()),
                completion: Some("0".into()),
                request: Some("0".into()),
            }),
        };
        assert!(is_free(&model));
    }

    #[test]
    fn missing_pricing_is_not_free() {
        let model = RawModel {
            id: "test/no-pricing".into(),
            name: None,
            pricing: None,
        };
        assert!(!is_free(&model));
    }
}
