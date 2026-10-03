import fs from 'node:fs';

const path = new URL('../styles.css', import.meta.url);
let css = fs.readFileSync(path, 'utf8');

const replacements = [
  [
    '.streak-bubble{min-width:92px;background:#fff;border:1px solid #eee7f7;border-radius:23px;padding:12px 15px;display:grid;grid-template-columns:auto auto;gap:0 6px;box-shadow:var(--shadow);align-items:center}.streak-bubble span{font-size:24px;grid-row:1/3}.streak-bubble b{font-size:20px}.streak-bubble small{color:var(--muted);font-size:10px}',
    '.streak-bubble{min-width:92px;background:#fff;border:1px solid #eee7f7;border-radius:23px;padding:12px 14px;display:flex;align-items:center;gap:10px;box-shadow:var(--shadow)}.streak-bubble span{font-size:24px;line-height:1;flex:0 0 auto}.streak-meta{display:flex;flex-direction:column;gap:2px;min-width:0}.streak-bubble b{font-size:20px;line-height:1.05}.streak-bubble small{color:var(--muted);font-size:10px;line-height:1.2;white-space:normal}'
  ],
  [
    '.notification-nudge{background:#242036;color:white;border-radius:19px;padding:14px 16px;margin:-9px 0 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;box-shadow:0 12px 28px #302b4b25}.notification-nudge>div{display:flex;gap:11px;align-items:center}.notification-nudge small{display:block;color:#bbb4d4;margin-top:2px}',
    '.notification-nudge{background:#242036;color:white;border-radius:19px;padding:14px 16px;margin:-9px 0 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;box-shadow:0 12px 28px #302b4b25}.nudge-main{display:flex;gap:11px;align-items:flex-start;min-width:0;flex:1}.nudge-copy{min-width:0}.nudge-copy b{display:block;font-size:14px;line-height:1.3}.notification-nudge small{display:block;color:#bbb4d4;margin-top:4px;line-height:1.35}'
  ],
  [
    '.timeline{position:relative;padding-left:28px}.timeline:before{content:"";position:absolute;left:9px;top:10px;bottom:20px;width:2px;background:#ddd4ef}.timeline-item{position:relative;margin-bottom:16px}.timeline-dot{position:absolute;left:-25px;top:24px;width:12px;height:12px;border-radius:50%;background:#8d6cea;border:3px solid #f8f5ff;box-shadow:0 0 0 2px #bba9ef}',
    '.timeline{position:relative;padding-left:0}.timeline:before{content:"";position:absolute;left:11px;top:10px;bottom:20px;width:2px;background:#ddd4ef}.timeline-item{position:relative;margin-bottom:16px;display:grid;grid-template-columns:24px 1fr;gap:12px;align-items:start}.timeline-rail{position:relative;display:flex;justify-content:center;padding-top:26px}.timeline-dot{position:relative;left:auto;top:auto;width:12px;height:12px;border-radius:50%;background:#8d6cea;border:3px solid #f8f5ff;box-shadow:0 0 0 2px #bba9ef;flex:0 0 auto}'
  ],
  [
    '.pack-card{border-radius:23px;padding:18px;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:start}.pack-card.locked{opacity:.72}.pack-icon{font-size:30px}.pack-card h3{margin:4px 0}.pack-card p{color:var(--muted);font-size:12px;line-height:1.45}.pack-card small{color:var(--violet);font-weight:800}',
    '.pack-card{border-radius:23px;padding:18px;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:start}.pack-card.locked{opacity:.72}.pack-icon{font-size:30px;line-height:1;margin-top:2px}.pack-copy{min-width:0}.pack-card h3{margin:4px 0;text-align:left}.pack-card p{color:var(--muted);font-size:12px;line-height:1.45;text-align:left;margin:0}.pack-card small{color:var(--violet);font-weight:800;display:block;text-align:left}'
  ]
];

for (const [from, to] of replacements) {
  if (!css.includes(from)) {
    console.error('MISSING pattern starting with:', from.slice(0, 60));
    process.exit(1);
  }
  css = css.replace(from, to);
}

const extras = `
/* ---- visual polish overrides ---- */
.history-date{display:inline-flex;align-items:center;min-height:22px;line-height:1.2}
.garden-hint{margin:14px 4px 0;max-width:520px}
.notification-nudge .ghost{flex:0 0 auto;white-space:nowrap;align-self:center}
.nudge-icon{font-size:24px;line-height:1;flex:0 0 auto;margin-top:1px}
.stat-card small{line-height:1.25}
@media(max-width:720px){
  .notification-nudge{flex-direction:column;align-items:stretch}
  .notification-nudge .ghost{width:100%}
  .nudge-main{align-items:flex-start}
  .today-fit.main-content,.main-content.today-fit{padding:8px 15px 18px}
  .today-fit .dashboard-head{margin:2px 0 12px;gap:12px}
  .today-fit .dashboard-head h1{font-size:28px;margin:4px 0 6px}
  .today-fit .today-lead{display:none}
  .app-shell:has(.today-fit) .topbar{height:58px;padding:10px 16px}
  .today-fit .question-card,.today-fit .waiting-card{padding:18px 16px;border-radius:24px}
  .today-fit .question-card h2,.today-fit .waiting-card h2{font-size:22px;margin:12px 0 8px}
  .today-fit .question-note{margin-bottom:12px}
  .today-fit .question-card textarea{min-height:112px}
  .today-fit .textarea-footer{padding:6px 4px 12px}
  .today-fit .notification-nudge{margin:0 0 12px;padding:12px 14px}
  .today-fit .streak-bubble{padding:10px 12px;min-width:84px}
  .app-shell:has(.today-fit){padding-bottom:calc(88px + var(--safe-bottom))}
}
`;

if (!css.includes('visual polish overrides')) css += extras;
fs.writeFileSync(path, css);
console.log('css patched ok');
