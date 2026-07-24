import type { Track, SearchResult } from "../types";

export function getTrackId(track: Track | SearchResult): string {
  return track.id;
}
