import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** ErrorBoundary 捕获子树渲染错误，避免整页白屏。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[WWorkbench]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-error-fallback">
          <h2>界面渲染出错</h2>
          <pre>{this.state.error.message}</pre>
          <button type="button" className="wn-btn wn-btn-primary" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
