import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { useHelp } from './HelpProvider'
import { HelpProvider } from './HelpProvider'
import HelpOverlay from './HelpOverlay'

function TestShell({ children }: { children: React.ReactNode }) {
  return (
    <HelpProvider>
      {children}
      <HelpOverlay />
    </HelpProvider>
  )
}

function GuideLauncher() {
  const { startGuide } = useHelp()
  const location = useLocation()
  return (
    <>
      <output data-testid="pathname">{location.pathname}</output>
      <button onClick={() => startGuide('xtream-setup')}>Start Xtream setup</button>
      <button onClick={() => startGuide('player-controls')}>Start player controls</button>
    </>
  )
}

function renderGuide(initialPath = '/help') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <TestShell><GuideLauncher /></TestShell>
    </MemoryRouter>,
  )
}

describe('HelpProvider', () => {
  it('navigates to the safe Xtream setup handoff without rendering or filling credentials', async () => {
    const user = userEvent.setup()
    renderGuide()

    await user.click(screen.getByRole('button', { name: 'Start Xtream setup' }))

    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/settings'))
    expect(screen.getByRole('heading', { name: 'Enter your Xtream details' })).toBeInTheDocument()
    expect(screen.getByText(/your_username/)).toBeInTheDocument()
    expect(document.querySelector('input')).toBeNull()
  })

  it('waits for the user to open the player instead of navigating or starting playback', async () => {
    const user = userEvent.setup()
    renderGuide()

    await user.click(screen.getByRole('button', { name: 'Start player controls' }))
    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/vod'))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText(/Start playback to continue this step/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Waiting for player…' })).toBeDisabled()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/vod')
  })
})
