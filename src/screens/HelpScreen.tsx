import { HELP_TOPICS } from '../help/helpContent'
import { useHelp } from '../help/HelpProvider'
import './HelpScreen.css'

export default function HelpScreen() {
  const { startGuide } = useHelp()

  return (
    <main className="help-screen">
      <header className="help-hero">
        <p className="help-eyebrow">Interactive help</p>
        <h1>How can Singularity help?</h1>
        <p>Choose a topic to open a step-by-step guide. Guides can take you to the right screen and highlight controls, but never enter credentials or make changes for you.</p>
      </header>
      <section className="help-topic-grid" aria-label="Help topics">
        {HELP_TOPICS.map((topic) => (
          <article key={topic.id} className="help-topic-card">
            <h2>{topic.title}</h2>
            <p>{topic.description}</p>
            <button onClick={() => startGuide(topic.id)} data-help="help-topic-card">Start guide</button>
          </article>
        ))}
      </section>
    </main>
  )
}
