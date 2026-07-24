import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { ToastContainer } from "../components/Toast";
import { showToast } from "../lib/toast";

describe("Toast / ToastContainer handoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("is a no-op when called before any ToastContainer has mounted", () => {
    expect(() => showToast("too early", "info")).not.toThrow();
  });

  it("renders a toast once a ToastContainer is mounted", () => {
    render(<ToastContainer />);

    act(() => {
      showToast("Saved!", "success");
    });

    expect(screen.getByText("Saved!")).toBeInTheDocument();
  });

  it("renders multiple concurrent toasts", () => {
    render(<ToastContainer />);

    act(() => {
      showToast("First", "info");
      showToast("Second", "error");
    });

    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("auto-dismisses a toast after its timeout", () => {
    render(<ToastContainer />);

    act(() => {
      showToast("Fleeting", "info");
    });
    expect(screen.getByText("Fleeting")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3500);
    });

    expect(screen.queryByText("Fleeting")).not.toBeInTheDocument();
  });

  it("removes a toast when its dismiss button is clicked", () => {
    render(<ToastContainer />);

    act(() => {
      showToast("Dismiss me", "info");
    });
    const toastText = screen.getByText("Dismiss me");
    const dismissButton = toastText.closest("div")?.querySelector("button");
    expect(dismissButton).toBeTruthy();
    fireEvent.click(dismissButton as HTMLButtonElement);

    expect(screen.queryByText("Dismiss me")).not.toBeInTheDocument();
  });

  it("is a no-op again after the ToastContainer unmounts", () => {
    const { unmount } = render(<ToastContainer />);
    unmount();

    expect(() => showToast("too late", "info")).not.toThrow();
  });
});
