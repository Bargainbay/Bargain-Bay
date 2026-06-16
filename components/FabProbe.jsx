'use client';
// TEMPORARY DIAGNOSTIC — hidden unless the URL has ?probe (e.g. /?probe=1), so
// regular visitors never see it. Reports what THIS device's browser thinks the
// chat FAB's box/visibility are, in a yellow readout bar at the top of the page.
// Remove once the mobile chat-bubble issue is diagnosed.
import { useEffect, useState } from 'react';

export default function FabProbe() {
  const [info, setInfo] = useState(null); // null = render nothing

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('probe')) return; // gated
    const run = () => {
      const el = document.querySelector('.bb-chat-fab');
      if (!el) {
        setInfo('FAB NOT FOUND in DOM');
        return;
      }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const hitEl = document.elementFromPoint(cx, cy);
      const hit = hitEl
        ? (hitEl === el || el.contains(hitEl) ? 'FAB(self)' : (hitEl.className || hitEl.tagName) + ' [COVERS]')
        : 'null/offscreen';
      const vv = window.visualViewport;
      const visW = vv ? Math.round(vv.width) : innerWidth;
      const visH = vv ? Math.round(vv.height) : innerHeight;
      const docSW = document.documentElement.scrollWidth;
      // find what (if anything) extends past the visible width
      const offenders = [];
      document.querySelectorAll('body *').forEach((el) => {
        const er = el.getBoundingClientRect();
        if (er.right > visW + 1) {
          const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
          offenders.push(el.tagName.toLowerCase() + cls + '=' + Math.round(er.right));
        }
      });
      offenders.sort((a, b) => parseInt(b.split('=')[1]) - parseInt(a.split('=')[1]));
      const lines = [
        `found=yes display=${cs.display} vis=${cs.visibility} op=${cs.opacity} hit=${hit}`,
        `FAB rect: left=${Math.round(r.left)} top=${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        `layoutVP=${innerWidth}x${innerHeight}  visualVP=${visW}x${visH}  dpr=${window.devicePixelRatio}`,
        `FAB offVisibleRight=${r.left > visW ? 'YES ⚠️' : 'no ✓'}  offVisibleBottom=${r.top > visH ? 'YES ⚠️' : 'no ✓'}`,
        `docScrollW=${docSW}  overflowX=${docSW > visW + 1 ? 'YES ⚠️' : 'no ✓'}  offenders=${offenders.length}`,
        `widest: ${offenders.slice(0, 4).join('  ') || '(none ✓)'}`,
        `UA=${navigator.userAgent.slice(0, 70)}`
      ];
      setInfo(lines.join('\n'));
    };
    const t = setTimeout(run, 900);
    return () => clearTimeout(t);
  }, []);

  if (info === null) return null;

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2147483647,
        background: '#ffea00', color: '#000',
        font: '12px/1.45 ui-monospace, Menlo, Consolas, monospace',
        padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        borderBottom: '3px solid #000'
      }}
    >
      <b>CHAT BUBBLE PROBE</b>{'\n'}{info}
    </div>
  );
}
