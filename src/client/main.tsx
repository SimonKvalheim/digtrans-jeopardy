import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BoardScreen } from './routes/BoardScreen.tsx'
import { HostScreen } from './routes/HostScreen.tsx'
import { TeamScreen } from './routes/TeamScreen.tsx'
import { AdminScreen } from './routes/AdminScreen.tsx'
import './styles.css'

// Four surfaces, one per device, each opened once and left alone all evening.
// Nobody ever navigates between them, so a router library would be dead weight.
function resolveScreen() {
  switch (window.location.pathname.replace(/\/+$/, '')) {
    case '/host':
      return <HostScreen />
    case '/t':
      return <TeamScreen />
    case '/admin':
      return <AdminScreen />
    default:
      return <BoardScreen />
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{resolveScreen()}</StrictMode>,
)
