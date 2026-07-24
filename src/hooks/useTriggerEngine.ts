import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store';
import { getTotalPlayCount } from '../api';
import type { DjEventContext, DjTriggerType, Track, SearchResult } from '../types';

// Cooldown constants
const GLOBAL_COOLDOWN_MS = 60_000; // 60 seconds between ANY interventions
const MAX_INTERVENTIONS_PER_SESSION = 20;
const TRACK_START_COOLDOWN_TRACKS = 3; // Wait 3 tracks before next TrackStart

/**
 * DJ Trigger Engine Hook
 * 
 * Monitors play session and emits DJ commentary events based on:
 * - TrackStart: 10% chance at track start (with cooldown)
 * - QueueEmpty: When queue becomes empty
 * - LongSession: Every 30 minutes of listening
 * - FirstTrackOfDay: First track of the session (time-based greeting)
 * - Milestone: Every 50, 100, 500 tracks played
 * - TimeAnnouncement: Every 30s, but only at specific hours (9, 12, 15, 18, 21)
 * - MoodShift: When track mood changes significantly
 * - UserRequest: Manual trigger (not handled here, triggered from UI)
 * 
 * Does NOT speak directly - only emits events to store.djPendingEvent
 * Player component consumes these events and calls aiDjEvent() + TTS
 */
export function useTriggerEngine(enabled: boolean) {
  const {
    currentTrack,
    queue,
    settings,
    djSessionStart,
    djSessionTracksPlayed,
    djLastTrackStartAt,
    setDjSessionStart,
    incrementDjSessionTracks,
    setDjLastTrackStartAt,
    resetDjSession,
    trackMetadata,
  } = useAppStore();

  // Track previous state to detect changes
  const prevTrackRef = useRef<Track | SearchResult | null>(null);
  const prevQueueLengthRef = useRef<number>(0);
  const lastMilestoneCheckRef = useRef<number>(0);
  const lastTimeAnnouncementRef = useRef<number>(0);
  const sessionCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Get trigger settings (default all to true except UserRequest always enabled)
  const triggers = settings?.dj_triggers_enabled ?? {
    track_start: true,
    track_end: true,
    queue_empty: true,
    long_session: true,
    first_track_of_day: true,
    milestone: true,
    time_announcement: true,
    mood_shift: true,
  };

  /**
   * Emit a trigger event to the store if conditions allow.
   *
   * Reads cooldown/count/action references via useAppStore.getState() at
   * call time rather than as reactive hook dependencies, so this callback's
   * identity only changes when `enabled` or `settings` change. Effects that
   * depend on emitTrigger (several of which own a setInterval) would
   * otherwise get their interval reset on every unrelated trigger firing,
   * starving longer-period checks (e.g. the 30-minute LongSession check).
   */
  const emitTrigger = useCallback((triggerType: DjTriggerType, context: Partial<DjEventContext>) => {
    const {
      djLastInterventionAt,
      djInterventionCount,
      setDjPendingEvent,
      setDjLastInterventionAt,
      incrementDjInterventionCount,
    } = useAppStore.getState();

    if (!enabled || !settings?.dj_mode_enabled) return;
    if (djLastInterventionAt && Date.now() - djLastInterventionAt < GLOBAL_COOLDOWN_MS) {
      console.log(`[TriggerEngine] ${triggerType} blocked by cooldown`);
      return;
    }
    if (djInterventionCount >= MAX_INTERVENTIONS_PER_SESSION) {
      console.log(`[TriggerEngine] ${triggerType} blocked by max interventions`);
      return;
    }

    const fullContext: DjEventContext = {
      trigger_type: triggerType,
      style: settings.dj_style,
      language: settings.dj_language,
      model: settings.ollama_model,
      ...context,
    };

    console.log(`[TriggerEngine] Emitting ${triggerType}`, fullContext);
    setDjPendingEvent(fullContext);
    setDjLastInterventionAt(Date.now());
    incrementDjInterventionCount();
  }, [enabled, settings]);

  /**
   * Get time of day category
   */
  const getTimeOfDay = (): 'morning' | 'afternoon' | 'evening' | 'night' => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  };

  /**
   * Check if this is the first track of the day
   */
  const isFirstTrackOfDay = (): boolean => {
    const lastPlayedKey = 'ytm_last_played_date';
    const today = new Date().toDateString();
    const lastPlayed = localStorage.getItem(lastPlayedKey);
    
    if (lastPlayed !== today) {
      localStorage.setItem(lastPlayedKey, today);
      return true;
    }
    return false;
  };

  /**
   * Get track mood from metadata
   */
  const getTrackMood = useCallback((track: Track | SearchResult | null): string | undefined => {
    if (!track || !('id' in track)) return undefined;
    const meta = trackMetadata.get(track.id);
    return meta?.mood;
  }, [trackMetadata]);

  // ============================================================================
  // Effect 1: Initialize session on first track
  // ============================================================================
  useEffect(() => {
    if (!enabled || !currentTrack || djSessionStart) return;
    
    console.log('[TriggerEngine] Starting new DJ session');
    setDjSessionStart(Date.now());
    
    // Check FirstTrackOfDay trigger
    if (triggers.first_track_of_day && isFirstTrackOfDay()) {
      emitTrigger('FirstTrackOfDay', {
        current_title: 'title' in currentTrack ? currentTrack.title : undefined,
        current_artist: 'artist' in currentTrack ? currentTrack.artist : undefined,
        time_of_day: getTimeOfDay(),
      });
    }
  }, [enabled, currentTrack, djSessionStart, emitTrigger, setDjSessionStart, triggers.first_track_of_day]);

  // ============================================================================
  // Effect 2: Track change detection (TrackStart + MoodShift)
  // ============================================================================
  useEffect(() => {
    if (!enabled || !currentTrack) return;
    
    const prevTrack = prevTrackRef.current;
    const isNewTrack = prevTrack?.id !== currentTrack.id;
    
    if (isNewTrack && prevTrack) {
      incrementDjSessionTracks();
      
      // TrackStart: 10% chance with cooldown
      if (triggers.track_start) {
        const tracksSinceLastStart = djLastTrackStartAt 
          ? djSessionTracksPlayed - djLastTrackStartAt
          : TRACK_START_COOLDOWN_TRACKS + 1;
        
        if (tracksSinceLastStart >= TRACK_START_COOLDOWN_TRACKS && Math.random() < 0.1) {
          emitTrigger('TrackStart', {
            current_title: 'title' in currentTrack ? currentTrack.title : undefined,
            current_artist: 'artist' in currentTrack ? currentTrack.artist : undefined,
            current_track_id: 'id' in currentTrack ? currentTrack.id : undefined,
          });
          setDjLastTrackStartAt(djSessionTracksPlayed);
        }
      }
      
      // MoodShift: Detect mood change
      if (triggers.mood_shift) {
        const prevMood = getTrackMood(prevTrack);
        const currentMood = getTrackMood(currentTrack);
        
        if (prevMood && currentMood && prevMood !== currentMood) {
          emitTrigger('MoodShift', {
            prev_mood: prevMood,
            current_mood: currentMood,
            current_title: 'title' in currentTrack ? currentTrack.title : undefined,
            current_artist: 'artist' in currentTrack ? currentTrack.artist : undefined,
          });
        }
      }
    }
    
    prevTrackRef.current = currentTrack;
  }, [enabled, currentTrack, djSessionTracksPlayed, djLastTrackStartAt, emitTrigger, getTrackMood, incrementDjSessionTracks, setDjLastTrackStartAt, triggers.mood_shift, triggers.track_start]);

  // ============================================================================
  // Effect 3: Queue empty detection
  // ============================================================================
  useEffect(() => {
    if (!enabled || !triggers.queue_empty) return;
    
    const prevLength = prevQueueLengthRef.current;
    const currentLength = queue.length;
    
    if (prevLength > 0 && currentLength === 0) {
      console.log('[TriggerEngine] Queue became empty');
      emitTrigger('QueueEmpty', {});
    }
    
    prevQueueLengthRef.current = currentLength;
  }, [enabled, queue.length, triggers.queue_empty, emitTrigger]);

  // ============================================================================
  // Effect 4: Long session check (every 30 minutes)
  // ============================================================================
  useEffect(() => {
    if (!enabled || !triggers.long_session || !djSessionStart) return;
    
    const checkInterval = setInterval(() => {
      const sessionDurationMs = Date.now() - djSessionStart;
      const sessionMinutes = Math.floor(sessionDurationMs / 60_000);
      
      // Trigger every 30 minutes
      if (sessionMinutes > 0 && sessionMinutes % 30 === 0) {
        emitTrigger('LongSession', {
          session_duration_minutes: sessionMinutes,
        });
      }
    }, 60_000); // Check every minute
    
    sessionCheckIntervalRef.current = checkInterval;
    
    return () => {
      if (sessionCheckIntervalRef.current) {
        clearInterval(sessionCheckIntervalRef.current);
      }
    };
  }, [enabled, triggers.long_session, djSessionStart, emitTrigger]);

  // ============================================================================
  // Effect 5: Milestone tracking
  // ============================================================================
  useEffect(() => {
    if (!enabled || !triggers.milestone) return;
    
    const checkMilestone = async () => {
      try {
        const totalCount = await getTotalPlayCount();
        
        // Check if we just hit a milestone
        const milestones = [50, 100, 500, 1000, 5000, 10000];
        const lastCheck = lastMilestoneCheckRef.current;
        
        for (const milestone of milestones) {
          if (totalCount >= milestone && lastCheck < milestone) {
            emitTrigger('Milestone', {
              milestone_count: milestone,
              total_tracks_played: totalCount,
            });
            lastMilestoneCheckRef.current = milestone;
            break; // Only trigger once per check
          }
        }
        
        lastMilestoneCheckRef.current = totalCount;
      } catch (err) {
        console.error('[TriggerEngine] Failed to check milestone:', err);
      }
    };
    
    // Check on track change
    if (currentTrack) {
      checkMilestone();
    }
  }, [enabled, triggers.milestone, currentTrack, emitTrigger]);

  // ============================================================================
  // Effect 6: Time announcement (every 30s at specific hours)
  // ============================================================================
  useEffect(() => {
    if (!enabled || !triggers.time_announcement) return;
    
    const checkInterval = setInterval(() => {
      const now = Date.now();
      const hour = new Date().getHours();
      const lastAnnouncement = lastTimeAnnouncementRef.current;
      
      // Only announce at 9, 12, 15, 18, 21
      const validHours = [9, 12, 15, 18, 21];
      if (!validHours.includes(hour)) return;
      
      // Check if we've already announced in the last 30 seconds
      if (now - lastAnnouncement < 30_000) return;
      
      emitTrigger('TimeAnnouncement', {
        time_of_day: getTimeOfDay(),
      });
      
      lastTimeAnnouncementRef.current = now;
    }, 30_000); // Check every 30 seconds
    
    return () => clearInterval(checkInterval);
  }, [enabled, triggers.time_announcement, emitTrigger]);

  // ============================================================================
  // Effect 7: Session reset on disable
  // ============================================================================
  useEffect(() => {
    if (!enabled) {
      console.log('[TriggerEngine] Disabled, resetting session');
      resetDjSession();
    }
  }, [enabled, resetDjSession]);

  // Return nothing - this hook only manages side effects
  return null;
}
