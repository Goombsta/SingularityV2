import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getHelpTopic, type GuideStep, type HelpHandoff, type HelpTopic } from './helpContent'

interface ActiveGuide {
  topicId: string
  stepIndex: number
}

interface StartGuideOptions {
  keepCurrentRoute?: boolean
}

interface HelpContextValue {
  activeGuide: ActiveGuide | null
  activeTopic: HelpTopic | undefined
  activeStep: GuideStep | undefined
  canAdvance: boolean
  startGuide: (topicId: string, options?: StartGuideOptions) => void
  nextStep: () => void
  previousStep: () => void
  exitGuide: () => void
}

const HelpContext = createContext<HelpContextValue | null>(null)

function handoffState(handoff?: HelpHandoff) {
  return handoff ? { helpHandoff: handoff } : undefined
}

export function HelpProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [activeGuide, setActiveGuide] = useState<ActiveGuide | null>(null)

  const activeTopic = activeGuide ? getHelpTopic(activeGuide.topicId) : undefined
  const activeStep = activeTopic && activeGuide ? activeTopic.steps[activeGuide.stepIndex] : undefined
  const canAdvance = !activeStep?.waitForPath || location.pathname === activeStep.waitForPath

  const goToStep = useCallback((topic: HelpTopic, stepIndex: number) => {
    const step = topic.steps[stepIndex]
    setActiveGuide({ topicId: topic.id, stepIndex })
    if (step.route && (location.pathname !== step.route || step.handoff)) {
      navigate(step.route, { state: handoffState(step.handoff) })
    }
  }, [location.pathname, navigate])

  const startGuide = useCallback((topicId: string, options?: StartGuideOptions) => {
    const topic = getHelpTopic(topicId)
    if (!topic) return
    if (options?.keepCurrentRoute) {
      setActiveGuide({ topicId: topic.id, stepIndex: 0 })
      return
    }
    goToStep(topic, 0)
  }, [goToStep])

  const nextStep = useCallback(() => {
    if (!activeGuide || !activeTopic || !canAdvance) return
    const nextIndex = activeGuide.stepIndex + 1
    if (nextIndex >= activeTopic.steps.length) {
      setActiveGuide(null)
      return
    }
    goToStep(activeTopic, nextIndex)
  }, [activeGuide, activeTopic, canAdvance, goToStep])

  const previousStep = useCallback(() => {
    if (!activeGuide || !activeTopic || activeGuide.stepIndex === 0) return
    goToStep(activeTopic, activeGuide.stepIndex - 1)
  }, [activeGuide, activeTopic, goToStep])

  const exitGuide = useCallback(() => setActiveGuide(null), [])

  const value = useMemo(() => ({
    activeGuide,
    activeTopic,
    activeStep,
    canAdvance,
    startGuide,
    nextStep,
    previousStep,
    exitGuide,
  }), [activeGuide, activeTopic, activeStep, canAdvance, startGuide, nextStep, previousStep, exitGuide])

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>
}

export function useHelp() {
  const context = useContext(HelpContext)
  if (!context) throw new Error('useHelp must be used within HelpProvider')
  return context
}
