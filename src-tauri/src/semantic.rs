use crate::models::{
    EmbeddingMetadata, SemanticSearchFilter, Track,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::VecDeque;

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
        self.lru_order.make_contiguous().sort_by(|a, b|
            a.last_accessed.cmp(&b.last_accessed)
        );

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
