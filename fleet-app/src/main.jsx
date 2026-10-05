import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { CopilotKit } from '@copilotkit/react-core'
import '@copilotkit/react-ui/styles.css'

const isDemo = sessionStorage.getItem('fp-token') === 'demo'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <CopilotKit runtimeUrl={isDemo ? null : 'http://localhost:5000/api/copilotkit'}>
      <App />
    </CopilotKit>
  </StrictMode>,
)