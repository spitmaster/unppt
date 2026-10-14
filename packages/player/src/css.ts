/** 播放器的样式（只注入一次） */
const CSS = `
.unppt-root{position:relative;width:100%;height:100%;overflow:hidden;background:#000;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;touch-action:pan-y pinch-zoom}
.unppt-stage{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden;background:#fff}
.unppt-slide{position:absolute;left:0;top:0;width:100%;height:100%}
.unppt-slide>svg{display:block;width:100%;height:100%}
.unppt-blank{position:absolute;left:0;top:0;width:100%;height:100%;display:none;z-index:6}
.unppt-blank.unppt-show{display:block}
.unppt-full{position:absolute;left:0;top:0;width:100%;height:100%;background:#000;object-fit:contain;z-index:5}
.unppt-slide [data-uid],.unppt-slide .unppt-unit{transform-box:fill-box;transform-origin:center}
.unppt-hide{visibility:hidden}
.unppt-trigger{cursor:pointer}
.unppt-ui{position:absolute;right:12px;bottom:12px;display:flex;gap:6px;align-items:center;opacity:0;transition:opacity .3s;font:13px/1 system-ui,sans-serif;z-index:2}
.unppt-root:hover .unppt-ui,.unppt-ui.unppt-show{opacity:1}
.unppt-mbar{position:absolute;display:none;align-items:center;gap:8px;height:30px;padding:0 10px;box-sizing:border-box;background:rgba(0,0,0,.65);border-radius:4px;color:#fff;font:12px/1 system-ui,sans-serif;z-index:3}
.unppt-mbar.unppt-show{display:flex}
.unppt-mbar button{border:0;background:none;color:#fff;font-size:13px;width:22px;height:22px;padding:0;cursor:pointer;flex:none}
.unppt-mbar input{flex:1;min-width:40px;margin:0;accent-color:#fff;cursor:pointer}
.unppt-mbar span{flex:none;font-variant-numeric:tabular-nums}
.unppt-ui button{border:0;border-radius:4px;background:rgba(0,0,0,.55);color:#fff;width:34px;height:30px;font-size:16px;cursor:pointer}
.unppt-ui span{background:rgba(0,0,0,.55);color:#fff;border-radius:4px;padding:8px 10px}
.unppt-error{color:#fff;font:15px system-ui,sans-serif;padding:24px}
.unppt-stage>.unppt-error{position:absolute;left:0;top:0;color:#c00;z-index:8}
.unppt-root.unppt-loading::after{content:'加载中…';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;background:rgba(0,0,0,.55);padding:8px 14px;border-radius:4px;font:14px system-ui,sans-serif;z-index:7}
`;

export function injectCss(doc: Document) {
  if (doc.getElementById('unppt-css')) return;
  const s = doc.createElement('style');
  s.id = 'unppt-css';
  s.textContent = CSS;
  doc.head.appendChild(s);
}
