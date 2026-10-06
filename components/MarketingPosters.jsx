import { CAMPAIGNS } from '../lib/marketing-assets';

// Every poster we have made, still and animated, with downloads. A server
// component with no state: the videos load nothing until someone presses play
// (preload="none", with the still as the poster frame), so opening the section
// does not pull tens of megabytes.
function Poster({ p, ratio }) {
  return (
    <figure className="poster-card">
      <div className="poster-stills">
        <div>
          <div className="poster-label">Still</div>
          <img src={p.still} alt={`${p.title}, still`} loading="lazy" style={{ aspectRatio: ratio }} />
        </div>
        <div>
          <div className="poster-label">Animated</div>
          <video controls muted loop playsInline preload="none" poster={p.still} style={{ aspectRatio: ratio }}>
            <source src={p.video} type="video/mp4" />
          </video>
        </div>
      </div>
      <figcaption>
        <b>{p.title}</b>
        <span className="poster-dl">
          <a href={p.still} download>Still (JPG)</a>
          <a href={p.video} download>Animated (MP4)</a>
        </span>
      </figcaption>
    </figure>
  );
}

export default function MarketingPosters() {
  return (
    <div className="posters">
      {CAMPAIGNS.map((c) => (
        <div key={c.id}>
          <h3 style={{ margin: '4px 0' }}>{c.title}</h3>
          <p className="hint" style={{ marginTop: 0 }}>{c.note}</p>
          {c.formats.map((f) => (
            <div key={f.id} style={{ marginBottom: 22 }}>
              <h4 className="poster-h">{f.title} <span>{f.size}</span></h4>
              <p className="hint" style={{ margin: '0 0 8px' }}>{f.note}</p>
              <div className={'poster-grid poster-grid-' + f.id}>
                {f.posters.map((p) => <Poster key={p.id} p={p} ratio={f.id === 'feed' ? '4 / 5' : '9 / 16'} />)}
              </div>
            </div>
          ))}
          {c.ads?.length > 0 && (
            <div>
              <h4 className="poster-h">Ads</h4>
              <div className="poster-grid poster-grid-ad">
                {c.ads.map((a) => (
                  <figure className="poster-card" key={a.id}>
                    <video controls playsInline preload="none" poster={a.poster} style={{ aspectRatio: '16 / 9' }}>
                      <source src={a.video} type="video/mp4" />
                    </video>
                    <figcaption>
                      <b>{a.title}</b>
                      <span className="hint" style={{ display: 'block' }}>{a.note}</span>
                      <span className="poster-dl"><a href={a.video} download>Video (MP4)</a></span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
