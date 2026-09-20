import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { CommandBar } from '../components/CommandBar';
import { useCommandExecutor } from '../hooks/useCommandExecutor';
import { useAppStore } from '../store';
import type { PlayerCommand, Settings } from '../types';

vi.mock('../api');
vi.mock('../hooks/useCommandExecutor');

const initialState = useAppStore.getState();
const metallica: PlayerCommand = { command: 'search', query: 'Metallica' };
const abba: PlayerCommand = { command: 'search', query: 'Abba' };
const executeCommand = vi.fn<ReturnType<typeof useCommandExecutor>['executeCommand']>();
const onClose = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function input() {
  return screen.getByRole('textbox');
}

function type(value: string) {
  fireEvent.change(input(), { target: { value } });
}

async function advance(milliseconds = 600) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

async function enter() {
  await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }); });
}

async function preview(command = metallica, text = 'search Metallica') {
  vi.mocked(api.ollamaParseCommand).mockResolvedValue(command);
  type(text);
  await advance();
  expect(screen.getByRole('button', { name: 'Execute' })).toBeEnabled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  useAppStore.setState({
    ...initialState,
    settings: { ollama_enabled: true } as Settings,
    ollamaAvailable: true,
  }, true);
  vi.mocked(useCommandExecutor).mockReturnValue({ executeCommand });
  vi.mocked(api.ollamaParseCommand).mockResolvedValue(metallica);
  executeCommand.mockResolvedValue({ success: true, feedback: 'Search completed' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useAppStore.setState(initialState, true);
});

describe('CommandBar', () => {
  it('shows the English rock example and AI connection status', () => {
    render(<CommandBar isOpen onClose={onClose} />);
    expect(screen.getByRole('button', { name: '"play some rock"' })).toBeVisible();
    expect(screen.queryByText(/pune ceva rock/)).not.toBeInTheDocument();
    expect(screen.getByText('AI Connected')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Execute' })).not.toBeInTheDocument();
  });

  it('restores input focus after selecting a quick example and executes it with Enter', async () => {
    render(<CommandBar isOpen onClose={onClose} />);
    await advance(50);
    const example = screen.getByRole('button', { name: '"search Metallica"' });
    example.focus();
    fireEvent.click(example);
    expect(input()).toHaveValue('search Metallica');
    await advance(50);
    expect(input()).toHaveFocus();
    await advance();
    expect(screen.getByText('"Metallica"')).toBeVisible();
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Enter' }); });
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(metallica);
    expect(api.ollamaParseCommand).toHaveBeenCalledExactlyOnceWith('search Metallica');
    expect(screen.getByText('Search completed')).toBeVisible();
    await advance(1200);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('preserves manual input followed by Enter', async () => {
    render(<CommandBar isOpen onClose={onClose} />);
    await preview(abba, 'search Abba');
    await enter();
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(abba);
    expect(screen.getByText('Search completed')).toBeVisible();
  });

  it('uses Execute for the same command, feedback and auto-close behavior', async () => {
    render(<CommandBar isOpen onClose={onClose} />);
    await preview();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Execute' })); });
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(metallica);
    expect(api.ollamaParseCommand).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Search completed')).toBeVisible();
    await advance(1200);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'] as const)('blocks rapid Enter and Execute until execution %ss, then releases the guard', async (outcome) => {
    const pending = deferred<Awaited<ReturnType<typeof executeCommand>>>();
    executeCommand.mockReturnValueOnce(pending.promise);
    render(<CommandBar isOpen onClose={onClose} />);
    await preview();
    const button = screen.getByRole('button', { name: 'Execute' });
    // Keep the events in one batch to exercise the synchronous guard before a render.
    act(() => {
      fireEvent.keyDown(input(), { key: 'Enter' });
      fireEvent.keyDown(input(), { key: 'Enter' });
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(metallica);
    expect(button).toBeDisabled();
    await act(async () => {
      if (outcome === 'resolve') pending.resolve({ success: false, feedback: 'No results' });
      else pending.reject(new Error('Network unavailable'));
    });
    expect(screen.getByText(outcome === 'resolve' ? 'No results' : '❌ Network unavailable')).toBeVisible();
    await advance(1200);
    expect(onClose).not.toHaveBeenCalled();
    await enter();
    expect(executeCommand).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Search completed')).toBeVisible();
  });

  it.each(['example', 'Execute'])('closes once on Escape with focus on %s', async (target) => {
    render(<CommandBar isOpen onClose={onClose} />);
    if (target === 'Execute') await preview();
    const button = screen.getByRole('button', { name: target === 'Execute' ? 'Execute' : '"search Metallica"' });
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('never executes the previous parsed command after the input changes', async () => {
    render(<CommandBar isOpen onClose={onClose} />);
    await preview();
    const pending = deferred<PlayerCommand>();
    vi.mocked(api.ollamaParseCommand).mockReturnValueOnce(pending.promise);
    type('search Abba');
    expect(screen.queryByText('"Metallica"')).not.toBeInTheDocument();
    await enter();
    await enter();
    expect(executeCommand).not.toHaveBeenCalled();
    expect(api.ollamaParseCommand).toHaveBeenLastCalledWith('search Abba');
    await act(async () => { pending.resolve(abba); });
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(abba);
    await advance();
    expect(api.ollamaParseCommand).toHaveBeenCalledTimes(2);
  });

  it.each(['resolve', 'reject'] as const)('ignores a late %s from an older debounced parse', async (outcome) => {
    const first = deferred<PlayerCommand>();
    vi.mocked(api.ollamaParseCommand).mockReturnValueOnce(first.promise).mockResolvedValueOnce(abba);
    render(<CommandBar isOpen onClose={onClose} />);
    type('search Metallica');
    await advance();
    type('search Abba');
    await advance();
    expect(screen.getByText('"Abba"')).toBeVisible();
    await act(async () => {
      if (outcome === 'resolve') first.resolve(metallica);
      else first.reject(new Error('Old request failed'));
    });
    expect(screen.getByText('"Abba"')).toBeVisible();
    expect(screen.queryByText('"Metallica"')).not.toBeInTheDocument();
    await enter();
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(abba);
  });

  it('does not dispatch an execution-time parse after input changes', async () => {
    const pending = deferred<PlayerCommand>();
    vi.mocked(api.ollamaParseCommand).mockReturnValueOnce(pending.promise).mockResolvedValue(abba);
    render(<CommandBar isOpen onClose={onClose} />);
    type('search Metallica');
    await enter();
    type('search Abba');
    await act(async () => { pending.resolve(metallica); });
    expect(executeCommand).not.toHaveBeenCalled();
    await enter();
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(abba);
  });

  it('clears stale feedback on editing and clears previews during keyboard history navigation', async () => {
    executeCommand.mockResolvedValue({ success: false, feedback: 'Try again' });
    render(<CommandBar isOpen onClose={onClose} />);
    await preview();
    await enter();
    expect(screen.getByText('Try again')).toBeVisible();
    await preview(abba, 'search Abba');
    expect(screen.queryByText('Try again')).not.toBeInTheDocument();
    await enter();
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input()).toHaveValue('search Abba');
    expect(screen.queryByText('AI Parsed')).not.toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input()).toHaveValue('search Metallica');
    vi.mocked(api.ollamaParseCommand).mockResolvedValue(metallica);
    await advance();
    expect(screen.getByText('"Metallica"')).toBeVisible();
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input()).toHaveValue('search Abba');
    expect(screen.queryByText('AI Parsed')).not.toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input()).toHaveValue('');
    const history = screen.getByTitle('Re-run: search Metallica');
    history.focus();
    fireEvent.click(history);
    await advance(50);
    expect(input()).toHaveValue('search Metallica');
    expect(input()).toHaveFocus();
    expect(screen.queryByText('AI Parsed')).not.toBeInTheDocument();
    await enter();
    expect(executeCommand).toHaveBeenLastCalledWith(metallica);
  });

  it('clears input and feedback, cancels auto-close, and selects a fresh example', async () => {
    render(<CommandBar isOpen onClose={onClose} />);
    await preview();
    await enter();
    fireEvent.click(screen.getByRole('button', { name: 'Clear input' }));
    expect(input()).toHaveValue('');
    expect(screen.queryByText('Search completed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Execute' })).not.toBeInTheDocument();
    await advance(1200);
    expect(onClose).not.toHaveBeenCalled();
    expect(input()).toHaveFocus();
  });

  it('passes Romanian input to the same parser and preserves multi-command preview', async () => {
    const command: PlayerCommand = { command: 'multi', commands: [metallica, { command: 'set_volume', level: 0.5 }] };
    render(<CommandBar isOpen onClose={onClose} />);
    await preview(command, 'caută Metallica și volum 50%');
    expect(api.ollamaParseCommand).toHaveBeenCalledExactlyOnceWith('caută Metallica și volum 50%');
    expect(screen.getByText('2 commands')).toBeVisible();
    expect(screen.getByText('"Metallica"')).toBeVisible();
    expect(screen.getByText('50%')).toBeVisible();
    await enter();
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(command);
  });

  it('does not offer Execute for an unknown command and recovers after a parse failure', async () => {
    vi.mocked(api.ollamaParseCommand).mockResolvedValueOnce({ command: 'unknown' })
      .mockRejectedValueOnce(new Error('Parser unavailable')).mockResolvedValueOnce(abba);
    render(<CommandBar isOpen onClose={onClose} />);
    type('unrecognized');
    await advance();
    expect(screen.queryByRole('button', { name: 'Execute' })).not.toBeInTheDocument();
    await enter();
    expect(screen.getByText('❌ Parser unavailable')).toBeVisible();
    type('search Abba');
    await enter();
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(abba);
  });

  it('ignores a pending parse when closed and reopens empty with input focus', async () => {
    const pending = deferred<PlayerCommand>();
    vi.mocked(api.ollamaParseCommand).mockReturnValueOnce(pending.promise);
    const view = render(<CommandBar isOpen onClose={onClose} />);
    type('search Metallica');
    await advance();
    view.rerender(<CommandBar isOpen={false} onClose={onClose} />);
    await act(async () => { pending.resolve(metallica); });
    view.rerender(<CommandBar isOpen onClose={onClose} />);
    await advance(50);
    expect(input()).toHaveValue('');
    expect(input()).toHaveFocus();
    expect(screen.queryByText('AI Parsed')).not.toBeInTheDocument();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('closes on the overlay but not on a descendant', () => {
    const { container } = render(<CommandBar isOpen onClose={onClose} />);
    fireEvent.click(screen.getByText('Quick examples:'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
