// src/components/ErrorBoundary.tsx
//
// TEMPORARY DEBUG TOOL. Wrap a part of the app in this and, instead of a black
// screen when something throws during render, you'll see the actual error text
// and component stack ON SCREEN — readable on a tablet with no dev tools.
//
// Usage (in the file that renders the crashing screen, e.g. the page that shows
// SessionCommandCenter):
//
//   import ErrorBoundary from '../components/ErrorBoundary';
//   ...
//   <ErrorBoundary>
//     <SessionCommandCenter ... />
//   </ErrorBoundary>
//
// Once we've read the error and fixed the real cause, you can remove the wrapper
// (or leave it — it does nothing while there's no error).

import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  stack: string;
  componentStack: string;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '', stack: '', componentStack: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      message: error?.message || String(error),
      stack: error?.stack || '(no stack)',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ componentStack: info?.componentStack || '(no component stack)' });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99999,
          background: '#fff',
          color: '#111',
          padding: '16px',
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: '13px',
          lineHeight: 1.4,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '16px', color: '#b91c1c', marginBottom: '10px' }}>
          Something crashed. Copy everything below and send it.
        </div>

        <div style={{ fontWeight: 700, marginTop: '12px' }}>MESSAGE:</div>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '4px 0 12px' }}>
          {this.state.message}
        </pre>

        <div style={{ fontWeight: 700 }}>COMPONENT STACK:</div>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '4px 0 12px' }}>
          {this.state.componentStack}
        </pre>

        <div style={{ fontWeight: 700 }}>JS STACK:</div>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '4px 0 12px' }}>
          {this.state.stack}
        </pre>

        <button
          onClick={() => this.setState({ hasError: false, message: '', stack: '', componentStack: '' })}
          style={{
            marginTop: '8px',
            padding: '10px 16px',
            background: '#111',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 700,
          }}
        >
          Dismiss
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
