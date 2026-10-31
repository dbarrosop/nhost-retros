import { Link } from "@tanstack/react-router";

const steps = [
  {
    number: "01",
    title: "Start with reflection",
    description: "Take a breath. Think about the moments that made a difference, big or small.",
  },
  {
    number: "02",
    title: "Make room for honesty",
    description:
      "Good conversations need different perspectives. Bring yours with curiosity and care.",
  },
  {
    number: "03",
    title: "Find the threads",
    description:
      "Look for patterns together. Understand what’s helping the team and what could change.",
  },
];

export function Welcome() {
  return (
    <main id="main-content" tabIndex={-1}>
      <section className="welcome-hero" aria-labelledby="welcome-title">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="eyebrow-line" />
            Pause. Reflect. Reconnect.
          </p>
          <h1 id="welcome-title">
            Make space for <em>better work.</em>
          </h1>
          <p className="hero-description">
            A thoughtful retrospective starts with a little room to think. Look back with your team,
            find the patterns, and make the next chapter a little better.
          </p>
          <Link className="primary-link" to="/auth">
            Join the conversation <span aria-hidden="true">↗</span>
          </Link>
          <p className="preview-note">Verify your email. A one-time code is all you need.</p>
          <a className="quiet-link" href="#how-it-works">
            What to expect <span aria-hidden="true">↓</span>
          </a>
        </div>
        <aside className="reflection-space" aria-labelledby="prompts-title">
          <div className="reflection-heading">
            <span className="small-label" id="prompts-title">
              A few reflection prompts
            </span>
            <svg viewBox="0 0 40 40" aria-hidden="true" className="spark">
              <path d="M20 4v32M4 20h32M9 9l22 22M9 31L31 9" />
            </svg>
          </div>
          <div className="prompt-card prompt-sage">
            <span className="prompt-label">The good stuff</span>
            <p>
              What gave you <br />
              energy this time?
            </p>
            <span className="prompt-footnote">Keep a little of that.</span>
            <span className="card-corner" aria-hidden="true">
              ✳
            </span>
          </div>
          <div className="prompt-card prompt-peach">
            <span className="prompt-label">Room to grow</span>
            <p>
              What would make <br />
              next time better?
            </p>
            <span className="prompt-footnote">Small changes count, too.</span>
            <span className="card-corner" aria-hidden="true">
              ✳
            </span>
          </div>
          <p className="reflection-caption">
            <span aria-hidden="true">↳</span> A fresh perspective starts with a question.
          </p>
        </aside>
      </section>
      <section
        className="approach"
        id="how-it-works"
        aria-labelledby="approach-title"
        tabIndex={-1}
      >
        <div className="approach-heading">
          <p className="eyebrow">The approach</p>
          <h2 id="approach-title">
            Less ceremony. <br />
            More understanding.
          </h2>
          <p>Not a scorecard. Not a status update. A chance to listen and learn from each other.</p>
        </div>
        <ol className="approach-steps">
          {steps.map((step) => (
            <li key={step.number}>
              <span className="step-number" aria-hidden="true">
                {step.number}
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
