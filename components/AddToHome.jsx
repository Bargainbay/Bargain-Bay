'use client';
import { useEffect, useRef, useState } from 'react';

// "Tap Share → Add to Home Screen" is the iPhone-Safari answer to a question
// four different phones answer four different ways, and a driver who can't find
// the button we named concludes the app is broken:
//
//   Android Chrome   — no Share step at all; it's ⋮ → Install app, and Chrome
//                      will hand us a real install prompt if we ask for it.
//   iPhone Safari    — Share is in the BOTTOM bar, and it hides while the page
//                      scrolls, which is most of the time on a stop list.
//   In-app browser   — WhatsApp/Facebook/Instagram open links in their own
//                      browser, which cannot install anything. The only way
//                      out is to reopen the page in the real browser.
//   Already installed— say nothing at all.
//
// So this asks the phone which of those it is instead of guessing.
const DISMISSED = 'rs-driver-a2hs-dismissed';

export default function AddToHome({ welcome = false }) {
  const [mode, setMode] = useState('hidden');
  const [copied, setCopied] = useState(false);
  const prompt = useRef(null);

  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
    if (standalone) return;                                   // already an app
    if (!welcome && localStorage.getItem(DISMISSED) === '1') return;

    const ua = navigator.userAgent || '';
    const iOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    // Chrome, Firefox and the rest on iOS are Safari underneath but expose their
    // own name; only real Safari offers Add to Home Screen.
    const iosOtherBrowser = iOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    const inApp = /FBAN|FBAV|Instagram|LinkedInApp|Line\/|MicroMessenger|Snapchat|Twitter|WhatsApp/i.test(ua) ||
      iosOtherBrowser || (iOS && !/Safari/.test(ua));

    const onPrompt = (e) => {
      e.preventDefault();
      prompt.current = e;
      setMode('install');                                     // Chrome will do it for us
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    if (inApp) setMode('inapp');
    else if (iOS) setMode('ios');
    else if (/Android/.test(ua)) setMode('android');
    else setMode(welcome ? 'desktop' : 'hidden');

    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [welcome]);

  if (mode === 'hidden') return null;

  function close() {
    localStorage.setItem(DISMISSED, '1');
    setMode('hidden');
  }

  async function install() {
    const e = prompt.current;
    if (!e) return;
    e.prompt();
    const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (outcome === 'accepted') setMode('hidden');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="drv-welcome">
      <button type="button" className="drv-welcome-x" onClick={close} aria-label="Dismiss">✕</button>
      {welcome && <div><b>You&apos;re signed in.</b></div>}

      {mode === 'install' && (
        <>
          <div>Put this on your home screen and it opens like an app.</div>
          <button type="button" className="drv-btn small" onClick={install}>Add to home screen</button>
        </>
      )}

      {mode === 'android' && (
        <div>
          To keep this a tap away: open the <b>⋮ menu</b> (top right of Chrome) and choose
          {' '}<b>Add to Home screen</b>.
        </div>
      )}

      {mode === 'ios' && (
        <div>
          To keep this a tap away: tap the <b>Share</b> button — the square with an arrow, in the bar
          at the <b>bottom</b> of the screen — then <b>Add to Home Screen</b>.
          <div className="hint" style={{ margin: '4px 0 0' }}>
            No bar at the bottom? Tap once near the bottom edge and it slides back up.
          </div>
        </div>
      )}

      {mode === 'inapp' && (
        <div>
          You&apos;re in an app&apos;s built-in browser, which can&apos;t save to the home screen.
          Open this page in <b>Safari</b> (or Chrome on Android) first — there&apos;s usually an
          &ldquo;Open in browser&rdquo; button in the corner.
          <button type="button" className="drv-btn small" onClick={copy}>
            {copied ? 'Link copied' : 'Copy this link'}
          </button>
        </div>
      )}

      {mode === 'desktop' && (
        <div>Signed in. On a phone you can also add this to the home screen and it opens like an app.</div>
      )}
    </div>
  );
}
