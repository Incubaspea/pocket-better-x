/*
 * POCKET BETTER X — emu.js
 * ตัวห่อแกนจำลอง IodineGBA (ทำงานบน main thread เท่านั้น เพราะ iOS 12 ไม่มี SharedArrayBuffer)
 * เขียนให้ผ่าน ES2018 และใช้ได้บน Safari 12.1
 *
 * ต้องโหลดหลังสคริปต์ของแกนทั้งหมด (ตาม LOAD-ORDER) + GfxGlueCode + XAudioJS + AudioGlueCode
 */
(function (global) {
  "use strict";

  // XAudioJS เช็กเฉพาะ AudioContext แบบไม่มี prefix → Safari 12 มีแค่ webkitAudioContext
  if (typeof global.AudioContext === "undefined" && typeof global.webkitAudioContext !== "undefined") {
    global.AudioContext = global.webkitAudioContext;
  }

  // ปุ่ม = บิตของ KEYINPUT (ตรวจกับ core/JoyPad.js แล้ว)
  var KEY = { A: 0, B: 1, SELECT: 2, START: 3, RIGHT: 4, LEFT: 5, UP: 6, DOWN: 7, R: 8, L: 9 };

  var TICK_MS = 16; // ตรงกับ timerIntervalRate ของแกน

  // ตารางแปลงสี 15 บิตของ GBA → RGBA 32 บิต (little-endian: ABGR) ใช้วาดภาพรอบเดียว
  var LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  var RGBA_LUT = null;
  function rgbaLut() {
    if (!RGBA_LUT) {
      RGBA_LUT = new Uint32Array(0x8000);
      for (var c = 0; c < 0x8000; c++) {
        var r = (c & 0x1F) << 3;
        var g = ((c >> 5) & 0x1F) << 3;
        var b = ((c >> 10) & 0x1F) << 3;
        RGBA_LUT[c] = (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
      }
    }
    return RGBA_LUT;
  }

  // =========================================================
  // Save State (ทดลอง): serialize กราฟออบเจกต์ของ I.IOCore
  //  - id ของออบเจกต์/typed array = path ที่เจอครั้งแรกจากการไล่แบบ BFS เริ่มที่ "IOCore"
  //  - เก็บ: ตัวเลข/boolean/string/null, การอ้างถึงออบเจกต์อื่น (เป็น id),
  //          ฟังก์ชันที่สลับตอนรัน (เก็บเป็นชื่อเมธอดบน prototype), เนื้อหา ArrayBuffer (ครั้งเดียวต่อ buffer)
  //  - ข้าม: coreExposed (ของภายนอก), ROM/BIOS และตาราง LSFR (ค่าคงที่ ใหญ่)
  //  - ธง NZCV ของ CPU อยู่ใน closure → ใช้ getNZCV/setNZCV
  // =========================================================
  var STATE_VER = 1;
  var SKIP_KEYS = { coreExposed: 1 };
  var CONST_BUF_KEY = /^(ROM|BIOS)(16|32)?$|LSFR/;

  function isTA(v) { return ArrayBuffer.isView(v); }

  // ไล่กราฟ: คืน {objs:[[obj,id]], ids:Map(obj→id), tas:Map(ta→id), skipBufs:Set}
  function walkGraph(root) {
    var ids = new Map();
    var tas = new Map();
    var skipBufs = new Set();
    var objs = [];
    var queue = [root];
    var paths = ["IOCore"];
    ids.set(root, "IOCore");
    for (var qi = 0; qi < queue.length; qi++) {
      var o = queue[qi];
      var p = paths[qi];
      objs.push([o, p]);
      var keys = Object.keys(o);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (SKIP_KEYS[k]) continue;
        var v = o[k];
        if (!v || typeof v !== "object") continue;
        if (isTA(v)) {
          if (!tas.has(v)) tas.set(v, p + "." + k);
          if (CONST_BUF_KEY.test(k)) skipBufs.add(v.buffer);
          continue;
        }
        if (v instanceof ArrayBuffer || ids.has(v)) continue;
        if (typeof Node !== "undefined" && v instanceof Node) continue;
        ids.set(v, p + "." + k);
        queue.push(v);
        paths.push(p + "." + k);
      }
    }
    // ROM ที่อยู่ใน IOCore.ROM (ส่งมาจากภายนอก) ก็ข้าม
    if (root.ROM && root.ROM.buffer) skipBufs.add(root.ROM.buffer);
    return { objs: objs, ids: ids, tas: tas, skipBufs: skipBufs };
  }

  function protoFnName(o, f) {
    var proto = Object.getPrototypeOf(o);
    while (proto && proto !== Object.prototype) {
      var names = Object.getOwnPropertyNames(proto);
      for (var i = 0; i < names.length; i++) {
        if (names[i] === "constructor") continue;
        var d = Object.getOwnPropertyDescriptor(proto, names[i]);
        if (d && d.value === f) return names[i];
      }
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  }

  function ctorName(o) {
    return Array.isArray(o) ? "Array" : (o.constructor && o.constructor.name) || "Object";
  }

  // reuse = สถานะเก่าที่จะนำ Uint8Array กลับมาใช้ (ลดขยะหน่วยความจำตอนเก็บย้อนเวลา)
  function serializeCore(root, reuse) {
    var g = walkGraph(root);
    var objs = [];
    for (var n = 0; n < g.objs.length; n++) {
      var o = g.objs[n][0];
      var entry = { id: g.objs[n][1], c: ctorName(o), p: {} };
      if (Array.isArray(o)) entry.len = o.length;
      var keys = Object.keys(o);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (SKIP_KEYS[k]) continue;
        var v = o[k];
        var t = typeof v;
        if (v === null || t === "number" || t === "boolean" || t === "string") {
          entry.p[k] = v;
        } else if (t === "object") {
          if (isTA(v)) entry.p[k] = { t: g.tas.get(v) };
          else if (g.ids.has(v)) entry.p[k] = { r: g.ids.get(v) };
        } else if (t === "function") {
          var name = protoFnName(o, v);
          if (name) entry.p[k] = { f: name };
        }
      }
      if (typeof o.getNZCV === "function" && typeof o.setNZCV === "function") entry.nzcv = o.getNZCV();
      objs.push(entry);
    }
    // เนื้อหา buffer: เก็บครั้งเดียวต่อ ArrayBuffer (อ้างด้วย id ของ typed array ตัวแรกที่ใช้ buffer นั้น)
    // คำอธิบาย typed array ทุกตัว: [id, ชนิด, id ของ buffer, byteOffset, length]
    // (ใช้สร้างใหม่ตอนโหลด ถ้าแกนยังไม่มี เช่น หน่วยความจำเซฟที่แกนสร้างทีหลัง)
    var bufIdOf = new Map();
    var tav = [];
    g.tas.forEach(function (id, ta) {
      if (!bufIdOf.has(ta.buffer)) bufIdOf.set(ta.buffer, id);
      tav.push([id, ctorName(ta), bufIdOf.get(ta.buffer), ta.byteOffset, ta.length]);
    });
    var bufs = [];
    var doneBuf = new Set();
    var old = reuse && reuse.bufs;
    g.tas.forEach(function (id, ta) {
      var b = ta.buffer;
      if (doneBuf.has(b) || g.skipBufs.has(b)) return;
      doneBuf.add(b);
      var n = bufs.length;
      var copy;
      if (old && old[n] && old[n].id === id && old[n].b.length === b.byteLength) {
        copy = old[n].b;
        copy.set(new Uint8Array(b));
      } else {
        copy = new Uint8Array(b.slice(0));
      }
      bufs.push({ id: id, len: b.byteLength, b: copy });
    });
    return { v: STATE_VER, objs: objs, bufs: bufs, tav: tav };
  }

  function restoreCore(root, st) {
    if (!st || st.v !== STATE_VER) throw new Error("ไฟล์สถานะไม่รองรับ");
    var g = walkGraph(root);
    var byId = new Map();
    g.ids.forEach(function (id, o) { byId.set(id, o); });
    var taById = new Map();
    g.tas.forEach(function (id, ta) { taById.set(id, ta); });
    var i, e, live;
    var created = new Map(); // ออบเจกต์ที่ต้องสร้างใหม่ (แกนตอนนี้ยังไม่มี)

    // 1) ออบเจกต์: ต้องมีชนิดตรงกัน หรือสร้างใหม่ได้จาก constructor
    for (i = 0; i < st.objs.length; i++) {
      e = st.objs[i];
      live = byId.get(e.id);
      if (live) {
        if (ctorName(live) !== e.c) throw new Error("โครงสร้างแกนไม่ตรงกัน: " + e.id);
      } else {
        var obj;
        if (e.c === "Array") obj = [];
        else if (e.c === "Object") obj = {};
        else if (typeof global[e.c] === "function") obj = Object.create(global[e.c].prototype);
        else throw new Error("สร้าง " + e.id + " ไม่ได้");
        created.set(e.id, obj);
      }
    }
    created.forEach(function (o, id) { byId.set(id, o); });

    // 2) typed array / buffer: ใช้ของเดิมถ้าขนาดเท่ากัน ไม่งั้นสร้าง buffer ใหม่แล้วสร้าง view ตามคำอธิบาย
    var savedBuf = new Map();
    for (i = 0; i < st.bufs.length; i++) savedBuf.set(st.bufs[i].id, st.bufs[i]);
    var newBufs = new Map(); // bufId → ArrayBuffer ใหม่
    var tav = st.tav || [];
    var newTA = new Map();
    for (i = 0; i < tav.length; i++) {
      var d = tav[i]; // [id, ชนิด, bufId, off, len]
      var sb = savedBuf.get(d[2]);
      var liveFirst = taById.get(d[2]);
      var reuseLive = liveFirst && sb && liveFirst.buffer.byteLength === sb.len;
      var liveTA = taById.get(d[0]);
      if (!sb) {
        // buffer ค่าคงที่ (ROM/BIOS/LSFR) ต้องมีอยู่แล้ว
        if (!liveTA) throw new Error("ไม่พบ " + d[0]);
        continue;
      }
      if (reuseLive && liveTA && liveTA.buffer === liveFirst.buffer) continue; // ใช้ของเดิมได้
      var buf;
      if (reuseLive) buf = liveFirst.buffer;
      else {
        buf = newBufs.get(d[2]);
        if (!buf) { buf = new ArrayBuffer(sb.len); newBufs.set(d[2], buf); }
      }
      var Ctor = global[d[1]];
      if (typeof Ctor !== "function") throw new Error("ชนิดหน่วยความจำไม่รู้จัก: " + d[1]);
      newTA.set(d[0], new Ctor(buf, d[3], d[4]));
    }

    function taOf(id) { return newTA.get(id) || taById.get(id); }
    function bufTarget(sb) {
      var nb = newBufs.get(sb.id);
      if (nb) return nb;
      var t = taById.get(sb.id);
      return t && t.buffer.byteLength === sb.len ? t.buffer : null;
    }

    // 3) ตรวจการอ้างถึงทั้งหมดก่อน (ถ้าไม่ตรงกันจะไม่แตะสถานะเกมเลย)
    for (i = 0; i < st.objs.length; i++) {
      e = st.objs[i];
      live = byId.get(e.id);
      var ks = Object.keys(e.p);
      for (var j = 0; j < ks.length; j++) {
        var pv = e.p[ks[j]];
        if (pv && typeof pv === "object") {
          if (pv.r && !byId.has(pv.r)) throw new Error("ไม่พบ " + pv.r);
          if (pv.t && !taOf(pv.t)) throw new Error("ไม่พบ " + pv.t);
          if (pv.f && typeof live[pv.f] !== "function") throw new Error("ไม่พบฟังก์ชัน " + pv.f);
        }
      }
    }
    for (i = 0; i < st.bufs.length; i++) {
      if (!bufTarget(st.bufs[i])) throw new Error("ขนาดหน่วยความจำไม่ตรงกัน: " + st.bufs[i].id);
    }

    // 4) เขียนจริง
    for (i = 0; i < st.bufs.length; i++) {
      new Uint8Array(bufTarget(st.bufs[i])).set(st.bufs[i].b);
    }
    for (i = 0; i < st.objs.length; i++) {
      e = st.objs[i];
      live = byId.get(e.id);
      var keys = Object.keys(e.p);
      for (var k2 = 0; k2 < keys.length; k2++) {
        var key = keys[k2];
        var v = e.p[key];
        if (v === null || typeof v !== "object") live[key] = v;
        else if (v.r) live[key] = byId.get(v.r);
        else if (v.t) live[key] = taOf(v.t);
        else if (v.f) live[key] = live[v.f];
      }
      if (Array.isArray(live) && typeof e.len === "number") live.length = e.len;
      if (typeof e.nzcv === "number" && typeof live.setNZCV === "function") live.setNZCV(e.nzcv);
    }
  }

  class PBX {
    constructor(canvas) {
      var self = this;
      this.canvas = canvas;
      this.running = false;
      this.loaded = false;
      this.timer = 0;
      this.t0 = 0;
      this.speedCb = null;
      this.saveExportCb = null;
      this.saveImportFn = null;
      this.statusCb = null;
      this.keys = 0;            // บิตปุ่มที่กดค้างอยู่ (กันการกดซ้ำ)
      this.mixer = null;
      this.audioInput = null;
      this.audioWanted = true;  // ผู้ใช้เปิดเสียงไว้
      this.audioMuted = false;  // ปิดชั่วคราว (เช่น ตอนเร่งความเร็ว)
      this.audioOn = false;     // ต่อเสียงเข้าแกนอยู่จริงหรือไม่
      this.frameSkip = 0;
      this.frameCount = 0;
      this.skipThis = false;

      var I = new GameBoyAdvanceEmulator();
      I.toggleOffthreadGraphics(false);
      I.attachPlayStatusHandler(function (on) {
        if (self.statusCb) self.statusCb(!!on);
      });
      I.attachSpeedHandler(function (pct) {
        if (self.speedCb) self.speedCb(pct);
      });
      I.attachSaveExportHandler(function (name, data) {
        if (self.saveExportCb) self.saveExportCb(name, data);
      });
      I.attachSaveImportHandler(function (name, onLoaded, onFail) {
        if (self.saveImportFn) {
          try { self.saveImportFn(name, onLoaded, onFail); } catch (e) { onFail(); }
        } else {
          onFail();
        }
      });
      this.gfx = new GfxGlueCode(240, 160);
      // ความเร็ว (iPhone 6): คง canvas ไว้ที่ 240x160 แล้วให้ CSS ขยายแบบ pixelated
      // → putImageData ตรง ๆ ไม่ต้อง drawImage ขยาย และไม่อ่าน clientWidth ทุกเฟรม
      this.gfx.recomputeDimension = function () {
        this.onscreenWidth = this.canvas.width = 240;
        this.onscreenHeight = this.canvas.height = 160;
        this.canvasLastWidth = this.canvasLastHeight = 0;
      };
      this.gfx.graphicsBlit = function () {
        this.drawContextOnscreen.putImageData(this.canvasBuffer, 0, 0);
      };
      this.gfx.attachCanvas(canvas);
      // ความเร็ว: แปลงสีจาก frameBuffer ของแกนลง ImageData โดยตรงรอบเดียว
      // (เดิม: แปลงเป็น RGB → คัดลอก → แปลงเป็น RGBA อีกรอบ)
      this.rgba32 = null;
      this.lut = null;
      this.frameDirty = false;
      if (LITTLE_ENDIAN && this.gfx.canvasBuffer && this.gfx.canvasBuffer.data && this.gfx.canvasBuffer.data.buffer) {
        this.rgba32 = new Uint32Array(this.gfx.canvasBuffer.data.buffer);
        this.lut = rgbaLut();
        this.gfx.requestDraw = function () {
          if (self.frameDirty && this.graphicsFound) {
            self.frameDirty = false;
            this.drawContextOnscreen.putImageData(this.canvasBuffer, 0, 0);
          }
        };
      }
      I.attachGraphicsFrameHandler(this.gfx);
      I.toggleSkipBootROM(true);
      // SPEC ข้อ 9: ให้แกนลดความเร็วเป้าหมายเองเมื่อเครื่องทำไม่ทัน (เสียงไม่ขาด ไม่เร่งแซงจนกระตุก)
      I.toggleDynamicSpeed(true);
      this.I = I;

      this._tick = function () {
        self.I.timerCallback((Date.now() - self.t0) >>> 0);
      };
    }

    load(biosU8, romU8) {
      this.stop();
      this.keys = 0;
      this.I.attachBIOS(biosU8);
      this.I.attachROM(romU8);
      this.loaded = true;
    }

    // ---------- โหมดประหยัด (frameskip) ----------
    // n = จำนวนเฟรมที่ข้ามต่อ 1 เฟรมที่วาด (0 = วาดทุกเฟรม, 1 = วาดเฟรมเว้นเฟรม)
    setFrameSkip(n) {
      this.frameSkip = Math.max(0, n | 0);
      this.frameCount = 0;
      this.skipThis = false;
    }

    // ห่อ renderer ของแกน: เฟรมที่ข้ามจะไม่วาดสแกนไลน์และไม่ส่งภาพออก
    // (ยังอัปเดตตัวนับ affine เพื่อให้เฟรมถัดไปถูกต้อง) — ต้องทำใหม่ทุกครั้งที่แกนสร้าง IOCore ใหม่
    _patchRenderer() {
      var io = this.I.IOCore;
      var r = io && io.gfxRenderer && io.gfxRenderer.renderer;
      if (!r || r.__pbx) return;
      var self = this;
      var origRSL = r.renderScanLine;
      var origPF = r.prepareFrame;
      var origEF = r.ensureFraming;
      r.renderScanLine = function () {
        if (self.skipThis) this.updateReferenceCounters();
        else origRSL.call(this);
      };
      r.prepareFrame = function () {
        if (self.skipThis) return;
        if (self.rgba32) {
          var fb = this.frameBuffer, out = self.rgba32, lut = self.lut;
          for (var i = 0; i < 38400; i = (i + 1) | 0) out[i] = lut[fb[i] & 0x7FFF];
          self.frameDirty = true;
        } else {
          origPF.call(this);
        }
      };
      r.ensureFraming = function () {
        origEF.call(this);
        if (self.frameSkip > 0) {
          self.frameCount = (self.frameCount + 1) % (self.frameSkip + 1);
          self.skipThis = self.frameCount !== 0;
        } else {
          self.skipThis = false;
        }
      };
      r.__pbx = true;
    }

    // ---------- Save State ----------
    canState() {
      return !!(this.loaded && this.I.IOCore && (this.I.emulatorStatus & 0x3) === 0x1);
    }

    saveState(reuse) {
      if (!this.canState()) throw new Error("ยังไม่ได้เปิดเกม");
      return serializeCore(this.I.IOCore, reuse);
    }

    loadState(st) {
      if (!this.canState()) throw new Error("ยังไม่ได้เปิดเกม");
      restoreCore(this.I.IOCore, st);
      this.keys = 0;
      this.skipThis = false;
      this.frameCount = 0;
      this.I.invalidateMetrics();
      // แสดงภาพของสถานะที่โหลดทันที (แกนจะไม่วาดใหม่ถ้าจอไม่เปลี่ยน)
      var r = this.I.IOCore.gfxRenderer && this.I.IOCore.gfxRenderer.renderer;
      if (r && r.prepareFrame) r.prepareFrame();
    }

    // ภาพหน้าจอขยายแบบพิกเซลคม (คืน data URL PNG)
    screenshot(scale) {
      scale = scale || 3;
      var c = document.createElement("canvas");
      c.width = 240 * scale;
      c.height = 160 * scale;
      var g = c.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.webkitImageSmoothingEnabled = false;
      g.drawImage(this.canvas, 0, 0, c.width, c.height);
      return c.toDataURL("image/png");
    }

    start() {
      if (!this.loaded || this.running) return;
      this.running = true;
      this.I.play();
      this._patchRenderer();
      if (!this.timer) {
        if (!this.t0) this.t0 = Date.now();
        this.timer = setInterval(this._tick, TICK_MS);
      }
    }

    // หยุดชั่วคราว (แกนจะ export เซฟให้เองตอน pause)
    stop() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = 0;
      }
      if (this.running) {
        this.running = false;
        this.I.pause();
      }
      this.releaseAll();
    }

    reset() {
      this.keys = 0;
      this.I.restart();
      this._patchRenderer();
    }

    // ขอให้แกนส่งเซฟออกตอนนี้เลย (ใช้ทุก 30 วิ / visibilitychange)
    flushSave() {
      this.I.exportSave();
    }

    key(n, down) {
      n = n | 0;
      if (n < 0 || n > 9) return;
      var bit = 1 << n;
      if (down) {
        if (this.keys & bit) return;
        this.keys |= bit;
        this.I.keyDown(n);
      } else {
        if (!(this.keys & bit)) return;
        this.keys &= ~bit;
        this.I.keyUp(n);
      }
    }

    releaseAll() {
      for (var n = 0; n < 10; n++) this.key(n, false);
      this.keys = 0;
    }

    setSpeed(x) {
      x = +x || 1;
      if (x === 1) {
        this.I.toggleDynamicSpeed(true);   // กลับความเร็วปกติ + ปรับเองอัตโนมัติ
      } else {
        this.I.toggleDynamicSpeed(false);  // แกนไม่รับ setSpeed ขณะเปิด dynamicSpeed
        this.I.setSpeed(x);
      }
    }

    getSpeed() {
      return this.I.getSpeed();
    }

    onSpeed(cb) { this.speedCb = cb; }
    onStatus(cb) { this.statusCb = cb; }
    onSaveExport(cb) { this.saveExportCb = cb; }
    // fn(name, onLoaded(arrayLike), onFail())  — name ตามด้วย "TYPE_"+name
    setSaveImport(fn) { this.saveImportFn = fn; }

    gameName() {
      return this.I.getGameName();
    }

    // ---------- เสียง ----------
    // ต้องเรียกจากใน event ของผู้ใช้ (touchend / click / keydown) เพื่อปลดล็อกเสียงบน iOS
    unlockAudio() {
      if (!this.mixer) {
        try {
          this.mixer = new GlueCodeMixer(null); // null = สร้าง AudioContext ทันที (อยู่ใน gesture แล้ว)
          this.audioInput = new GlueCodeMixerInput(this.mixer);
          this.I.attachAudioHandler(this.audioInput);
        } catch (e) {
          this.mixer = null;
          return false;
        }
      }
      var ctx = global.XAudioJSWebAudioContextHandle;
      if (ctx) {
        try {
          if (ctx.state === "suspended" && ctx.resume) ctx.resume();
          // iOS 12: เล่นบัฟเฟอร์เงียบสั้น ๆ หนึ่งครั้งเพื่อปลดล็อก
          var b = ctx.createBuffer(1, 1, 22050);
          var s = ctx.createBufferSource();
          s.buffer = b;
          s.connect(ctx.destination);
          if (s.start) s.start(0); else if (s.noteOn) s.noteOn(0);
        } catch (e) { /* ไม่เป็นไร */ }
      }
      this._applyAudio();
      return true;
    }

    audioState() {
      var ctx = global.XAudioJSWebAudioContextHandle;
      return ctx ? ctx.state : "none";
    }

    setAudioEnabled(on) {
      this.audioWanted = !!on;
      this._applyAudio();
    }

    setAudioMuted(m) {
      this.audioMuted = !!m;
      this._applyAudio();
    }

    _applyAudio() {
      var want = this.audioWanted && !this.audioMuted && !!this.mixer;
      if (want && !this.audioOn) {
        this.I.enableAudio();
        this.audioOn = true;
        if (this.running) this.I.setBufferSpace();
      } else if (!want && this.audioOn) {
        this.I.disableAudio();
        this.audioOn = false;
      }
    }

    suspendAudio() {
      var ctx = global.XAudioJSWebAudioContextHandle;
      if (ctx && ctx.suspend && ctx.state === "running") {
        try { ctx.suspend(); } catch (e) { /* ไม่เป็นไร */ }
      }
    }

    resumeAudio() {
      var ctx = global.XAudioJSWebAudioContextHandle;
      if (ctx && ctx.resume && ctx.state === "suspended") {
        try { ctx.resume(); } catch (e) { /* ไม่เป็นไร */ }
      }
    }

    destroy() {
      this.stop();
      if (this.audioOn) {
        this.I.disableAudio();
        this.audioOn = false;
      }
      this.gfx.graphicsFound = false; // หยุดวาด (rAF ของ GfxGlueCode หยุดเองไม่ได้)
      this.gfx.detachCanvas();
      this.speedCb = this.saveExportCb = this.saveImportFn = this.statusCb = null;
      this.loaded = false;
    }
  }

  PBX.KEY = KEY;
  global.PBX = PBX;
})(window);
