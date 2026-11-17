import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Trolley Titans Boundary Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let friendlyMessage = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string; path?: string };
        if (parsed.error) {
          friendlyMessage = `${parsed.error}${parsed.path ? ` (${parsed.path})` : ''}`;
        }
      } catch {
        // plain string message
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-2xl border border-red-200 bg-white p-6">
            <div className="flex items-center gap-3 text-red-700 mb-3">
              <AlertTriangle className="w-6 h-6 shrink-0" aria-hidden="true" />
              <h2 className="text-lg font-bold text-slate-900">Action Could Not Complete</h2>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed mb-5 break-words">
              {friendlyMessage}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
