use crate::models::{EmbeddingMetadata, SemanticSearchFilter, Track};
use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::RwLock;

/// LRU cache entry for tracking access order
struct LRUEntry {
    track_id: String,
    last_accessed: u64,
}

/// In-memory Index for semantic search with caching and fast filtering
///
/// For libraries >10k tracks, uses partitioning strategy:
/// - Partition embeddings into chunks
/// - Pre-compute partition centroids
/// - Search only relevant partitions first
///
/// For libraries >50k tracks, uses LRU eviction to limit memory usage
pub struct ANNIndex {
    /// All embeddings cached in memory
    embeddings: HashMap<String, Vec<f32>>,
    /// Cached metadata for filtering without DB access
    metadata: HashMap<String, EmbeddingMetadata>,
    /// Track IDs for fast iteration
    track_ids: Vec<String>,
    /// Partition information for large libraries
    partition_size: usize,
    partitions: Vec<Vec<(usize, f32)>>, // (index, centroid_distance)
    /// LRU tracking for eviction
    lru_order: VecDeque<LRUEntry>,
    /// Access counter for LRU
    access_counter: u64,
    /// Maximum number of embeddings to keep in memory (0 = no limit)
    max_embeddings: usize,
}

impl ANNIndex {
    /// Create a new index with auto-partitioning for large libraries
    pub fn new() -> Self {
        Self {
            embeddings: HashMap::new(),
            metadata: HashMap::new(),
            track_ids: Vec::new(),
            partition_size: 500, // Partition every 500 tracks
            partitions: Vec::new(),
            lru_order: VecDeque::new(),
            access_counter: 0,
            max_embeddings: 0, // 0 = no limit
        }
    }

    /// Create a new index with LRU eviction enabled
    pub fn with_lru_eviction(max_embeddings: usize) -> Self {
        Self {
            embeddings: HashMap::new(),
            metadata: HashMap::new(),
            track_ids: Vec::new(),
            partition_size: 500,
            partitions: Vec::new(),
            lru_order: VecDeque::new(),
            access_counter: 0,
            max_embeddings,
        }
    }

    /// Increment access counter and record access for LRU
    fn record_access(&mut self, track_id: &str) {
        self.access_counter += 1;
        // Remove existing entry if present
        self.lru_order.retain(|e| e.track_id != track_id);
        self.lru_order.push_back(LRUEntry {
            track_id: track_id.to_string(),
            last_accessed: self.access_counter,
        });
    }

    /// Evict least recently used entries if over limit
    fn evict_if_needed(&mut self) {
        if self.max_embeddings == 0 || self.embeddings.len() <= self.max_embeddings {
            return;
        }

        // Calculate how many to evict
        let to_evict = self.embeddings.len() - self.max_embeddings;

        // Sort LRU order by last accessed (ascending = oldest first)
        self.lru_order
            .make_contiguous()
            .sort_by(|a, b| a.last_accessed.cmp(&b.last_accessed));

        // Evict oldest entries
        for _ in 0..to_evict {
            if let Some(oldest) = self.lru_order.pop_front() {
                self.embeddings.remove(&oldest.track_id);
                self.metadata.remove(&oldest.track_id);
                self.track_ids.retain(|id| id != &oldest.track_id);
            }
        }
    }

    /// Add an embedding to the index
    pub fn add(&mut self, track_id: String, embedding: Vec<f32>, metadata: EmbeddingMetadata) {
        self.track_ids.push(track_id.clone());
        self.embeddings.insert(track_id.clone(), embedding);
        self.metadata.insert(metadata.track_id.clone(), metadata);

        // Record access for LRU
        self.record_access(&track_id);

        // Evict if over limit
        self.evict_if_needed();
    }

    /// Set the maximum number of embeddings to keep in memory
    pub fn set_max_embeddings(&mut self, max: usize) {
        self.max_embeddings = max;
        self.evict_if_needed();
    }

    /// Fast cosine similarity (pre-normalized)
    fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }

        let mut dot = 0.0_f32;
        for (x, y) in a.iter().zip(b.iter()) {
            dot += x * y;
        }
        dot
    }

    /// Search for k nearest neighbors
    pub fn search(&self, query: &[f32], k: usize) -> Vec<(String, f32)> {
        if self.embeddings.is_empty() {
            return Vec::new();
        }

        let mut results: Vec<(String, f32)> = self
            .track_ids
            .iter()
            .filter_map(|track_id| {
                self.embeddings.get(track_id).map(|emb| {
                    let similarity = Self::cosine_similarity(query, emb);
                    (track_id.clone(), similarity)
                })
            })
            .collect();

        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(k);
        results
    }

    /// Search with metadata filtering
    pub fn search_filtered(
        &self,
        query: &[f32],
        k: usize,
        filter: &SemanticSearchFilter,
    ) -> Vec<(String, f32)> {
        if self.embeddings.is_empty() {
            return Vec::new();
        }

        let mut results: Vec<(String, f32)> = self
            .track_ids
            .iter()
            .filter_map(|track_id| {
                // Check metadata filters first
                let meta = self.metadata.get(track_id)?;

                // Apply genre filter
                if let Some(genres) = &filter.genres {
                    if !meta.genres.iter().any(|g| genres.contains(g)) {
                        return None;
                    }
                }

                // Apply mood filter
                if let Some(moods) = &filter.moods {
                    if !meta.moods.iter().any(|m| moods.contains(m)) {
                        return None;
                    }
                }

                // Apply activity filter
                if let Some(activities) = &filter.activities {
                    if !meta.activities.iter().any(|a| activities.contains(a)) {
                        return None;
                    }
                }

                // Calculate similarity
                self.embeddings.get(track_id).map(|emb| {
                    let similarity = Self::cosine_similarity(query, emb);
                    (track_id.clone(), similarity)
                })
            })
            .collect();

        // Apply minimum similarity threshold (parity with the DB fallback helper).
        // When `Some(x)`, exclude results whose similarity is strictly below `x`.
        // When `None`, keep the existing behavior (no threshold filtering).
        if let Some(threshold) = filter.min_similarity {
            results.retain(|(_, sim)| (*sim as f64) >= threshold);
        }

        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(k);
        results
    }

    /// Clear the index
    pub fn clear(&mut self) {
        self.embeddings.clear();
        self.metadata.clear();
        self.track_ids.clear();
        self.partitions.clear();
        self.lru_order.clear();
        self.access_counter = 0;
    }

    /// Get index size
    pub fn len(&self) -> usize {
        self.track_ids.len()
    }

    /// Check if index is empty
    pub fn is_empty(&self) -> bool {
        self.track_ids.is_empty()
    }

    /// Get memory usage estimate in MB
    pub fn estimate_memory_mb(&self) -> f64 {
        let embedding_size: usize = self.embeddings.values().map(|e| e.len() * 4).sum();
        (embedding_size as f64) / (1024.0 * 1024.0)
    }

    /// Get the maximum number of embeddings
    pub fn max_embeddings(&self) -> usize {
        self.max_embeddings
    }

    /// Check if LRU eviction is enabled
    pub fn is_lru_enabled(&self) -> bool {
        self.max_embeddings > 0
    }
}

impl Default for ANNIndex {
    fn default() -> Self {
        Self::new()
    }
}

/// Wrapper for thread-safe ANN index access
pub type SharedANNIndex = Arc<RwLock<ANNIndex>>;

/// Build metadata from track info
pub fn build_metadata(
    track: &Track,
    genres: Option<String>,
    moods: Option<String>,
    activities: Option<String>,
) -> EmbeddingMetadata {
    EmbeddingMetadata {
        track_id: track.id.clone(),
        genres: parse_json_array(&genres.unwrap_or_default()),
        moods: parse_json_array(&moods.unwrap_or_default()),
        activities: parse_json_array(&activities.unwrap_or_default()),
        energy_level: None,
    }
}

/// Helper to deserialize JSON arrays from strings
pub fn parse_json_array(json_str: &str) -> Vec<String> {
    if json_str.is_empty() {
        return Vec::new();
    }
    serde_json::from_str::<Vec<String>>(json_str).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SemanticSearchFilter;

    fn make_embedding(values: &[f32]) -> Vec<f32> {
        values.to_vec()
    }

    #[test]
    fn test_cosine_similarity() {
        // Identical vectors
        let a = make_embedding(&[1.0, 0.0, 0.0]);
        let b = make_embedding(&[1.0, 0.0, 0.0]);
        assert!((ANNIndex::cosine_similarity(&a, &b) - 1.0).abs() < 1e-6);

        // Orthogonal vectors
        let c = make_embedding(&[0.0, 1.0, 0.0]);
        assert!((ANNIndex::cosine_similarity(&a, &c) - 0.0).abs() < 1e-6);

        // Opposite vectors
        let d = make_embedding(&[-1.0, 0.0, 0.0]);
        assert!((ANNIndex::cosine_similarity(&a, &d) + 1.0).abs() < 1e-6);

        // Empty vectors
        let empty1: Vec<f32> = vec![];
        let empty2: Vec<f32> = vec![];
        assert!((ANNIndex::cosine_similarity(&empty1, &empty2) - 0.0).abs() < 1e-6);

        // Different lengths
        let short = make_embedding(&[1.0, 0.0]);
        let long = make_embedding(&[1.0, 0.0, 0.0]);
        assert!((ANNIndex::cosine_similarity(&short, &long) - 0.0).abs() < 1e-6);
    }

    #[test]
    fn test_knn_search() {
        let mut index = ANNIndex::new();

        index.add(
            "q1".to_string(),
            make_embedding(&[1.0, 0.0]),
            EmbeddingMetadata {
                track_id: "q1".to_string(),
                genres: vec!["rock".to_string()],
                moods: vec!["happy".to_string()],
                activities: vec![],
                energy_level: None,
            },
        );
        index.add(
            "q2".to_string(),
            make_embedding(&[0.0, 1.0]),
            EmbeddingMetadata {
                track_id: "q2".to_string(),
                genres: vec!["pop".to_string()],
                moods: vec!["sad".to_string()],
                activities: vec![],
                energy_level: None,
            },
        );
        index.add(
            "q3".to_string(),
            make_embedding(&[0.707, 0.707]),
            EmbeddingMetadata {
                track_id: "q3".to_string(),
                genres: vec!["jazz".to_string()],
                moods: vec!["chill".to_string()],
                activities: vec![],
                energy_level: None,
            },
        );

        // Query close to q1
        let query = make_embedding(&[0.95, 0.05]);
        let results = index.search(&query, 2);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].0, "q1", "Nearest neighbor should be q1");

        // Query exactly q2
        let query_q2 = make_embedding(&[0.0, 1.0]);
        let results = index.search(&query_q2, 1);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, "q2");

        // k larger than available
        let results = index.search(&query, 10);
        assert_eq!(results.len(), 3);

        // Search empty index
        let empty = ANNIndex::new();
        let results = empty.search(&query, 5);
        assert!(results.is_empty());
    }

    #[test]
    fn test_filtered_search() {
        let mut index = ANNIndex::new();

        index.add(
            "rock1".to_string(),
            make_embedding(&[1.0, 0.0]),
            EmbeddingMetadata {
                track_id: "rock1".to_string(),
                genres: vec!["rock".to_string()],
                moods: vec!["energetic".to_string()],
                activities: vec!["workout".to_string()],
                energy_level: Some(8),
            },
        );
        index.add(
            "rock2".to_string(),
            make_embedding(&[0.9, 0.1]),
            EmbeddingMetadata {
                track_id: "rock2".to_string(),
                genres: vec!["rock".to_string()],
                moods: vec!["happy".to_string()],
                activities: vec!["driving".to_string()],
                energy_level: Some(7),
            },
        );
        index.add(
            "jazz1".to_string(),
            make_embedding(&[0.0, 1.0]),
            EmbeddingMetadata {
                track_id: "jazz1".to_string(),
                genres: vec!["jazz".to_string()],
                moods: vec!["chill".to_string()],
                activities: vec!["study".to_string()],
                energy_level: Some(3),
            },
        );

        let query = make_embedding(&[1.0, 0.0]);

        // Filter by genre = rock
        let filter = SemanticSearchFilter {
            genres: Some(vec!["rock".to_string()]),
            moods: None,
            activities: None,
            min_similarity: None,
        };
        let results = index.search_filtered(&query, 10, &filter);
        assert_eq!(results.len(), 2, "Should return 2 rock tracks");
        assert!(results.iter().all(|(id, _)| id.starts_with("rock")));

        // Filter by mood = chill (only jazz)
        let filter = SemanticSearchFilter {
            genres: None,
            moods: Some(vec!["chill".to_string()]),
            activities: None,
            min_similarity: None,
        };
        let results = index.search_filtered(&query, 10, &filter);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, "jazz1");

        // Filter with no matches
        let filter = SemanticSearchFilter {
            genres: Some(vec!["classical".to_string()]),
            moods: None,
            activities: None,
            min_similarity: None,
        };
        let results = index.search_filtered(&query, 10, &filter);
        assert!(results.is_empty());
    }

    #[test]
    fn test_filtered_search_respects_min_similarity() {
        let mut index = ANNIndex::new();

        // Synthetic unit-length embeddings so the dot-product cosine matches the
        // true cosine. Query is [1.0, 0.0, 0.0].
        let meta = |track_id: &str, activities: Vec<String>| EmbeddingMetadata {
            track_id: track_id.to_string(),
            genres: vec![],
            moods: vec![],
            activities,
            energy_level: None,
        };

        // sim == 1.0 (identical, over any reasonable threshold)
        index.add(
            "over_a".to_string(),
            make_embedding(&[1.0, 0.0, 0.0]),
            meta("over_a", vec!["coding".to_string()]),
        );
        // sim == 0.9 (over 0.3 threshold)
        index.add(
            "over_b".to_string(),
            make_embedding(&[0.9, 0.435889894_f32, 0.0]),
            meta("over_b", vec!["driving".to_string()]),
        );
        // sim == 0.2 (below 0.3 threshold)
        index.add(
            "sub_c".to_string(),
            make_embedding(&[0.2, 0.979795897_f32, 0.0]),
            meta("sub_c", vec!["coding".to_string()]),
        );

        let query = make_embedding(&[1.0, 0.0, 0.0]);

        // min_similarity = Some(0.3): excludes the sub-threshold track only.
        let filter = SemanticSearchFilter {
            genres: None,
            moods: None,
            activities: None,
            min_similarity: Some(0.3),
        };
        let results = index.search_filtered(&query, 10, &filter);
        let ids: Vec<&str> = results.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["over_a", "over_b"],
            "sub-threshold track must be excluded"
        );
        // Similarity ordering is deterministic (descending).
        assert!(results[0].1 > results[1].1);

        // min_similarity = None: keeps the prior behavior (no threshold filtering).
        let filter_none = SemanticSearchFilter {
            genres: None,
            moods: None,
            activities: None,
            min_similarity: None,
        };
        let results_none = index.search_filtered(&query, 10, &filter_none);
        let ids_none: Vec<&str> = results_none.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(
            ids_none,
            vec!["over_a", "over_b", "sub_c"],
            "None threshold must keep the existing behavior"
        );

        // min_similarity combined with activities: only the over-threshold coding track.
        let filter_combo = SemanticSearchFilter {
            genres: None,
            moods: None,
            activities: Some(vec!["coding".to_string()]),
            min_similarity: Some(0.3),
        };
        let results_combo = index.search_filtered(&query, 10, &filter_combo);
        let ids_combo: Vec<&str> = results_combo.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(
            ids_combo,
            vec!["over_a"],
            "activities + threshold must isolate the single matching over-threshold track"
        );
    }

    #[test]
    fn test_lru_eviction() {
        let mut index = ANNIndex::with_lru_eviction(2);

        let meta = || EmbeddingMetadata {
            track_id: String::new(),
            genres: vec![],
            moods: vec![],
            activities: vec![],
            energy_level: None,
        };

        index.add("a".to_string(), make_embedding(&[1.0, 0.0]), meta());
        index.add("b".to_string(), make_embedding(&[0.0, 1.0]), meta());
        index.add("c".to_string(), make_embedding(&[0.707, 0.707]), meta());

        assert!(index.len() <= 2, "LRU should evict to stay at max 2");
        assert!(index.is_lru_enabled());
        assert_eq!(index.max_embeddings(), 2);
        assert!(
            !index.embeddings.contains_key("a"),
            "Oldest entry 'a' should be evicted"
        );
    }

    #[test]
    fn test_clear_and_empty() {
        let mut index = ANNIndex::new();
        assert!(index.is_empty());
        assert_eq!(index.len(), 0);

        let meta = || EmbeddingMetadata {
            track_id: String::new(),
            genres: vec![],
            moods: vec![],
            activities: vec![],
            energy_level: None,
        };

        index.add("x".to_string(), make_embedding(&[1.0, 0.0]), meta());
        index.add("y".to_string(), make_embedding(&[0.0, 1.0]), meta());
        assert!(!index.is_empty());
        assert_eq!(index.len(), 2);

        index.clear();
        assert!(index.is_empty());
        assert_eq!(index.len(), 0);
        assert!((index.estimate_memory_mb() - 0.0).abs() < 1e-6);
    }
}
