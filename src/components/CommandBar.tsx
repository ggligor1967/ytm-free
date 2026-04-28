import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store';
import * as api from '../api';
import { useCommandExecutor } from '../hooks/useCommandExecutor';
import type { PlayerCommand, CommandHistoryEntry } from '../types';
import {
  Command,
  Loader2,
  Sparkles,
  Clock,
  CheckCircle2,
  XCircle,
  X,
  ArrowRight,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Heart,
  Search,
  ListPlus,
  Volume2,
  Shuffle,
  Repeat,
  Download,
  Navigation,
} from 'lucide-react';
import clsx from 'clsx';

interface CommandBarProps {
  isOpen: boolean;
  onClose: () => void;
}

// Icon + label for command preview
const commandMeta: Record<string, { icon: typeof Play; label: string; color: string }> = {
  play: { icon: Play, label: 'Play', color: 'text-green-400' },
  pause: { icon: Pause, label: 'Pause', color: 'text-yellow-400' },
  next: { icon: SkipForward, label: 'Next', color: 'text-blue-400' },
  previous: { icon: SkipBack, label: 'Previous', color: 'text-blue-400' },
  favorite: { icon: Heart, label: 'Favorite', color: 'text-red-400' },
  search: { icon: Search, label: 'Search', color: 'text-purple-400' },
  create_playlist: { icon: ListPlus, label: 'Create Playlist', color: 'text-cyan-400' },
  set_mood: { icon: Sparkles, label: 'Set Mood', color: 'text-pink-400' },
  set_volume: { icon: Volume2, label: 'Volume', color: 'text-orange-400' },
  add_to_queue: { icon: ListPlus, label: 'Add to Queue', color: 'text-teal-400' },
  toggle_shuffle: { icon: Shuffle, label: 'Shuffle', color: 'text-indigo-400' },
  set_repeat: { icon: Repeat, label: 'Repeat', color: 'text-indigo-400' },
  navigate: { icon: Navigation, label: 'Navigate', color: 'text-sky-400' },
  download: { icon: Download, label: 'Download', color: 'text-emerald-400' },
  multi: { icon: Command, label: 'Multi', color: 'text-ytm-accent' },
  unknown: { icon: XCircle, label: 'Unknown', color: 'text-ytm-text-secondary' },
};

function CommandPreview({ cmd }: { cmd: PlayerCommand }) {
  const meta = commandMeta[cmd.command] || commandMeta.unknown;
  const Icon = meta.icon;

  const getDetail = () => {
    switch (cmd.command) {
      case 'play': return cmd.query ? `"${cmd.query}"` : 'Resume';
      case 'search': return `"${cmd.query}"`;
      case 'create_playlist': return `"${cmd.name}"`;
      case 'set_mood': return cmd.mood;
      case 'set_volume': return `${Math.round(cmd.level * 100)}%`;
      case 'add_to_queue': return `"${cmd.query}"`;
      case 'set_repeat': return cmd.mode;
      case 'navigate': return cmd.view;
      case 'download': return cmd.query ? `"${cmd.query}"` : 'Current track';
      case 'multi': return `${cmd.commands.length} commands`;
      default: return '';
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className={clsx('w-4 h-4', meta.color)} />
      <span className="font-medium text-ytm-text">{meta.label}</span>
      {getDetail() && (
        <>
          <ArrowRight className="w-3 h-3 text-ytm-text-secondary" />
          <span className="text-ytm-text-secondary">{getDetail()}</span>
        </>
      )}
    </div>
  );
}

export function CommandBar({ isOpen, onClose }: CommandBarProps) {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedCommand, setParsedCommand] = useState<PlayerCommand | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState(true);
  const [history, setHistory] = useState<CommandHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const parseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { ollamaAvailable, settings } = useAppStore();
  const { executeCommand } = useCommandExecutor();

  const aiEnabled = settings?.ollama_enabled && ollamaAvailable;

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setInput('');
      setParsedCommand(null);
      setFeedback(null);
      setHistoryIndex(-1);
      // Small delay for animation
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Auto-parse with debounce when typing
  useEffect(() => {
    if (!aiEnabled || input.trim().length < 2) {
      setParsedCommand(null);
      return;
    }

    if (parseTimeoutRef.current) clearTimeout(parseTimeoutRef.current);
    parseTimeoutRef.current = setTimeout(async () => {
      setIsProcessing(true);
      try {
        const cmd = await api.ollamaParseCommand(input.trim());
        if (cmd.command !== 'unknown') {
          setParsedCommand(cmd);
        } else {
          setParsedCommand(null);
        }
      } catch {
        setParsedCommand(null);
      } finally {
        setIsProcessing(false);
      }
    }, 600);

    return () => {
      if (parseTimeoutRef.current) clearTimeout(parseTimeoutRef.current);
    };
  }, [input, aiEnabled]);

  const handleExecute = useCallback(async () => {
    if (!input.trim()) return;

    setIsProcessing(true);
    setFeedback(null);

    try {
      // Parse if not already parsed
      let cmd = parsedCommand;
      if (!cmd && aiEnabled) {
        cmd = await api.ollamaParseCommand(input.trim());
      }

      if (!cmd || cmd.command === 'unknown') {
        setFeedback('❓ Could not understand the command');
        setFeedbackSuccess(false);
        return;
      }

      // Execute
      const result = await executeCommand(cmd);
      setFeedback(result.feedback);
      setFeedbackSuccess(result.success);

      // Add to history
      const entry: CommandHistoryEntry = {
        input: input.trim(),
        command: cmd,
        feedback: result.feedback,
        timestamp: new Date().toISOString(),
      };
      setHistory(prev => [entry, ...prev].slice(0, 20));

      // Auto-close after successful execution
      if (result.success) {
        setTimeout(() => onClose(), 1200);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback(`❌ ${msg}`);
      setFeedbackSuccess(false);
    } finally {
      setIsProcessing(false);
    }
  }, [input, parsedCommand, aiEnabled, executeCommand, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        setInput(history[newIndex].input);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[newIndex].input);
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="w-full max-w-xl bg-ytm-surface border border-ytm-border rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-top-2 duration-200">
        {/* Input Area */}
        <div className="relative flex items-center px-4 border-b border-ytm-border">
          <Command className="w-5 h-5 text-ytm-text-secondary flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={aiEnabled ? 'Type a command... (e.g. "play rock", "volume 50%", "search Metallica")' : 'AI commands require Ollama to be enabled'}
            disabled={!aiEnabled}
            className={clsx(
              'flex-1 h-14 px-3 bg-transparent border-none outline-none',
              'text-ytm-text placeholder:text-ytm-text-secondary',
              'disabled:opacity-50'
            )}
          />
          {isProcessing && (
            <Loader2 className="w-5 h-5 text-ytm-accent animate-spin flex-shrink-0" />
          )}
          {input && !isProcessing && (
            <button
              onClick={() => { setInput(''); setParsedCommand(null); setFeedback(null); }}
              className="text-ytm-text-secondary hover:text-ytm-text p-1"
              title="Clear input"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Command Preview */}
        {parsedCommand && !feedback && (
          <div className="px-5 py-3 border-b border-ytm-border/50 bg-ytm-accent/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-ytm-accent" />
                <span className="text-xs text-ytm-accent font-medium">AI Parsed</span>
              </div>
              <kbd className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-ytm-text-secondary">
                Enter to execute
              </kbd>
            </div>
            <div className="mt-2">
              <CommandPreview cmd={parsedCommand} />
              {parsedCommand.command === 'multi' && (
                <div className="mt-2 pl-6 space-y-1.5 border-l-2 border-ytm-border/50">
                  {parsedCommand.commands.map((sub, i) => (
                    <CommandPreview key={i} cmd={sub} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div className={clsx(
            'px-5 py-3 flex items-center gap-2 border-b border-ytm-border/50',
            feedbackSuccess ? 'bg-green-500/10' : 'bg-red-500/10'
          )}>
            {feedbackSuccess ? (
              <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            )}
            <span className={clsx(
              'text-sm',
              feedbackSuccess ? 'text-green-300' : 'text-red-300'
            )}>
              {feedback}
            </span>
          </div>
        )}

        {/* Recent History */}
        {!input && history.length > 0 && (
          <div className="max-h-48 overflow-y-auto">
            <div className="px-4 py-2 text-xs text-ytm-text-secondary flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Recent commands
            </div>
            {history.slice(0, 5).map((entry, i) => (
              <button
                key={i}
                onClick={() => setInput(entry.input)}
                title={`Re-run: ${entry.input}`}
                className="w-full px-5 py-2 text-left hover:bg-white/5 transition-colors flex items-center gap-3"
              >
                <CommandPreview cmd={entry.command} />
              </button>
            ))}
          </div>
        )}

        {/* Quick Tips (when empty and no history) */}
        {!input && history.length === 0 && aiEnabled && (
          <div className="px-5 py-4">
            <p className="text-xs text-ytm-text-secondary mb-3">Quick examples:</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                'pune ceva rock',
                'volume 50%',
                'search Metallica',
                'add to favorites',
                'create playlist Chill',
                'next song',
                'shuffle on',
                'go to settings',
              ].map((example) => (
                <button
                  key={example}
                  onClick={() => setInput(example)}
                  className="px-3 py-1.5 text-xs text-ytm-text-secondary hover:text-ytm-text bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-left truncate"
                >
                  "{example}"
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-ytm-border/50 text-[10px] text-ytm-text-secondary">
          <div className="flex items-center gap-3">
            <span><kbd className="px-1 py-0.5 bg-white/10 rounded">↑↓</kbd> history</span>
            <span><kbd className="px-1 py-0.5 bg-white/10 rounded">Enter</kbd> execute</span>
            <span><kbd className="px-1 py-0.5 bg-white/10 rounded">Esc</kbd> close</span>
          </div>
          {aiEnabled && (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
              <span>AI Connected</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
