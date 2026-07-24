import { useState, useRef, useCallback, useEffect } from "react";
import { showToast } from "../lib/toast";

interface UseOllamaCallState<T> {
  loading: boolean;
  error: string | null;
  result: T | null;
  requestId: string | null;
}

interface UseOllamaCallReturn<T> {
  loading: boolean;
  error: string | null;
  result: T | null;
  requestId: string | null;
  execute: (fn: () => Promise<T>, onResult?: (result: T) => void, onError?: (error: string) => void) => void;
  cancel: () => void;
  reset: () => void;
}

export function useOllamaCall<T = any>(): UseOllamaCallReturn<T> {
  const [state, setState] = useState<UseOllamaCallState<T>>({
    loading: false,
    error: null,
    result: null,
    requestId: null,
  });
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
    };
  }, []);

  const execute = useCallback((fn: () => Promise<T>, onResult?: (result: T) => void, onError?: (error: string) => void) => {
    cancelledRef.current = false;
    const rid = crypto.randomUUID().slice(0, 8);

    setState({
      loading: true,
      error: null,
      result: null,
      requestId: rid,
    });

    const timeout = setTimeout(() => {
      if (!mountedRef.current) return;
      cancelledRef.current = true;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: "AI features temporarily unavailable — check Ollama status in Settings",
      }));
      showToast("Ollama request timed out. Check your Ollama connection.", "error");
    }, 180_000); // 3min global timeout

    fn()
      .then((res) => {
        clearTimeout(timeout);
        if (!mountedRef.current || cancelledRef.current) return;
        setState({
          loading: false,
          error: null,
          result: res,
          requestId: rid,
        });
        onResult?.(res);
      })
      .catch((err) => {
        clearTimeout(timeout);
        if (!mountedRef.current || cancelledRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({
          loading: false,
          error: msg,
          result: null,
          requestId: rid,
        });
        showToast(
          `Ollama error: ${msg.slice(0, 120)}`,
          "error"
        );
        onError?.(msg);
      });
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setState({ loading: false, error: null, result: null, requestId: null });
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    setState({ loading: false, error: null, result: null, requestId: null });
  }, []);

  return {
    loading: state.loading,
    error: state.error,
    result: state.result,
    requestId: state.requestId,
    execute,
    cancel,
    reset,
  };
}
