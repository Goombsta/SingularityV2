import { Outlet } from 'react-router-dom'
import { HelpProvider } from '../../help/HelpProvider'
import HelpOverlay from '../../help/HelpOverlay'

export default function HelpRoot() {
  return (
    <HelpProvider>
      <Outlet />
      <HelpOverlay />
    </HelpProvider>
  )
}
