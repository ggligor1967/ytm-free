//! Crate-wide test-only synchronization for process-global test state.
//!
//! `lib.rs::tests` and `db.rs::tests` both mutate the process-global
//! `YTM_FREE_DATA_DIR` environment variable. Prior to this module each side
//! had its own module-local `Mutex`, which only serialized tests within the
//! same module and let the two groups race against each other.

#[cfg(test)]
static YTM_FREE_DATA_DIR_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> =
    std::sync::OnceLock::new();

/// Acquires the single crate-wide lock guarding `YTM_FREE_DATA_DIR`.
///
/// A prior panic while holding this lock poisons it; recovering via
/// `into_inner()` keeps the *causing* test's own failure visible (it still
/// fails/panics on its own assertion) while letting every later test proceed
/// normally instead of cascading into 20+ unrelated `PoisonError` failures.
#[cfg(test)]
pub(crate) fn lock_ytm_free_data_dir() -> std::sync::MutexGuard<'static, ()> {
    YTM_FREE_DATA_DIR_LOCK
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
