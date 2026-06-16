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
      const lines = [
        `found=yes  display=${cs.display}  vis=${cs.visibility}  opacity=${cs.opacity}`,
        `pos=${cs.position}  z=${cs.zIndex}  transform=${cs.transform}`,
        `clip=${cs.clip} clipPath=${cs.clipPath} overflow(html/body)=${getComputedStyle(document.documentElement).overflow}/${getComputedStyle(document.body).overflow}`,
        `rect: left=${Math.round(r.left)} top=${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        `layoutVP=${innerWidth}x${innerHeight}  dpr=${window.devicePixelRatio}`,
        `visualVP=${vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) + ' offTop=' + Math.round(vv.offsetTop) : 'n/a'}`,
        `belowFold=${r.top > innerHeight ? 'YES' : 'no'}  offRight=${r.left > innerWidth ? 'YES' : 'no'}  hitTest=${hit}`,
        `bg=${cs.backgroundColor}  border=${cs.borderTopWidth} ${cs.borderTopColor}`,
        `UA=${navigator.userAgent.slice(0, 80)}`
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
