import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ErrorBanner } from './ErrorBanner'

/**
 * Last-resort catch for render errors, so one broken component doesn't blank
 * the whole window. Main-process state (sessions, tunnels) is unaffected, so
 * "Try again" just remounts the tree.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ViewDeck] render error', error, info.componentStack)
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-3 p-6">
        <ErrorBanner
          error={{ code: 'UNKNOWN', message: 'Something went wrong while rendering this screen.', hint: 'Your connections and sessions are unaffected.', detail: this.state.error.stack ?? this.state.error.message }}
        />
        <div>
          <Button variant="outline" onClick={() => this.setState({ error: null })}>
            <RotateCcw /> Try again
          </Button>
        </div>
      </div>
    )
  }
}
