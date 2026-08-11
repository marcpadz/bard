// Live check: fetch OpenRouter models and confirm free filtering works.
// Uses the same shape as openrouter.rs — this test shells out to curl and
// parses with serde_json only, so no extra deps.
#[test]
fn live_free_models_check() {
    let out = std::process::Command::new("curl")
        .args(["-s", "https://openrouter.ai/api/v1/models"])
        .output()
        .expect("curl failed");
    let body = String::from_utf8(out.stdout).unwrap();
    let json: serde_json::Value = serde_json::from_str(&body).unwrap();
    let data = json["data"].as_array().unwrap();

    let zero = |v: &str| v.parse::<f64>().map(|n| n == 0.0).unwrap_or(false);
    let free: Vec<&serde_json::Value> = data
        .iter()
        .filter(|m| {
            let Some(p) = m["pricing"].as_object() else {
                return false;
            };
            let prompt_ok = p
                .get("prompt")
                .map(|v| v.as_str().map(zero).unwrap_or(false))
                .unwrap_or(true);
            let completion_ok = p
                .get("completion")
                .map(|v| v.as_str().map(zero).unwrap_or(false))
                .unwrap_or(true);
            prompt_ok && completion_ok
        })
        .collect();

    println!("FREE MODELS: {}", free.len());
    for m in free.iter().take(5) {
        println!("  - {}", m["id"].as_str().unwrap());
    }
    assert!(free.len() > 0, "expected at least one free model");
}
