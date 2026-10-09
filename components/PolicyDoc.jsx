import { AUDIENCE } from '../lib/marketplace-policies';
import DocBody from './DocBody';

// Renders one policy document. Server component; the sections are drawn by DocBody.
export default function PolicyDoc({ policy }) {
  const draft = policy.status !== 'published';
  return (
    <div className="prose">
      {draft && (
        <div className="panel" style={{ background: 'var(--warnbg)', color: 'var(--warn)', maxWidth: 760 }}>
          <b>DRAFT — not in force.</b> This document is waiting for review and has not been published. It does not bind anyone yet.
        </div>
      )}
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 4px' }}>{AUDIENCE[policy.audience]} · Version {policy.version}</p>
      <h1 style={{ marginTop: 0 }}>{policy.title}</h1>
      <DocBody sections={policy.sections()} />
    </div>
  );
}
