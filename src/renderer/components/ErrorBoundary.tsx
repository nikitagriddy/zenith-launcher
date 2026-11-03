import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg p-10 text-center text-fg">
        <div className="font-display text-2xl font-semibold">Something went wrong</div>
        <p className="max-w-lg text-sm text-muted">{this.state.error.message}</p>
        <button className="btn-primary" onClick={() => window.location.reload()}>
          Reload Zenith
        </button>
      </div>
    )
  }
}
