import { describe, it, expect } from "vitest";
import { getTrackId } from "../lib/trackId";
import type { Track, SearchResult } from "../types";

describe("getTrackId", () => {
  it("returns id from a Track object", () => {
    const track: Track = {
      id: "track-123",
      video_id: "vid-abc",
      title: "Test Song",
      artist: "Test Artist",
      thumbnail: "http://example.com/thumb.jpg",
      duration: 200,
      is_downloaded: false,
      is_favorite: false,
      play_count: 0,
      created_at: "2024-01-01T00:00:00Z",
    };

    expect(getTrackId(track)).toBe("track-123");
  });

  it("returns id from a SearchResult object", () => {
    const result: SearchResult = {
      id: "search-456",
      title: "Found Song",
      artist: "Found Artist",
      thumbnail: "http://example.com/thumb2.jpg",
      duration: 180,
    };

    expect(getTrackId(result)).toBe("search-456");
  });

  it("returns the correct id when Track has different id and video_id", () => {
    const track: Track = {
      id: "track-id-999",
      video_id: "youtube-video-id",
      title: "Another Song",
      artist: "Another Artist",
      thumbnail: "http://example.com/thumb3.jpg",
      duration: 240,
      is_downloaded: true,
      is_favorite: true,
      play_count: 5,
      created_at: "2024-06-15T00:00:00Z",
    };

    const id = getTrackId(track);
    // Should return the `id` field (not `video_id`)
    expect(id).toBe("track-id-999");
    expect(id).not.toBe(track.video_id);
  });
});
