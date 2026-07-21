use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderName, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::sync::Arc;
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::RwLock;
use tokio_util::io::ReaderStream;
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info, warn};

use crate::ytdlp;

// ── Upstream proxy timeouts ────────────────────────────────────────────────────
//
// UPSTREAM_CONNECT_TIMEOUT (10s): bound for the TCP+TLS handshake to a CDN
// edge server. Generously above the sub-second connect latency normally seen
// against googlevideo.com, but short enough that a firewalled/unreachable
// host fails fast instead of hanging the request indefinitely.
//
// UPSTREAM_RESPONSE_TIMEOUT (15s): bound for receiving response status and
// headers after the request is sent. This mission's own HTTP probes against
// googlevideo.com observed response times in the low hundreds of
// milliseconds; 15s leaves ample headroom for network jitter or a slow CDN
// edge while still failing well before a user perceives the app as hung.
//
// UPSTREAM_READ_IDLE_TIMEOUT (20s): bound on the gap between successive body
// chunks once streaming has started. Deliberately longer than the response
// timeout to tolerate normal mid-stream jitter, but still short enough to
// release a stalled connection promptly. This is an IDLE timeout -- it
// resets on every successful chunk -- not a total-track deadline, so a slow
// but steadily-progressing multi-minute track is never cut off.
const UPSTREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const UPSTREAM_RESPONSE_TIMEOUT: Duration = Duration::from_secs(15);
const UPSTREAM_READ_IDLE_TIMEOUT: Duration = Duration::from_secs(20);

/// Injectable timeout configuration. Production code always uses
/// [`ProxyTimeouts::production`]; tests inject short values so resilience
/// tests run in milliseconds instead of tens of seconds.
#[derive(Clone, Copy)]
struct ProxyTimeouts {
    connect: Duration,
    response: Duration,
    read_idle: Duration,
}

impl ProxyTimeouts {
    fn production() -> Self {
        Self {
            connect: UPSTREAM_CONNECT_TIMEOUT,
            response: UPSTREAM_RESPONSE_TIMEOUT,
            read_idle: UPSTREAM_READ_IDLE_TIMEOUT,
        }
    }
}

/// Builds the shared HTTP client used for the audio proxy. `connect_timeout`
/// bounds the handshake; `read_timeout` bounds the idle gap between reads
/// (covers both the initial response and each body chunk) -- there is
/// deliberately no total-request timeout, so long tracks are never cut off
/// purely for taking a while to finish streaming.
fn build_http_client(timeouts: ProxyTimeouts) -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(timeouts.connect)
        .read_timeout(timeouts.read_idle)
        .build()
        .expect("audio-proxy HTTP client has only static, valid timeout configuration")
}

// ── Cached audio URL ──────────────────────────────────────────────────────────

#[derive(Clone)]
struct CachedUrl {
    url: String,
    expires_at: std::time::Instant,
}

// ── Cached video + audio URLs (used to avoid double yt-dlp calls) ─────────────

#[derive(Clone)]
struct CachedVideoUrls {
    video_url: String,
    audio_url: String,
    expires_at: std::time::Instant,
}

// ── Combined Axum state ───────────────────────────────────────────────────────

#[derive(Clone)]
struct ServerAppState {
    audio_cache: Arc<RwLock<std::collections::HashMap<String, CachedUrl>>>,
    video_cache: Arc<RwLock<std::collections::HashMap<String, CachedVideoUrls>>>,
    http_client: reqwest::Client,
}

// ── StreamServer (public) ─────────────────────────────────────────────────────

#[derive(Clone)]
pub struct StreamServer {
    port: u16,
    audio_cache: Arc<RwLock<std::collections::HashMap<String, CachedUrl>>>,
    video_cache: Arc<RwLock<std::collections::HashMap<String, CachedVideoUrls>>>,
    http_client: reqwest::Client,
}

impl StreamServer {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            audio_cache: Arc::new(RwLock::new(std::collections::HashMap::new())),
            video_cache: Arc::new(RwLock::new(std::collections::HashMap::new())),
            http_client: build_http_client(ProxyTimeouts::production()),
        }
    }

    /// Returns the local audio-proxy URL for a given video ID.
    pub fn get_stream_url(&self, video_id: &str) -> String {
        format!("http://localhost:{}/stream/{}", self.port, video_id)
    }

    /// Returns the local video-stream URL for a given video ID.
    pub fn get_video_stream_url(&self, video_id: &str) -> String {
        format!("http://localhost:{}/stream/video/{}", self.port, video_id)
    }

    pub async fn start(&self) {
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let state = ServerAppState {
            audio_cache: self.audio_cache.clone(),
            video_cache: self.video_cache.clone(),
            http_client: self.http_client.clone(),
        };

        let app = Router::new()
            .route("/stream/video/:video_id", get(video_stream_handler))
            .route("/stream/:video_id", get(stream_handler))
            .route("/tts/:filename", get(tts_file_handler))
            .route("/health", get(health_handler))
            .layer(cors)
            .with_state(state);

        let addr = format!("127.0.0.1:{}", self.port);
        info!("Starting stream server on {}", addr);

        // Retry binding with backoff — protects against stale processes holding the port
        let mut retries = 5;
        let listener = loop {
            match tokio::net::TcpListener::bind(&addr).await {
                Ok(l) => break l,
                Err(e) if retries > 0 => {
                    warn!(
                        "Port {} in use, retrying in 2s ({} retries left): {}",
                        self.port, retries, e
                    );
                    retries -= 1;
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
                Err(e) => {
                    error!(
                        "Failed to bind stream server on {} after retries: {}",
                        addr, e
                    );
                    return;
                }
            }
        };

        info!("Stream server listening on {}", addr);
        if let Err(e) = axum::serve(listener, app).await {
            error!("Stream server error: {}", e);
        }
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health_handler() -> &'static str {
    "OK"
}

/// Audio proxy: streams the resolved CDN audio through this same-origin
/// route instead of redirecting the browser to it. The browser's <audio>
/// element only ever talks to http://localhost:<port>/..., which is already
/// covered by the app's CSP `media-src`; the actual cross-origin CDN
/// origin (e.g. googlevideo.com) is never contacted by the browser directly,
/// so no CSP change is needed.
async fn stream_handler(
    State(state): State<ServerAppState>,
    Path(video_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);

    // Check cache first
    let cached_url = {
        let cache_read = state.audio_cache.read().await;
        cache_read.get(&video_id).and_then(|cached| {
            (cached.expires_at > std::time::Instant::now()).then(|| cached.url.clone())
        })
    };

    let url = match cached_url {
        Some(url) => url,
        None => match ytdlp::get_audio_url(&video_id).await {
            Ok(url) => {
                let cached = CachedUrl {
                    url: url.clone(),
                    expires_at: std::time::Instant::now() + std::time::Duration::from_secs(300),
                };
                let mut cache_write = state.audio_cache.write().await;
                cache_write.insert(video_id, cached);
                url
            }
            Err(e) => {
                error!("Failed to get audio URL for {}: {}", video_id, e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get audio: {}", e),
                )
                    .into_response();
            }
        },
    };

    match proxy_audio(
        &state.http_client,
        &url,
        range.as_deref(),
        ProxyTimeouts::production().response,
    )
    .await
    {
        Ok(response) => response,
        Err(proxy_error) => proxy_error.into_response(),
    }
}

/// Errors from the audio proxy path. Variants intentionally carry no
/// upstream-URL or raw-error data -- the resolved CDN URL is signed and must
/// never reach logs, error bodies, or test output.
#[derive(Debug, PartialEq, Eq)]
enum ProxyError {
    InvalidScheme,
    /// No response headers within the response-timeout window. Distinct from
    /// UpstreamRequestFailed so it can be mapped to 504 rather than 502, and
    /// distinct from a mid-body stall (which happens after this function has
    /// already returned Ok and cannot change the emitted status).
    UpstreamTimeout,
    UpstreamRequestFailed,
    UpstreamStatus(StatusCode),
    BuildResponseFailed,
}

impl ProxyError {
    fn into_response(self) -> Response {
        match self {
            ProxyError::InvalidScheme => {
                error!("Audio proxy: resolved upstream URL had a disallowed scheme");
                (StatusCode::BAD_GATEWAY, "Invalid upstream audio source").into_response()
            }
            ProxyError::UpstreamTimeout => {
                error!("Audio proxy: timed out waiting for upstream response headers");
                (
                    StatusCode::GATEWAY_TIMEOUT,
                    "Upstream audio source timed out",
                )
                    .into_response()
            }
            ProxyError::UpstreamRequestFailed => {
                error!("Audio proxy: upstream request failed (connection or transport error)");
                (
                    StatusCode::BAD_GATEWAY,
                    "Failed to reach upstream audio source",
                )
                    .into_response()
            }
            ProxyError::UpstreamStatus(status) => {
                error!("Audio proxy: upstream returned non-media status {}", status);
                (
                    StatusCode::BAD_GATEWAY,
                    "Upstream audio source returned an error",
                )
                    .into_response()
            }
            ProxyError::BuildResponseFailed => {
                error!("Audio proxy: failed to build proxy response");
                (StatusCode::BAD_GATEWAY, "Failed to build proxy response").into_response()
            }
        }
    }
}

/// Response headers safe to forward from the upstream CDN to the browser.
/// Deliberately an allow-list: hop-by-hop and any other upstream headers
/// (which could include cache/tracking identifiers not meant for this proxy
/// boundary) are dropped.
fn forwardable_response_headers() -> [HeaderName; 7] {
    [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::CACHE_CONTROL,
        header::ETAG,
        header::LAST_MODIFIED,
    ]
}

/// Require the resolved upstream URL to be https. Parsed with the `url`
/// crate; never logs the URL (or its query string) either on success or
/// rejection.
fn validate_https_upstream_url(raw_url: &str) -> Result<(), ProxyError> {
    let parsed = url::Url::parse(raw_url).map_err(|_| ProxyError::InvalidScheme)?;
    if parsed.scheme() == "https" {
        Ok(())
    } else {
        Err(ProxyError::InvalidScheme)
    }
}

/// Fetch the upstream CDN URL and stream its body back without buffering the
/// full track in memory. Forwards the client's Range header upstream (for
/// seeking) and only the allow-listed response headers back downstream.
///
/// `response_timeout` bounds only the wait for status + headers (the
/// `request.send()` future resolves once those arrive, before any body
/// bytes are polled). It is a distinct, application-level guarantee on top
/// of the client's own `read_timeout` (which separately bounds inter-read
/// gaps once body streaming has started -- see build_http_client).
async fn fetch_and_stream_upstream(
    client: &reqwest::Client,
    upstream_url: &str,
    range: Option<&str>,
    response_timeout: Duration,
) -> Result<Response, ProxyError> {
    let mut request = client.get(upstream_url);
    if let Some(range_value) = range {
        request = request.header(header::RANGE, range_value);
    }

    let upstream_response = match tokio::time::timeout(response_timeout, request.send()).await {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => return Err(ProxyError::UpstreamRequestFailed),
        Err(_) => return Err(ProxyError::UpstreamTimeout),
    };

    let status = upstream_response.status();
    if status != StatusCode::OK && status != StatusCode::PARTIAL_CONTENT {
        return Err(ProxyError::UpstreamStatus(status));
    }

    let mut builder = Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    {
        let upstream_headers = upstream_response.headers();
        for name in forwardable_response_headers() {
            if let Some(value) = upstream_headers.get(&name) {
                builder = builder.header(name, value.clone());
            }
        }
    }

    let body = axum::body::Body::from_stream(upstream_response.bytes_stream());
    builder
        .body(body)
        .map_err(|_| ProxyError::BuildResponseFailed)
}

/// Validate the resolved CDN URL, then fetch and stream it. Never returns a
/// redirect: the browser only ever sees this route's own response.
async fn proxy_audio(
    client: &reqwest::Client,
    upstream_url: &str,
    range: Option<&str>,
    response_timeout: Duration,
) -> Result<Response, ProxyError> {
    validate_https_upstream_url(upstream_url)?;
    fetch_and_stream_upstream(client, upstream_url, range, response_timeout).await
}

/// Video stream: uses ffmpeg to mux separate video+audio CDN streams into
/// a fragmented MP4 piped directly to the client.  Falls back gracefully when
/// ffmpeg is unavailable.
async fn video_stream_handler(
    State(state): State<ServerAppState>,
    Path(video_id): Path<String>,
) -> Response {
    // Resolve video + audio URLs (cached to avoid double yt-dlp calls)
    let (video_url, audio_url) = {
        let cache_read = state.video_cache.read().await;
        if let Some(c) = cache_read.get(&video_id) {
            if c.expires_at > std::time::Instant::now() {
                (c.video_url.clone(), c.audio_url.clone())
            } else {
                drop(cache_read);
                match fetch_and_cache_video_urls(&video_id, &state.video_cache).await {
                    Ok(pair) => pair,
                    Err(e) => {
                        error!("yt-dlp video URLs failed for {}: {}", video_id, e);
                        return (StatusCode::BAD_GATEWAY, format!("yt-dlp error: {}", e))
                            .into_response();
                    }
                }
            }
        } else {
            drop(cache_read);
            match fetch_and_cache_video_urls(&video_id, &state.video_cache).await {
                Ok(pair) => pair,
                Err(e) => {
                    error!("yt-dlp video URLs failed for {}: {}", video_id, e);
                    return (StatusCode::BAD_GATEWAY, format!("yt-dlp error: {}", e))
                        .into_response();
                }
            }
        }
    };

    // Spawn ffmpeg: mux video+audio → fragmented MP4 → stdout
    // -movflags frag_keyframe+empty_moov enables live streaming without a seek table
    let child_result = Command::new("ffmpeg")
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            &video_url,
            "-i",
            &audio_url,
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            "-f",
            "mp4",
            "pipe:1",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn();

    match child_result {
        Ok(mut child) => {
            let stdout = match child.stdout.take() {
                Some(s) => s,
                None => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "ffmpeg stdout unavailable",
                    )
                        .into_response()
                }
            };

            // Spawn task that waits for the child so it doesn't become a zombie
            tokio::spawn(async move {
                let _ = child.wait().await;
            });

            let stream = ReaderStream::new(stdout);
            let body = axum::body::Body::from_stream(stream);

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "video/mp4")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CACHE_CONTROL, "no-cache")
                .body(body)
                .unwrap()
        }
        Err(e) => {
            error!("Failed to spawn ffmpeg for {}: {}", video_id, e);
            (
                StatusCode::SERVICE_UNAVAILABLE,
                format!(
                    "ffmpeg not available: {}. Install ffmpeg to enable HD video.",
                    e
                ),
            )
                .into_response()
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn fetch_and_cache_video_urls(
    video_id: &str,
    video_cache: &Arc<RwLock<std::collections::HashMap<String, CachedVideoUrls>>>,
) -> Result<(String, String), String> {
    let (video_url, audio_url) = ytdlp::get_video_urls(video_id)
        .await
        .map_err(|e| e.to_string())?;

    let cached = CachedVideoUrls {
        video_url: video_url.clone(),
        audio_url: audio_url.clone(),
        expires_at: std::time::Instant::now() + std::time::Duration::from_secs(300),
    };
    {
        let mut w = video_cache.write().await;
        w.insert(video_id.to_string(), cached);
    }
    Ok((video_url, audio_url))
}

/// TTS file handler: serves edge-tts generated MP3 files from system temp dir.
async fn tts_file_handler(Path(filename): Path<String>) -> Response {
    // Safety: only allow ytmfree_dj_*.mp3 filenames — no path traversal
    if !filename.starts_with("ytmfree_dj_") || !filename.ends_with(".mp3") {
        return (StatusCode::FORBIDDEN, "Invalid TTS filename").into_response();
    }

    let temp_path = std::env::temp_dir().join(&filename);

    match tokio::fs::read(&temp_path).await {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "audio/mpeg")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(axum::body::Body::from(bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
        Err(e) => {
            error!("TTS file not found {}: {}", filename, e);
            (
                StatusCode::NOT_FOUND,
                format!("TTS file not found: {}", filename),
            )
                .into_response()
        }
    }
}

// ── Audio proxy tests ──────────────────────────────────────────────────────────
//
// These exercise the proxy logic against a local synthetic upstream HTTP
// server (127.0.0.1, OS-assigned port) -- no real network or YouTube access.
// `validate_https_upstream_url` is tested separately (pure string parsing,
// no network) since it is the scheme security gate; `fetch_and_stream_upstream`
// is tested against the synthetic server directly, bypassing that gate, to
// isolate Range/header/status-forwarding behaviour from scheme validation.
#[cfg(test)]
mod proxy_tests {
    use super::*;
    use axum::http::HeaderValue;
    use std::sync::Mutex as StdMutex;

    #[derive(Clone)]
    struct TestUpstreamConfig {
        status: StatusCode,
        headers: Vec<(HeaderName, HeaderValue)>,
        body: Vec<u8>,
    }

    /// Spawns a tiny axum server on 127.0.0.1:0 that always answers with
    /// `config`, and records the last-seen Range header (if any) into
    /// `received_range` so the test can assert on it independently of what
    /// the proxy under test forwards downstream.
    async fn spawn_test_upstream(
        config: TestUpstreamConfig,
        received_range: Arc<StdMutex<Option<String>>>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind synthetic upstream listener");
        let addr = listener.local_addr().expect("synthetic upstream addr");

        let app = Router::new().route(
            "/audio",
            get(move |headers: HeaderMap| {
                let config = config.clone();
                let received_range = received_range.clone();
                async move {
                    if let Some(range) = headers.get(header::RANGE).and_then(|v| v.to_str().ok()) {
                        *received_range.lock().unwrap() = Some(range.to_string());
                    }
                    let mut builder = Response::builder().status(config.status);
                    for (name, value) in &config.headers {
                        builder = builder.header(name.clone(), value.clone());
                    }
                    builder
                        .body(axum::body::Body::from(config.body.clone()))
                        .unwrap()
                }
            }),
        );

        let join = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (format!("http://{}/audio", addr), join)
    }

    #[test]
    fn rejects_non_https_upstream_schemes() {
        assert!(validate_https_upstream_url("http://example.com/videoplayback").is_err());
        assert!(validate_https_upstream_url("ftp://example.com/videoplayback").is_err());
        assert!(validate_https_upstream_url("not a url at all").is_err());
    }

    #[test]
    fn accepts_https_upstream_scheme() {
        assert!(validate_https_upstream_url("https://example.com/videoplayback?sig=abc").is_ok());
    }

    #[tokio::test]
    async fn forwards_range_header_and_propagates_partial_content() {
        let received_range = Arc::new(StdMutex::new(None));
        let config = TestUpstreamConfig {
            status: StatusCode::PARTIAL_CONTENT,
            headers: vec![
                (header::CONTENT_TYPE, HeaderValue::from_static("audio/webm")),
                (
                    header::CONTENT_RANGE,
                    HeaderValue::from_static("bytes 0-99/1000"),
                ),
                (header::ACCEPT_RANGES, HeaderValue::from_static("bytes")),
            ],
            body: b"partial-chunk".to_vec(),
        };
        let (url, _server) = spawn_test_upstream(config, received_range.clone()).await;

        let client = reqwest::Client::new();
        let response =
            fetch_and_stream_upstream(&client, &url, Some("bytes=0-99"), Duration::from_secs(5))
                .await
                .expect("proxy should succeed against synthetic upstream");

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 0-99/1000"
        );
        assert_eq!(
            response.headers().get(header::ACCEPT_RANGES).unwrap(),
            "bytes"
        );
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "audio/webm"
        );
        assert_eq!(
            received_range.lock().unwrap().as_deref(),
            Some("bytes=0-99")
        );

        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("proxy body should be readable");
        assert_eq!(&body_bytes[..], b"partial-chunk");
    }

    #[tokio::test]
    async fn propagates_200_when_no_range_requested() {
        let received_range = Arc::new(StdMutex::new(None));
        let config = TestUpstreamConfig {
            status: StatusCode::OK,
            headers: vec![(header::CONTENT_TYPE, HeaderValue::from_static("audio/mp4"))],
            body: b"full-body".to_vec(),
        };
        let (url, _server) = spawn_test_upstream(config, received_range.clone()).await;

        let client = reqwest::Client::new();
        let response = fetch_and_stream_upstream(&client, &url, None, Duration::from_secs(5))
            .await
            .expect("proxy should succeed for a plain 200");

        assert_eq!(response.status(), StatusCode::OK);
        assert!(!response.status().is_redirection());
        assert!(received_range.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn filters_headers_to_the_allow_list_only() {
        let received_range = Arc::new(StdMutex::new(None));
        let config = TestUpstreamConfig {
            status: StatusCode::OK,
            headers: vec![
                (header::CONTENT_TYPE, HeaderValue::from_static("audio/webm")),
                (
                    HeaderName::from_static("x-upstream-secret"),
                    HeaderValue::from_static("should-not-forward"),
                ),
            ],
            body: b"data".to_vec(),
        };
        let (url, _server) = spawn_test_upstream(config, received_range).await;

        let client = reqwest::Client::new();
        let response = fetch_and_stream_upstream(&client, &url, None, Duration::from_secs(5))
            .await
            .expect("proxy should succeed");

        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "audio/webm"
        );
        assert!(response.headers().get("x-upstream-secret").is_none());
    }

    #[tokio::test]
    async fn maps_upstream_failure_status_to_a_proxy_error_not_a_passthrough() {
        let received_range = Arc::new(StdMutex::new(None));
        let config = TestUpstreamConfig {
            status: StatusCode::FORBIDDEN,
            headers: vec![],
            body: b"upstream error page".to_vec(),
        };
        let (url, _server) = spawn_test_upstream(config, received_range).await;

        let client = reqwest::Client::new();
        let result = fetch_and_stream_upstream(&client, &url, None, Duration::from_secs(5)).await;

        let err = result.expect_err("upstream 403 must not be treated as success");
        assert_eq!(err, ProxyError::UpstreamStatus(StatusCode::FORBIDDEN));
    }

    #[tokio::test]
    async fn upstream_connection_failure_never_leaks_the_url_in_the_error() {
        // Port 1 is not listened on; the connection is refused immediately.
        // No real network access occurs.
        let marker = "SECRET_SIGNED_MARKER_12345";
        let url = format!("https://127.0.0.1:1/videoplayback?sig={marker}");

        let client = reqwest::Client::new();
        let result = fetch_and_stream_upstream(&client, &url, None, Duration::from_secs(5)).await;

        let err = result.expect_err("connection to a closed port must fail");
        assert_eq!(err, ProxyError::UpstreamRequestFailed);
        assert!(!format!("{:?}", err).contains(marker));
    }

    #[test]
    fn proxy_errors_never_map_to_a_success_or_redirect_status() {
        let errors = [
            ProxyError::InvalidScheme,
            ProxyError::UpstreamTimeout,
            ProxyError::UpstreamRequestFailed,
            ProxyError::UpstreamStatus(StatusCode::FORBIDDEN),
            ProxyError::BuildResponseFailed,
        ];
        for err in errors {
            let response = err.into_response();
            assert!(!response.status().is_success());
            assert!(!response.status().is_redirection());
        }
    }

    // ── Resilience tests (STEP-6R.4E-R1) ──────────────────────────────────
    //
    // These use raw tokio TcpListeners (not axum::Router) for full control
    // over exactly when/whether bytes are written, so timeout and disconnect
    // behavior can be triggered deterministically. All local, synthetic,
    // 127.0.0.1-only; no network/YouTube/googlevideo access.

    use std::sync::atomic::{AtomicBool, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Reads and discards an incoming HTTP request (up to the blank line
    /// terminator) from a raw socket, returning the raw text read so far
    /// (used by the Range-forwarding test to inspect the Range header).
    async fn discard_request_and_capture(socket: &mut tokio::net::TcpStream) -> String {
        let mut buf = [0u8; 4096];
        let mut text = String::new();
        for _ in 0..20 {
            match socket.read(&mut buf).await {
                Ok(0) => break,
                Err(_) => break,
                Ok(n) => {
                    text.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if text.contains("\r\n\r\n") {
                        break;
                    }
                }
            }
        }
        text
    }

    /// Reads exactly one data frame from an axum Body via the production
    /// `http_body::Body` trait (re-exported as `axum::body::HttpBody`),
    /// using only `std::future::poll_fn` + `std::pin::pin!` -- no extra
    /// stream-combinator dependency needed. The body (and whatever it owns,
    /// e.g. an in-flight reqwest connection) is dropped when this function
    /// returns.
    async fn read_first_chunk_then_drop(body: axum::body::Body) -> Option<axum::body::Bytes> {
        use axum::body::HttpBody;
        let mut body = std::pin::pin!(body);
        loop {
            match std::future::poll_fn(|cx| body.as_mut().poll_frame(cx)).await {
                None => return None,
                Some(Err(_)) => return None,
                Some(Ok(frame)) => {
                    if let Ok(data) = frame.into_data() {
                        return Some(data);
                    }
                    // Non-data (e.g. trailers) frame; keep looking.
                }
            }
        }
    }

    /// Drains a body until it ends or errors, returning the total bytes
    /// received and (if it errored) the error's Debug text -- used to prove
    /// both "at least one chunk arrived" and "no signed URL in the error".
    async fn drain_until_error_or_end(body: axum::body::Body) -> (usize, Option<String>) {
        use axum::body::HttpBody;
        let mut received = 0usize;
        let mut error_text = None;
        let mut body = std::pin::pin!(body);
        loop {
            match std::future::poll_fn(|cx| body.as_mut().poll_frame(cx)).await {
                None => break,
                Some(Err(e)) => {
                    error_text = Some(format!("{:?}", e));
                    break;
                }
                Some(Ok(frame)) => {
                    if let Ok(data) = frame.into_data() {
                        received += data.len();
                    }
                }
            }
        }
        (received, error_text)
    }

    const FORBIDDEN_SIGNED_URL_MARKERS: &[&str] =
        &["expire=", "sig=", "lsig=", "n=", "ip=", "googlevideo.com"];

    fn assert_no_signed_markers(label: &str, text: &str) {
        for marker in FORBIDDEN_SIGNED_URL_MARKERS {
            assert!(
                !text.contains(marker),
                "{label}: error text must not contain signed-URL marker {marker:?}; got: {text}"
            );
        }
    }

    // ---- Test A: upstream stalls before response headers ----

    async fn spawn_stalling_upstream() -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind stalling upstream listener");
        let addr = listener.local_addr().expect("stalling upstream addr");
        let join = tokio::spawn(async move {
            if let Ok((socket, _)) = listener.accept().await {
                // Hold the connection open, send nothing, until the test's
                // outer timeout tears the whole runtime down.
                let _keep_open = socket;
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        });
        (format!("http://{}/audio", addr), join)
    }

    #[tokio::test]
    async fn upstream_stall_before_headers_times_out_as_gateway_timeout() {
        tokio::time::timeout(Duration::from_secs(5), async {
            let (url, _server) = spawn_stalling_upstream().await;
            let timeouts = ProxyTimeouts {
                connect: Duration::from_millis(500),
                response: Duration::from_millis(200),
                read_idle: Duration::from_secs(5),
            };
            let client = build_http_client(timeouts);

            let result = fetch_and_stream_upstream(&client, &url, None, timeouts.response).await;
            let err = result.expect_err("a stalling upstream must time out before headers arrive");
            assert_eq!(err, ProxyError::UpstreamTimeout);

            let response = err.into_response();
            assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
        })
        .await
        .expect("test exceeded its own outer safety bound");
    }

    // ---- Test B: upstream stalls mid-body ----

    async fn spawn_mid_body_stall_upstream(marker: &str) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mid-body-stall upstream listener");
        let addr = listener.local_addr().expect("mid-body-stall upstream addr");
        let marker = marker.to_string();
        let join = tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let _ = discard_request_and_capture(&mut socket).await;
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: audio/webm\r\n\
                     Transfer-Encoding: chunked\r\nConnection: close\r\n\
                     X-Test-Marker: {marker}\r\n\r\n"
                );
                let _ = socket.write_all(header.as_bytes()).await;
                let _ = socket.write_all(b"5\r\nhello\r\n").await;
                // Then stall: keep the socket open, send nothing more.
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        });
        (format!("http://{}/audio", addr), join)
    }

    #[tokio::test]
    async fn upstream_mid_body_stall_terminates_stream_with_error_not_hang() {
        tokio::time::timeout(Duration::from_secs(5), async {
            let marker = "SECRET_SIGNED_MARKER_MIDBODY";
            let (url, _server) = spawn_mid_body_stall_upstream(marker).await;
            let timeouts = ProxyTimeouts {
                connect: Duration::from_millis(500),
                response: Duration::from_secs(2),
                read_idle: Duration::from_millis(300),
            };
            let client = build_http_client(timeouts);

            let response = fetch_and_stream_upstream(&client, &url, None, timeouts.response)
                .await
                .expect("headers must be received before the mid-body stall");
            assert_eq!(response.status(), StatusCode::OK);

            let (received, error_text) = drain_until_error_or_end(response.into_body()).await;
            assert!(
                received > 0,
                "expected at least the first chunk to be received"
            );
            let error_text = error_text
                .expect("expected the body stream to terminate with an error, not a clean end");
            assert_no_signed_markers("mid-body timeout error", &error_text);
            assert!(!error_text.contains(marker));
        })
        .await
        .expect("test exceeded its own outer safety bound");
    }

    // ---- Test C: slow but healthy stream ----

    async fn spawn_slow_healthy_upstream(
        chunks: Vec<&'static [u8]>,
        delay: Duration,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind slow-healthy upstream listener");
        let addr = listener.local_addr().expect("slow-healthy upstream addr");
        let join = tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let _ = discard_request_and_capture(&mut socket).await;
                let header = "HTTP/1.1 200 OK\r\nContent-Type: audio/webm\r\n\
                               Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
                if socket.write_all(header.as_bytes()).await.is_err() {
                    return;
                }
                for chunk in chunks {
                    tokio::time::sleep(delay).await;
                    let frame = format!("{:x}\r\n", chunk.len());
                    if socket.write_all(frame.as_bytes()).await.is_err() {
                        return;
                    }
                    if socket.write_all(chunk).await.is_err() {
                        return;
                    }
                    if socket.write_all(b"\r\n").await.is_err() {
                        return;
                    }
                }
                let _ = socket.write_all(b"0\r\n\r\n").await;
            }
        });
        (format!("http://{}/audio", addr), join)
    }

    #[tokio::test]
    async fn slow_but_healthy_stream_completes_without_false_timeout() {
        tokio::time::timeout(Duration::from_secs(5), async {
            let chunks: Vec<&[u8]> = vec![b"first-", b"second-", b"third"];
            let (url, _server) =
                spawn_slow_healthy_upstream(chunks.clone(), Duration::from_millis(100)).await;
            let timeouts = ProxyTimeouts {
                connect: Duration::from_millis(500),
                response: Duration::from_secs(2),
                read_idle: Duration::from_millis(800),
            };
            let client = build_http_client(timeouts);

            let response = fetch_and_stream_upstream(&client, &url, None, timeouts.response)
                .await
                .expect("a healthy slow stream (gaps shorter than read_idle) must not time out");
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response.headers().get(header::CONTENT_TYPE).unwrap(),
                "audio/webm"
            );

            let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("the stream must complete cleanly, not time out");
            let expected: Vec<u8> = chunks.concat();
            assert_eq!(
                &body_bytes[..],
                &expected[..],
                "chunk order must be preserved"
            );
        })
        .await
        .expect("test exceeded its own outer safety bound");
    }

    // ---- Test D: downstream client disconnect ----

    async fn spawn_disconnect_detecting_upstream() -> (
        String,
        Arc<AtomicBool>,
        Arc<AtomicBool>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind disconnect-detecting upstream listener");
        let addr = listener
            .local_addr()
            .expect("disconnect-detecting upstream addr");
        let dropped = Arc::new(AtomicBool::new(false));
        let dropped_clone = dropped.clone();
        let second_request_seen = Arc::new(AtomicBool::new(false));
        let second_request_seen_clone = second_request_seen.clone();
        let join = tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let _ = discard_request_and_capture(&mut socket).await;
                let header = "HTTP/1.1 200 OK\r\nContent-Type: audio/webm\r\n\
                               Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
                if socket.write_all(header.as_bytes()).await.is_err() {
                    return;
                }
                if socket.write_all(b"5\r\nhello\r\n").await.is_err() {
                    return;
                }
                // Watch for the downstream/client side to close the
                // connection: a subsequent read returning 0 bytes (or
                // erroring) signals the peer is gone.
                let mut buf = [0u8; 256];
                for _ in 0..100 {
                    match socket.read(&mut buf).await {
                        Ok(0) => {
                            dropped_clone.store(true, Ordering::SeqCst);
                            break;
                        }
                        Err(_) => {
                            dropped_clone.store(true, Ordering::SeqCst);
                            break;
                        }
                        Ok(_) => { /* unexpected inbound data; keep watching */ }
                    }
                }
            }
            // No retry is authorized/expected: prove no second connection
            // ever arrives at this listener.
            if tokio::time::timeout(Duration::from_millis(300), listener.accept())
                .await
                .is_ok()
            {
                second_request_seen_clone.store(true, Ordering::SeqCst);
            }
        });
        (
            format!("http://{}/audio", addr),
            dropped,
            second_request_seen,
            join,
        )
    }

    #[tokio::test]
    async fn downstream_disconnect_drops_the_upstream_connection() {
        tokio::time::timeout(Duration::from_secs(5), async {
            let (url, dropped, second_request_seen, _server) =
                spawn_disconnect_detecting_upstream().await;
            let timeouts = ProxyTimeouts {
                connect: Duration::from_millis(500),
                response: Duration::from_secs(2),
                read_idle: Duration::from_secs(5),
            };
            let client = build_http_client(timeouts);

            let response = fetch_and_stream_upstream(&client, &url, None, timeouts.response)
                .await
                .expect("proxy should succeed");
            let first_chunk = read_first_chunk_then_drop(response.into_body()).await;
            assert!(
                first_chunk.is_some(),
                "expected to read at least one downstream chunk before dropping"
            );

            let mut observed = false;
            for _ in 0..50 {
                if dropped.load(Ordering::SeqCst) {
                    observed = true;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            assert!(
                observed,
                "UPSTREAM_STREAM_DROPPED must be observed after the downstream body is dropped"
            );
            tokio::time::sleep(Duration::from_millis(350)).await;
            assert!(
                !second_request_seen.load(Ordering::SeqCst),
                "NO_CONTINUED_UPSTREAM_READS: no second connection/request is expected after disconnect"
            );
        })
        .await
        .expect("test exceeded its own outer safety bound");
    }

    // ---- Test E: downstream disconnect during a Range response ----

    async fn spawn_range_disconnect_detecting_upstream() -> (
        String,
        Arc<AtomicBool>,
        Arc<StdMutex<Vec<String>>>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind range-disconnect upstream listener");
        let addr = listener
            .local_addr()
            .expect("range-disconnect upstream addr");
        let dropped = Arc::new(AtomicBool::new(false));
        let dropped_clone = dropped.clone();
        let seen_ranges = Arc::new(StdMutex::new(Vec::new()));
        let seen_ranges_clone = seen_ranges.clone();
        let join = tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let request_text = discard_request_and_capture(&mut socket).await;
                for line in request_text.lines() {
                    if let Some(value) = line
                        .strip_prefix("Range:")
                        .or_else(|| line.strip_prefix("range:"))
                    {
                        seen_ranges_clone
                            .lock()
                            .unwrap()
                            .push(value.trim().to_string());
                    }
                }
                let header = "HTTP/1.1 206 Partial Content\r\nContent-Type: audio/webm\r\n\
                               Content-Range: bytes 0-999/1000\r\nAccept-Ranges: bytes\r\n\
                               Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
                if socket.write_all(header.as_bytes()).await.is_err() {
                    return;
                }
                if socket.write_all(b"5\r\nhello\r\n").await.is_err() {
                    return;
                }
                let mut buf = [0u8; 256];
                for _ in 0..100 {
                    match socket.read(&mut buf).await {
                        Ok(0) => {
                            dropped_clone.store(true, Ordering::SeqCst);
                            break;
                        }
                        Err(_) => {
                            dropped_clone.store(true, Ordering::SeqCst);
                            break;
                        }
                        Ok(_) => {}
                    }
                }
            }
        });
        (format!("http://{}/audio", addr), dropped, seen_ranges, join)
    }

    #[tokio::test]
    async fn range_response_downstream_disconnect_drops_upstream_and_forwards_range_once() {
        tokio::time::timeout(Duration::from_secs(5), async {
            let (url, dropped, seen_ranges, _server) =
                spawn_range_disconnect_detecting_upstream().await;
            let timeouts = ProxyTimeouts {
                connect: Duration::from_millis(500),
                response: Duration::from_secs(2),
                read_idle: Duration::from_secs(5),
            };
            let client = build_http_client(timeouts);

            let response =
                fetch_and_stream_upstream(&client, &url, Some("bytes=0-999"), timeouts.response)
                    .await
                    .expect("proxy should succeed for a Range request");
            assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);

            let first_chunk = read_first_chunk_then_drop(response.into_body()).await;
            assert!(first_chunk.is_some());

            let mut observed = false;
            for _ in 0..50 {
                if dropped.load(Ordering::SeqCst) {
                    observed = true;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            assert!(
                observed,
                "expected the upstream connection to be dropped after downstream disconnect"
            );

            let ranges = seen_ranges.lock().unwrap().clone();
            assert_eq!(
                ranges,
                vec!["bytes=0-999".to_string()],
                "Range header must be forwarded exactly once, unmodified, with no retry"
            );
        })
        .await
        .expect("test exceeded its own outer safety bound");
    }

    // ---- Test F: Last-Modified propagation + full header filtering ----

    #[tokio::test]
    async fn last_modified_is_forwarded_and_unsafe_headers_are_filtered() {
        let received_range = Arc::new(StdMutex::new(None));
        let config = TestUpstreamConfig {
            status: StatusCode::OK,
            headers: vec![
                (
                    header::LAST_MODIFIED,
                    HeaderValue::from_static("Mon, 03 Apr 2023 05:54:14 GMT"),
                ),
                (header::CONTENT_TYPE, HeaderValue::from_static("audio/webm")),
                (header::CONTENT_LENGTH, HeaderValue::from_static("4")),
                (
                    header::CONTENT_RANGE,
                    HeaderValue::from_static("bytes 0-3/1234"),
                ),
                (header::ACCEPT_RANGES, HeaderValue::from_static("bytes")),
                (
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("private, max-age=21297"),
                ),
                (header::ETAG, HeaderValue::from_static("\"abc123\"")),
                (
                    HeaderName::from_static("x-upstream-secret"),
                    HeaderValue::from_static("should-not-forward"),
                ),
                (header::CONNECTION, HeaderValue::from_static("keep-alive")),
            ],
            body: b"data".to_vec(),
        };
        let (url, _server) = spawn_test_upstream(config, received_range).await;

        let client = reqwest::Client::new();
        let response = fetch_and_stream_upstream(&client, &url, None, Duration::from_secs(5))
            .await
            .expect("proxy should succeed");

        let headers = response.headers();
        assert_eq!(
            headers.get(header::LAST_MODIFIED).unwrap(),
            "Mon, 03 Apr 2023 05:54:14 GMT"
        );
        assert_eq!(headers.get(header::CONTENT_TYPE).unwrap(), "audio/webm");
        assert_eq!(headers.get(header::CONTENT_LENGTH).unwrap(), "4");
        assert_eq!(
            headers.get(header::CONTENT_RANGE).unwrap(),
            "bytes 0-3/1234"
        );
        assert_eq!(headers.get(header::ACCEPT_RANGES).unwrap(), "bytes");
        assert_eq!(
            headers.get(header::CACHE_CONTROL).unwrap(),
            "private, max-age=21297"
        );
        assert_eq!(headers.get(header::ETAG).unwrap(), "\"abc123\"");
        assert!(headers.get("x-upstream-secret").is_none());
        assert!(headers.get(header::CONNECTION).is_none());
    }

    // ---- Test G: unsupported upstream URL scheme is rejected pre-flight ----

    #[tokio::test]
    async fn unsupported_scheme_is_rejected_before_any_network_request() {
        tokio::time::timeout(Duration::from_secs(2), async {
            let client = reqwest::Client::new();
            // Port 1 would hang/refuse if actually contacted; a fast return
            // here is itself evidence no network attempt was made.
            let result = proxy_audio(
                &client,
                "http://127.0.0.1:1/videoplayback?sig=should-never-be-tried",
                None,
                Duration::from_secs(5),
            )
            .await;
            let err = result.expect_err("http scheme must be rejected");
            assert_eq!(err, ProxyError::InvalidScheme);

            let result =
                proxy_audio(&client, "file:///etc/passwd", None, Duration::from_secs(5)).await;
            assert_eq!(
                result.expect_err("file scheme must be rejected"),
                ProxyError::InvalidScheme
            );
        })
        .await
        .expect("scheme rejection must be immediate, proving no network request occurs");
    }

    // ---- Test H: timeout/transport error sanitization ----

    #[test]
    fn sanitized_proxy_errors_never_contain_signed_url_markers() {
        let errors = [
            ProxyError::InvalidScheme,
            ProxyError::UpstreamTimeout,
            ProxyError::UpstreamRequestFailed,
            ProxyError::UpstreamStatus(StatusCode::FORBIDDEN),
            ProxyError::BuildResponseFailed,
        ];
        for err in errors {
            assert_no_signed_markers("ProxyError Debug", &format!("{:?}", err));
        }
    }

    #[tokio::test]
    async fn pre_header_timeout_error_never_contains_signed_url_markers() {
        tokio::time::timeout(Duration::from_secs(5), async {
            let (url, _server) = spawn_stalling_upstream().await;
            let marker_url = format!("{url}?sig=SECRET_SIGNED_MARKER_PREHEADER&expire=1234567890");
            let timeouts = ProxyTimeouts {
                connect: Duration::from_millis(500),
                response: Duration::from_millis(200),
                read_idle: Duration::from_secs(5),
            };
            let client = build_http_client(timeouts);
            let result =
                fetch_and_stream_upstream(&client, &marker_url, None, timeouts.response).await;
            let err = result.expect_err("stalling upstream must time out");
            assert_eq!(err, ProxyError::UpstreamTimeout);
            assert_no_signed_markers("pre-header timeout ProxyError Debug", &format!("{:?}", err));
        })
        .await
        .expect("test exceeded its own outer safety bound");
    }
}
