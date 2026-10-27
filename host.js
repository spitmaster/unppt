// packages/player/src/host.ts
var UnpptFrame = class {
  /** targetOrigin：播放器页面所在的源，默认 '*'；生产环境建议填写具体域名 */
  constructor(frame, targetOrigin = "*") {
    this.frame = frame;
    this.targetOrigin = targetOrigin;
    this.seq = 0;
    this.waiting = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Map();
    let resolveReady;
    this.ready = new Promise((r) => {
      resolveReady = r;
    });
    this.onMessage = (e) => {
      var _a, _b;
      if (e.source !== frame.contentWindow) return;
      const d = e.data;
      if (!d || d.unppt !== 1) return;
      if ("re" in d) {
        const w = this.waiting.get(Number(d.re));
        if (!w) return;
        this.waiting.delete(Number(d.re));
        if (d.ok && d.result) w.ok(d.result);
        else w.fail(new Error((_a = d.error) != null ? _a : "\u6307\u4EE4\u5931\u8D25"));
        return;
      }
      if (d.event === "ready") resolveReady(d.data);
      for (const fn of (_b = this.listeners.get(d.event)) != null ? _b : []) fn(d.data);
    };
    window.addEventListener("message", this.onMessage);
    frame.addEventListener("load", () => {
      this.send("getState").then(resolveReady, () => {
      });
    });
  }
  send(cmd, args) {
    const id = ++this.seq;
    return new Promise((ok, fail) => {
      var _a;
      this.waiting.set(id, { ok, fail });
      (_a = this.frame.contentWindow) == null ? void 0 : _a.postMessage({ unppt: 1, id, cmd, args }, this.targetOrigin);
      setTimeout(() => {
        if (this.waiting.delete(id)) fail(new Error("\u64AD\u653E\u5668\u6CA1\u6709\u54CD\u5E94"));
      }, 1e4);
    });
  }
  next() {
    return this.send("next");
  }
  prev() {
    return this.send("prev");
  }
  goto(slide, step = 0) {
    return this.send("goto", { slide, step });
  }
  getState() {
    return this.send("getState");
  }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, /* @__PURE__ */ new Set());
    this.listeners.get(event).add(fn);
    return () => {
      var _a;
      return (_a = this.listeners.get(event)) == null ? void 0 : _a.delete(fn);
    };
  }
  destroy() {
    window.removeEventListener("message", this.onMessage);
    for (const w of this.waiting.values()) w.fail(new Error("\u5DF2\u9500\u6BC1"));
    this.waiting.clear();
  }
};
export {
  UnpptFrame
};
