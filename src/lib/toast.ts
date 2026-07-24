export type ToastType = "success" | "error" | "info";

let addToastFn: ((message: string, type?: ToastType) => void) | null = null;

export function setToastHandler(fn: ((message: string, type?: ToastType) => void) | null) {
  addToastFn = fn;
}

/** Global toast function — call from anywhere */
export function showToast(message: string, type: ToastType = "info") {
  addToastFn?.(message, type);
}
