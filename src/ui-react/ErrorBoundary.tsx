/**
 * Keeps one failing panel from silently breaking the workbench: the error is shown with a Reload button,
 * and a banner appears when the running code is out of date (failed hot update, uncaught errors).
 */
import { Component, ReactNode, useEffect, useState } from 'react';

export class PanelBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(`[${this.props.name}]`, error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel panel-error">
        <div className="panel-header">
          <span className="panel-title">{this.props.name}</span>
        </div>
        <div className="panel-body">
          <p>This panel stopped because of an error:</p>
          <pre>{this.state.error.message}</pre>
          <div className="explain-actions">
            <button onClick={() => this.setState({ error: null })}>Try again</button>
            <button onClick={() => location.reload()}>Reload the app</button>
          </div>
        </div>
      </div>
    );
  }
}

/** "The app was updated / hit an error — reload" banner. */
export function UpdateBanner() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const onError = (e: ErrorEvent) => setMsg(e.message || 'An error occurred');
    const onRejection = (e: PromiseRejectionEvent) => setMsg(String((e.reason as Error)?.message ?? e.reason));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    const hot = import.meta.hot;
    const onViteError = () => setMsg('The app was updated but the update failed to apply');
    hot?.on('vite:error', onViteError);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      hot?.off?.('vite:error', onViteError);
    };
  }, []);
  if (!msg) return null;
  return (
    <div className="update-banner">
      <span>Something went wrong ({msg}). The page may be running outdated code.</span>
      <button onClick={() => location.reload()}>Reload</button>
      <button className="ghost" onClick={() => setMsg(null)}>✕</button>
    </div>
  );
}