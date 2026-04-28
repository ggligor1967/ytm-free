// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Suppress WebView2 "Tracking Prevention blocked access to storage" console spam
    // These are harmless Edge warnings from loading YouTube thumbnails
    #[cfg(target_os = "windows")]
    {
        let current = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let extra = "--disable-features=msEdgeTrackingPrevention";
        if !current.contains(extra) {
            let new_val = if current.is_empty() {
                extra.to_string()
            } else {
                format!("{} {}", current, extra)
            };
            std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", new_val);
        }
    }

    ytm_free_lib::run()
}
