// Shared look for the client delivery portal. Server component, no JS.
export default function ClientPortalStyle() {
  return (
    <style>{`
      .cp { max-width: 980px; margin: 0 auto; padding: 8px 0 40px; }
      .cp-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap;
                 border-bottom:2px solid var(--charcoal); padding-bottom:12px; margin-bottom:18px; }
      .cp-brand { font-size:22px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:var(--charcoal); }
      .cp-sub { font-size:12.5px; color:var(--muted); }
      .cp h1 { margin:0 0 4px; font-size:24px; color:var(--charcoal); }
      .cp-tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin:14px 0 18px; }
      .cp-tile { border:1px solid var(--line, #ddd); border-radius:10px; padding:12px 14px; background:var(--card, #fff); }
      .cp-tile b { display:block; font-size:24px; line-height:1.1; color:var(--charcoal); }
      .cp-tile span { font-size:12px; color:var(--muted); }
      .cp-filter { display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin-bottom:14px; }
      .cp-filter label { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); display:block; }
      .cp-filter input, .cp-filter select { padding:8px 10px; border:1px solid var(--line, #ccc); border-radius:8px; font-size:14px; background:var(--card, #fff); color:inherit; }
      .cp-filter input[type=search] { min-width: 200px; }
      .cp-card { display:block; border:1px solid var(--line, #ddd); border-radius:12px; padding:14px 16px; margin-bottom:10px;
                 background:var(--card, #fff); color:inherit; text-decoration:none; }
      .cp-card:hover { border-color: var(--charcoal); }
      .cp-row { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start; }
      .cp-name { font-weight:700; font-size:16px; color:var(--charcoal); }
      .cp-addr { font-size:13.5px; color:var(--muted); margin-top:2px; }
      .cp-meta { display:flex; gap:14px; flex-wrap:wrap; margin-top:10px; font-size:13px; }
      .cp-meta span b { color:var(--charcoal); }
      .cp-pill { display:inline-block; font-size:12px; font-weight:700; padding:3px 10px; border-radius:999px; border:1px solid currentColor; white-space:nowrap; }
      .cp-pill.done { color:#157347; } .cp-pill.failed { color:#b02a37; } .cp-pill.cancelled { color:#6c757d; }
      .cp-pill.live { color:#0a58ca; } .cp-pill.todo { color:#8a6d00; }
      .cp-tag { font-size:11px; padding:2px 8px; border-radius:6px; background:rgba(127,127,127,.15); margin-right:4px; }
      .cp-panel { border:1px solid var(--line, #ddd); border-radius:12px; padding:16px 18px; margin-bottom:14px; background:var(--card, #fff); }
      .cp-panel h2 { margin:0 0 10px; font-size:15px; text-transform:uppercase; letter-spacing:.05em; color:var(--charcoal); }
      .cp-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px 20px; }
      .cp-k { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
      .cp-v { font-size:15px; font-weight:600; color:var(--charcoal); }
      .cp-time { display:flex; gap:0; flex-wrap:wrap; }
      .cp-step { flex:1 1 140px; padding:10px 12px; border-left:3px solid var(--line, #ccc); }
      .cp-step.on { border-left-color:#157347; }
      .cp-step b { display:block; font-size:18px; color:var(--charcoal); }
      .cp-shots { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:10px; }
      .cp-shots a { display:block; position:relative; }
      .cp-shots img { width:100%; aspect-ratio:1/1; object-fit:cover; border:1px solid var(--line, #bbb); border-radius:8px; display:block; }
      .cp table { width:100%; border-collapse:collapse; font-size:14px; }
      .cp th, .cp td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line, #e5e5e5); vertical-align:top; }
      .cp th { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
      .cp-sig { border:1px solid var(--line, #bbb); border-radius:8px; background:#fff; padding:6px; display:inline-block; }
      .cp-sig img { max-height:110px; max-width:100%; display:block; }
      .cp-empty { text-align:center; padding:36px 12px; color:var(--muted); }
      .cp-form label { display:block; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
      .cp-form input:not([type=checkbox]), .cp-form textarea { display:block; width:100%; margin-top:3px; padding:8px 10px; border:1px solid var(--line, #ccc); border-radius:8px; font-size:14px; text-transform:none; letter-spacing:0; color:inherit; background:var(--card, #fff); }
      .cp-h2 { font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:var(--charcoal); margin:20px 0 8px; }
      .cp-back { display:inline-block; margin-bottom:12px; font-size:14px; }
      @media print {
        .cp-noprint { display:none !important; }
        .wrap { max-width:none !important; padding:0 !important; }
        .cp-panel { break-inside: avoid; }
        .cp-shots img { break-inside: avoid; }
      }
    `}</style>
  );
}
