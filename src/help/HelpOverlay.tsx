import { useEffect, useRef, useState } from 'react'
import { useHelp } from './HelpProvider'
import './HelpOverlay.css'

interface HighlightRect {
  top: number
  left: number
  width: number
  height: number
}

function rectFor(element: Element): HighlightRect {
  const rect = element.getBoundingClientRect()
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

export default function HelpOverlay() {
  const { activeGuide, activeTopic, activeStep, canAdvance, previousStep, nextStep, exitGuide } = useHelp()
  const [highlight, setHighlight] = useState<HighlightRect | null>(null)
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!activeStep?.anchor) {
      setHighlight(null)
      return
    }

    let target: Element | null = null
    let frame: number | null = null
    const updateHighlight = () => {
      target = document.querySelector(`[data-help="${activeStep.anchor}"]`)
      setHighlight(target ? rectFor(target) : null)
    }
    const scheduleUpdate = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateHighlight)
    }

    scheduleUpdate()
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)
    const observer = new MutationObserver(scheduleUpdate)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
      observer.disconnect()
    }
  }, [activeStep?.anchor])

  useEffect(() => {
    if (!activeStep) return
    panelRef.current?.focus()
  }, [activeStep])

  useEffect(() => {
    if (!activeGuide) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exitGuide()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeGuide, exitGuide])

  if (!activeGuide || !activeTopic || !activeStep) return null

  const waitingForPlayer = activeStep.waitForPath && !canAdvance

  return (
    <div className="help-overlay" aria-live="polite">
      {highlight && (
        <div
          className="help-highlight"
          style={{ top: highlight.top - 6, left: highlight.left - 6, width: highlight.width + 12, height: highlight.height + 12 }}
        />
      )}
      <aside ref={panelRef} className="help-guide-panel" role="dialog" aria-label={`${activeTopic.title}: ${activeStep.title}`} tabIndex={-1}>
        <div className="help-guide-header">
          <span className="help-guide-kicker">Singularity Help · {activeGuide.stepIndex + 1} of {activeTopic.steps.length}</span>
          <button className="help-guide-close" onClick={exitGuide} aria-label="Exit help guide">×</button>
        </div>
        <h2>{activeStep.title}</h2>
        <p>{activeStep.body}</p>
        {activeStep.example && <code className="help-guide-example">{activeStep.example}</code>}
        {waitingForPlayer && <p className="help-guide-waiting">Start playback to continue this step. The guide will remain open.</p>}
        {!waitingForPlayer && activeStep.anchor && !highlight && <p className="help-guide-waiting">This control is not available in the current view. Use the instruction above, then continue when it appears.</p>}
        <div className="help-guide-actions">
          <button className="help-guide-secondary" onClick={previousStep} disabled={activeGuide.stepIndex === 0}>Back</button>
          <button className="help-guide-primary" onClick={nextStep} disabled={!canAdvance}>
            {activeGuide.stepIndex === activeTopic.steps.length - 1 ? 'Finish' : waitingForPlayer ? 'Waiting for player…' : 'Next'}
          </button>
        </div>
      </aside>
    </div>
  )
}
