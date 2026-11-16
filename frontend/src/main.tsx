import React from 'react'
import ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installWWHost } from './plugin/host'

/** Pack IIFE external：同一份 React + WWHost 业务表面。 */
Object.assign(globalThis, { React, ReactDOM })
installWWHost()

/* 尽早标记平台，避免 mac 顶栏红绿灯占位闪一下；bootstrap 会用 Wails Environment 复核 */
if (/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')) {
  document.documentElement.setAttribute('data-platform', 'darwin')
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
