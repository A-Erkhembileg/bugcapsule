import { ArrowRight, Bug, CheckCheck, ShieldCheck } from 'lucide-react';

export function EmptyWorkspace() {
  return (
    <>
      <section className="empty-state">
        <div className="empty-illustration">
          <div className="empty-file">
            <Bug size={24} />
            <span />
            <span />
            <span />
          </div>
          <div className="empty-check">
            <CheckCheck size={19} />
          </div>
        </div>
        <span className="eyebrow">FROM “IT BROKE” TO “HERE’S HOW”</span>
        <h2>A better bug report starts here.</h2>
        <p>
          Keep the evidence together, add the steps that matter,
          <br className="desktop-break" /> and give the next developer a clear
          place to start.
        </p>
        <div className="steps-strip">
          <span>
            <i>1</i>Capture the issue
          </span>
          <ArrowRight size={14} />
          <span>
            <i>2</i>Review & redact
          </span>
          <ArrowRight size={14} />
          <span>
            <i>3</i>Export locally
          </span>
        </div>
        <p className="empty-footnote">
          <ShieldCheck size={14} />
          Keep reports local, or explicitly approve an optional AI diagnostic.
        </p>
      </section>
    </>
  );
}
