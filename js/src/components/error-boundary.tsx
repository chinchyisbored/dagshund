import { Component, type ReactNode } from "react";

type ErrorBoundaryProps = {
  readonly children: ReactNode;
};

type ErrorBoundaryState = {
  readonly error: Error | null;
};

/** Minimal error boundary around React Flow canvases.
 *  React requires a class component for getDerivedStateFromError — this is the
 *  sole exception to the "no classes" rule in the codebase. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  readonly handleRetry = () => {
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error !== null) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-danger">
          <p className="text-lg">Something went wrong</p>
          <code className="max-w-lg rounded bg-code-bg px-3 py-1.5 text-sm text-danger">
            {this.state.error.message}
          </code>
          <button
            type="button"
            onClick={this.handleRetry}
            className="rounded border border-outline bg-surface-raised px-3 py-1.5 text-sm text-ink transition-colors hover:bg-accent/10"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
