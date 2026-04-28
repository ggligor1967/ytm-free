import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { showToast } from "./Toast";

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary caught:", error);
    showToast("Something went wrong — see details in the panel", "error");
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
          <AlertTriangle className="w-10 h-10 text-orange-400" />
          <h3 className="text-lg font-semibold text-white">
            {this.props.fallbackMessage || "This section encountered an error"}
          </h3>
          <p className="text-sm text-ytm-text-secondary max-w-md">
            {this.state.error?.message}
          </p>
          <button
            onClick={this.reset}
            className="flex items-center gap-2 px-4 py-2 bg-ytm-accent/20 hover:bg-ytm-accent/40 text-ytm-accent rounded-lg text-sm transition"
          >
            <RefreshCw className="w-4 h-4" /> Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
