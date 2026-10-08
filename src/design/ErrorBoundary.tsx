import { Component, type ReactNode } from 'react';

/**
 * Last line of defence: a screen that throws while drawing shows this instead of a blank app.
 * Nothing is lost — every change is already saved on the phone when it's made.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Hisaab screen error', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="welcome" role="alert">
        <div className="stack" style={{ maxWidth: 360, textAlign: 'center' }}>
          <h1 style={{ margin: 0 }}>Something went wrong on this screen</h1>
          <p className="muted" style={{ margin: 0 }}>
            Your data is safe — everything you saved is still on this phone.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => {
              location.hash = '#home';
              location.reload();
            }}
          >
            Back to Home
          </button>
          <p className="faint" style={{ margin: 0, fontSize: 'var(--fs-xs)' }}>
            {this.state.error.message}
          </p>
        </div>
      </div>
    );
  }
}
