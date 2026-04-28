use reqwest::Client;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const OLLAMA_DEFAULT_URL: &str = "http://localhost:11434";
const DEFAULT_MODEL: &str = "mistral:7b";

#[derive(Error, Debug)]
pub enum OllamaError {
    #[error("Network error: {0}")]
    Network(String),
    #[error("Ollama not available")]
    NotAvailable,
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("Timeout - LLM took too long")]
    Timeout,
}

#[derive(Serialize)]
struct GenerateRequest {
    model: String,
    prompt: String,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<GenerateOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
}

#[derive(Serialize)]
struct GenerateOptions {
    temperature: f32,
    num_predict: i32,
    top_p: f32,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
    #[allow(dead_code)]
    done: bool,
}

#[derive(Deserialize)]
struct ModelInfo {
    name: String,
}

#[derive(Deserialize)]
struct ModelsResponse {
    models: Vec<ModelInfo>,
}

#[derive(Serialize)]
struct EmbedRequest {
    model: String,
    input: Vec<String>,
}

#[derive(Deserialize)]
struct EmbedResponse {
    embeddings: Vec<Vec<f32>>,
    #[allow(dead_code)]
    model: Option<String>,
}

/// Ollama LLM Client for local AI inference
#[derive(Clone)]
pub struct OllamaClient {
    client: Arc<Client>,
    base_url: String,
    model: String,
}

impl OllamaClient {
    /// Create a new Ollama client with default settings
    pub fn new() -> Self {
        Self {
            client: Arc::new(
                Client::builder()
                    .timeout(std::time::Duration::from_secs(90))
                    .build()
                    .expect("Failed to create HTTP client")
            ),
            base_url: OLLAMA_DEFAULT_URL.to_string(),
            model: DEFAULT_MODEL.to_string(),
        }
    }

    /// Create client with custom URL and model
    pub fn with_config(base_url: &str, model: &str) -> Self {
        Self {
            client: Arc::new(
                Client::builder()
                    .timeout(std::time::Duration::from_secs(90))
                    .build()
                    .expect("Failed to create HTTP client")
            ),
            base_url: base_url.to_string(),
            model: model.to_string(),
        }
    }

    /// Check if Ollama server is available
    pub async fn is_available(&self) -> bool {
        self.client
            .get(format!("{}/api/tags", self.base_url))
            .send()
            .await
            .is_ok()
    }

    /// List available models (API + CLI fallback)
    pub async fn list_models(&self) -> Result<Vec<String>, OllamaError> {
        // Try API first
        let response = self.client
            .get(format!("{}/api/tags", self.base_url))
            .send()
            .await
            .map_err(|e| OllamaError::Network(e.to_string()))?;

        let models: ModelsResponse = response
            .json()
            .await
            .map_err(|e| OllamaError::Parse(e.to_string()))?;

        let mut model_names: Vec<String> = models.models.into_iter().map(|m| m.name).collect();

        // If API returns empty, fallback to CLI `ollama list`
        if model_names.is_empty() {
            if let Ok(output) = tokio::process::Command::new("ollama")
                .arg("list")
                .output()
                .await
            {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    for line in stdout.lines().skip(1) {
                        // Each line: "model_name    ID    SIZE    MODIFIED"
                        if let Some(name) = line.split_whitespace().next() {
                            if !name.is_empty() && name != "NAME" {
                                model_names.push(name.to_string());
                            }
                        }
                    }
                }
            }
        }

        Ok(model_names)
    }

    /// Generate embeddings via POST /api/embed
    pub async fn embed(&self, texts: Vec<String>, model: &str) -> Result<Vec<Vec<f32>>, OllamaError> {
        let request = EmbedRequest {
            model: model.to_string(),
            input: texts,
        };

        let response = self.client
            .post(format!("{}/api/embed", self.base_url))
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() { 
                    OllamaError::Timeout 
                } else { 
                    OllamaError::Network(e.to_string()) 
                }
            })?;

        if !response.status().is_success() {
            return Err(OllamaError::Network(
                format!("Embed failed: {}", response.status())
            ));
        }

        let result: EmbedResponse = response
            .json()
            .await
            .map_err(|e| OllamaError::Parse(e.to_string()))?;

        Ok(result.embeddings)
    }

    /// Embed single text (convenience wrapper)
    pub async fn embed_single(&self, text: &str, model: &str) -> Result<Vec<f32>, OllamaError> {
        let results = self.embed(vec![text.to_string()], model).await?;
        results.into_iter().next()
            .ok_or(OllamaError::Parse("No embedding returned".to_string()))
    }

    /// Generate a response from the LLM
    pub async fn generate(&self, prompt: &str) -> Result<String, OllamaError> {
        self.generate_with_options(prompt, 0.7, 500).await
    }

    /// Generate with custom temperature and max tokens
    pub async fn generate_with_options(
        &self,
        prompt: &str,
        temperature: f32,
        max_tokens: i32,
    ) -> Result<String, OllamaError> {
        self.generate_with_options_advanced(prompt, temperature, max_tokens, None, None).await
    }

    /// Generate with custom temperature, max tokens, format, and system prompt
    pub async fn generate_with_options_advanced(
        &self,
        prompt: &str,
        temperature: f32,
        max_tokens: i32,
        format: Option<String>,
        system: Option<String>,
    ) -> Result<String, OllamaError> {
        let request = GenerateRequest {
            model: self.model.clone(),
            prompt: prompt.to_string(),
            stream: false,
            format,
            system,
            options: Some(GenerateOptions {
                temperature,
                num_predict: max_tokens,
                top_p: 0.9,
            }),
        };

        let response = self.client
            .post(format!("{}/api/generate", self.base_url))
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    OllamaError::Timeout
                } else {
                    OllamaError::Network(e.to_string())
                }
            })?;

        if !response.status().is_success() {
            return Err(OllamaError::Network(format!(
                "Ollama returned status: {}",
                response.status()
            )));
        }

        let result: GenerateResponse = response
            .json()
            .await
            .map_err(|e| OllamaError::Parse(e.to_string()))?;

        Ok(result.response)
    }

    /// Generate JSON response (structured output)
    pub async fn generate_json<T: for<'de> Deserialize<'de>>(
        &self,
        prompt: &str,
    ) -> Result<T, OllamaError> {
        let system_prompt = "You are a JSON API. Return ONLY valid JSON. Never include reasoning, thoughts, or explanations. Output must be parseable JSON.".to_string();
        let json_prompt = format!(
            "{}\n\nIMPORTANT: Return ONLY a valid JSON object or array. Do NOT include any text before or after.",
            prompt
        );

        let response = self.generate_with_options_advanced(&json_prompt, 0.3, 2048, Some("json".to_string()), Some(system_prompt)).await?;
        
        // Try to extract JSON from response
        let json_str = extract_json(&response)?;
        
        serde_json::from_str(&json_str)
            .map_err(|e| OllamaError::Parse(format!("Invalid JSON: {} - Response was: {}", e, json_str)))
    }

    /// Generate JSON response with larger token budget (FAZA 6 - insights/recommendations)
    pub async fn generate_json_large<T: for<'de> Deserialize<'de>>(
        &self,
        prompt: &str,
    ) -> Result<T, OllamaError> {
        let system_prompt = "You are a JSON API. Return ONLY valid JSON. Never include reasoning, thoughts, or explanations. Output must be parseable JSON.".to_string();
        let json_prompt = format!(
            "{}\n\nIMPORTANT: Return ONLY a valid JSON object or array. Do NOT include any text before or after.",
            prompt
        );

        // Use a dedicated client with longer timeout for large generations
        let long_client = Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .map_err(|e| OllamaError::Network(e.to_string()))?;

        let request = GenerateRequest {
            model: self.model.clone(),
            prompt: json_prompt,
            stream: false,
            format: Some("json".to_string()),
            system: Some(system_prompt),
            options: Some(GenerateOptions {
                temperature: 0.3,
                num_predict: 4096,
                top_p: 0.9,
            }),
        };

        let response = long_client
            .post(format!("{}/api/generate", self.base_url))
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    OllamaError::Timeout
                } else {
                    OllamaError::Network(e.to_string())
                }
            })?;

        if !response.status().is_success() {
            return Err(OllamaError::Network(format!(
                "Ollama returned status: {}",
                response.status()
            )));
        }

        let result: GenerateResponse = response
            .json()
            .await
            .map_err(|e| OllamaError::Parse(e.to_string()))?;
        
        let json_str = extract_json(&result.response)?;
        
        // Try parsing directly first; if it fails, attempt to repair truncated JSON
        match serde_json::from_str(&json_str) {
            Ok(v) => Ok(v),
            Err(e) => {
                let repaired = repair_truncated_json(&json_str);
                serde_json::from_str(&repaired)
                    .map_err(|e2| OllamaError::Parse(format!("Invalid JSON (even after repair): {} - Original error: {}", e2, e)))
            }
        }
    }

    /// Generate JSON response with custom temperature (FAZA 2 - for consistent tagging)
    pub async fn generate_json_with_temp<T: for<'de> Deserialize<'de>>(
        &self,
        prompt: &str,
        temperature: f32,
    ) -> Result<T, OllamaError> {
        let system_prompt = "You are a JSON API. Return ONLY valid JSON. Never include reasoning, thoughts, explanations, or chain-of-thought. Output must be parseable JSON starting with { or [.".to_string();
        let json_prompt = format!(
            "{}\n\nIMPORTANT: Return ONLY a valid JSON object or array. Do NOT include any text before or after. Do NOT include any reasoning or explanation.",
            prompt
        );

        let response = self.generate_with_options_advanced(&json_prompt, temperature, 2048, Some("json".to_string()), Some(system_prompt)).await?;
        
        // Try to extract JSON from response
        let json_str = extract_json(&response)?;
        
        serde_json::from_str(&json_str)
            .map_err(|e| OllamaError::Parse(format!("Invalid JSON: {} - Response was: {}", e, json_str)))
    }
}

impl Default for OllamaClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Repair truncated JSON by closing any unclosed brackets/braces.
/// This handles the common case where LLM output is cut off mid-array/object.
fn repair_truncated_json(json: &str) -> String {
    let mut result = json.trim_end().to_string();
    
    // Remove trailing comma if present (common in truncated arrays/objects)
    if result.ends_with(',') {
        result.pop();
    }
    
    // Count unclosed brackets/braces
    let mut stack: Vec<char> = Vec::new();
    let mut in_string = false;
    let mut escape_next = false;
    
    for ch in result.chars() {
        if escape_next {
            escape_next = false;
            continue;
        }
        if ch == '\\' && in_string {
            escape_next = true;
            continue;
        }
        if ch == '"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        match ch {
            '{' => stack.push('}'),
            '[' => stack.push(']'),
            '}' | ']' => { stack.pop(); }
            _ => {}
        }
    }
    
    // If we're still inside a string, close it
    if in_string {
        result.push('"');
    }
    
    // Close remaining unclosed brackets/braces in reverse order
    while let Some(closer) = stack.pop() {
        result.push(closer);
    }
    
    result
}

/// Extract JSON from LLM response (handles markdown code blocks, thinking tokens, and truncation)
fn extract_json(text: &str) -> Result<String, OllamaError> {
    let mut content = text.trim().to_string();
    
    // Strip <think>...</think> blocks (DeepSeek R1, QwQ style)
    while let Some(start) = content.find("<think>") {
        if let Some(end) = content.find("</think>") {
            // Remove the <think>...</think> block
            content = format!("{}{}", &content[..start], &content[end + 8..]);
        } else {
            // Unclosed <think>, remove from start onwards
            content = content[..start].to_string();
            break;
        }
    }
    
    // Strip THOUGHT: ... blocks (until next clear text or start of JSON)
    if let Some(thought_pos) = content.find("THOUGHT:") {
        if let Some(json_start) = content[thought_pos..].find('{').or_else(|| content[thought_pos..].find('[')) {
            // JSON found after THOUGHT:, skip to it
            content = content[thought_pos + json_start..].to_string();
        } else {
            // No JSON after THOUGHT:, return error
            return Err(OllamaError::Parse(format!("Could not extract JSON from response: {}", &text[..text.len().min(200)])));
        }
    }
    
    let trimmed = content.trim();
    
    // Check if wrapped in code block
    if trimmed.starts_with("```json") {
        if let Some(end) = trimmed.rfind("```") {
            let start = trimmed.find('\n').unwrap_or(7) + 1;
            if start < end {
                return Ok(trimmed[start..end].trim().to_string());
            }
        }
    }
    
    if trimmed.starts_with("```") {
        if let Some(end) = trimmed.rfind("```") {
            let start = trimmed.find('\n').unwrap_or(3) + 1;
            if start < end {
                return Ok(trimmed[start..end].trim().to_string());
            }
        }
    }
    
    // Check if it's already JSON
    if (trimmed.starts_with('{') && (trimmed.ends_with('}') || trimmed.ends_with('}')))
        || (trimmed.starts_with('[') && (trimmed.ends_with(']') || trimmed.ends_with(']')))
    {
        return Ok(trimmed.to_string());
    }

    // Try to find JSON from first { or [ to last } or ]
    let start_brace = trimmed.find('{');
    let start_bracket = trimmed.find('[');
    
    match (start_brace, start_bracket) {
        (Some(s), None) => {
            if let Some(e) = trimmed.rfind('}') {
                if s < e {
                    let extracted = trimmed[s..=e].to_string();
                    // Try to repair if truncated
                    return Ok(repair_truncated_json(&extracted));
                }
            }
        },
        (None, Some(s)) => {
            if let Some(e) = trimmed.rfind(']') {
                if s < e {
                    let extracted = trimmed[s..=e].to_string();
                    return Ok(repair_truncated_json(&extracted));
                }
            }
        },
        (Some(s_brace), Some(s_bracket)) => {
            let s = s_brace.min(s_bracket);
            let e_brace = trimmed.rfind('}');
            let e_bracket = trimmed.rfind(']');
            let e = e_brace.unwrap_or(0).max(e_bracket.unwrap_or(0));
            if s < e {
                let extracted = trimmed[s..=e].to_string();
                return Ok(repair_truncated_json(&extracted));
            }
        },
        _ => {}
    }
    
    Err(OllamaError::Parse(format!("Could not extract JSON from response: {}", &trimmed[..trimmed.len().min(200)])))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_json_plain() {
        let input = r#"{"key": "value"}"#;
        assert_eq!(extract_json(input).unwrap(), r#"{"key": "value"}"#);
    }

    #[test]
    fn test_extract_json_code_block() {
        let input = "```json\n{\"key\": \"value\"}\n```";
        assert_eq!(extract_json(input).unwrap(), r#"{"key": "value"}"#);
    }

    #[test]
    fn test_extract_json_array() {
        let input = r#"["a", "b", "c"]"#;
        assert_eq!(extract_json(input).unwrap(), r#"["a", "b", "c"]"#);
    }

    #[test]
    fn test_repair_truncated_json_unclosed_array() {
        let input = r#"{ "groups": [ { "canonical": "AC/DC", "variants": ["AC/DC"] }, { "canonical": "ABBA", "variants": ["ABBA"] }"#;
        let repaired = repair_truncated_json(input);
        assert!(serde_json::from_str::<serde_json::Value>(&repaired).is_ok());
    }

    #[test]
    fn test_repair_truncated_json_trailing_comma() {
        let input = r#"{ "groups": [ { "canonical": "AC/DC", "variants": ["AC/DC"] },"#;
        let repaired = repair_truncated_json(input);
        assert!(serde_json::from_str::<serde_json::Value>(&repaired).is_ok());
    }

    #[test]
    fn test_repair_complete_json_unchanged() {
        let input = r#"{ "groups": [] }"#;
        let repaired = repair_truncated_json(input);
        assert_eq!(repaired, input);
    }
}
