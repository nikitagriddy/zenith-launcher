import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/instrument-sans'
import '@fontsource-variable/unbounded'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
