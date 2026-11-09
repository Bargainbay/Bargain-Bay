// Remembrance hero art: a single drawn poppy. Plain SVG, no photograph, nothing to load.
export default function PoppyArt() {
  return (
    <svg className="poppy-art" viewBox="0 0 240 280" role="img" aria-label="A red remembrance poppy">
      <path d="M120 150 C118 200 126 240 120 276" fill="none" stroke="#3d5a2e" strokeWidth="5" strokeLinecap="round" />
      <path d="M121 220 C150 205 170 208 186 222 C165 232 140 232 121 220Z" fill="#3d5a2e" />
      <g transform="translate(120 100)">
        <ellipse cx="-38" cy="-8" rx="46" ry="52" fill="#c8102e" />
        <ellipse cx="38" cy="-8" rx="46" ry="52" fill="#d4152f" />
        <ellipse cx="0" cy="-34" rx="48" ry="44" fill="#b50d27" />
        <ellipse cx="0" cy="26" rx="52" ry="40" fill="#c8102e" />
        <circle cx="0" cy="0" r="17" fill="#141414" />
        <g stroke="#141414" strokeWidth="2.2" strokeLinecap="round">
          <line x1="0" y1="-17" x2="0" y2="-30" />
          <line x1="12" y1="-12" x2="21" y2="-22" />
          <line x1="17" y1="0" x2="30" y2="0" />
          <line x1="12" y1="12" x2="21" y2="22" />
          <line x1="0" y1="17" x2="0" y2="30" />
          <line x1="-12" y1="12" x2="-21" y2="22" />
          <line x1="-17" y1="0" x2="-30" y2="0" />
          <line x1="-12" y1="-12" x2="-21" y2="-22" />
        </g>
      </g>
    </svg>
  );
}
