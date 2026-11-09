/*
 * POCKET BETTER X — app.js
 * UI: คลังเกม, BIOS, เซฟในตลับ, สำรอง/กู้คืนเป็นข้อความ,
 *     ตัวเครื่อง (layout จอ, จอยสัมผัสหลายนิ้ว, คีย์บอร์ด, Gamepad)
 * ต้องผ่าน ES2018 และใช้ได้บน Safari 12.1
 */
(function () {
  "use strict";

  var VERSION = "0.7.0"; // ต้องตรงกับ CACHE_VERSION ใน sw.js
  var APP_NAME = "POCKET BETTER X";
  var BIOS_SIZE = 16384;
  var AUTOSAVE_MS = 30000;

  var K = PBX.KEY;
  var $ = function (id) { return document.getElementById(id); };

  var root = $("root");
  var library = $("library");
  var player = $("player");
  var bezel = $("bezel");
  var screenBox = $("screenBox");
  var canvas = $("screen");
  var dpadEl = $("dpad");
  var spdEl = $("spd");
  var toastEl = $("toast");

  // ---------- ตั้งค่าเล็ก ๆ ต่อเครื่อง (เฟส 4 จะมีปุ่มในเมนู) ----------
  function getPref(k, def) {
    try {
      var v = localStorage.getItem("pbx." + k);
      return v === null ? def : JSON.parse(v);
    } catch (e) { return def; }
  }
  function setPref(k, v) {
    try { localStorage.setItem("pbx." + k, JSON.stringify(v)); } catch (e) { /* โหมดส่วนตัว */ }
  }
  var prefs = {
    intScale: getPref("intScale", false),
    showSpeed: getPref("showSpeed", true),
    fastSpeed: getPref("fastSpeed", 2),
    sound: getPref("sound", true),
    eco: getPref("ecoMode", "auto"), // "auto" | "off" | "on"
    rewind: getPref("rewind", false)
  };

  // ---------- แจ้งเตือน ----------
  var toastTimer = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.className = "show";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = ""; }, ms || 2000);
  }

  // ---------- เครื่องมือ ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.onerror = function () { reject(new Error("อ่านไฟล์ไม่ได้: " + file.name)); };
      r.readAsArrayBuffer(file);
    });
  }
  function fetchBin(url) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open("GET", url, true);
      x.responseType = "arraybuffer";
      x.onload = function () {
        if ((x.status === 200 || x.status === 0) && x.response) resolve(new Uint8Array(x.response));
        else reject(new Error("โหลดไม่ได้: " + url));
      };
      x.onerror = function () { reject(new Error("โหลดไม่ได้: " + url)); };
      x.send();
    });
  }
  // FNV-1a 32 บิต → id = hash-ขนาด
  function hashBytes(u8) {
    var h = 0x811c9dc5;
    for (var i = 0, n = u8.length; i < n; i++) {
      h ^= u8[i];
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }
  function u8ToB64(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 0x8000, u8.length)));
    }
    return btoa(s);
  }
  function b64ToU8(b64) {
    var s = atob(String(b64).replace(/\s+/g, ""));
    var u8 = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }
  function toU8(data) {
    if (data instanceof Uint8Array) return new Uint8Array(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
    var u8 = new Uint8Array(data.length);
    for (var i = 0; i < data.length; i++) u8[i] = data[i] & 0xFF;
    return u8;
  }
  function sameBytes(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function headerText(rom, from, to) {
    var s = "";
    for (var i = from; i < to && i < rom.length; i++) {
      var c = rom[i];
      if (c === 0) break;
      if (c >= 0x20 && c < 0x7F) s += String.fromCharCode(c);
    }
    return s.trim();
  }
  function isGbaRom(u8) {
    return u8.length >= 0xC0 && u8[0xB2] === 0x96;
  }
  function fmtMB(bytes) {
    return (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) + " MB";
  }
  function fmtPlayed(t) {
    if (!t) return "ยังไม่เคยเล่น";
    var d = new Date(t);
    var now = new Date();
    var day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (t >= day0) return "เล่นวันนี้";
    if (t >= day0 - 86400000) return "เล่นเมื่อวาน";
    var days = Math.floor((day0 - t) / 86400000) + 1;
    if (days < 7) return "เล่น " + days + " วันก่อน";
    return "เล่น " + d.getDate() + "/" + (d.getMonth() + 1) + "/" + String(d.getFullYear()).slice(2);
  }

  // =========================================================
  // กล่องโต้ตอบ (ใช้แทน prompt/confirm)
  // =========================================================
  var dlgWrap = $("dlgWrap");
  var dlgOpen = false;
  // opt: {title, text, input, area, readonly, buttons:[{label, cls, fn(value) → false = ไม่ปิด}]}
  function dialog(opt) {
    $("dlgTitle").textContent = opt.title || "";
    $("dlgText").textContent = opt.text || "";
    $("dlgText").className = opt.text ? "" : "hide";
    var inp = $("dlgInput");
    var area = $("dlgArea");
    inp.className = opt.input !== undefined ? "" : "hide";
    inp.value = opt.input !== undefined ? opt.input : "";
    area.className = opt.area !== undefined ? "" : "hide";
    area.value = opt.area !== undefined ? opt.area : "";
    area.readOnly = !!opt.readonly;
    area.placeholder = opt.placeholder || "";
    var btns = $("dlgBtns");
    btns.innerHTML = "";
    (opt.buttons || [{ label: "ตกลง", cls: "primary" }]).forEach(function (b) {
      var el = document.createElement("div");
      el.className = "dbtn" + (b.cls ? " " + b.cls : "");
      el.textContent = b.label;
      el.addEventListener("click", function () {
        var val = opt.input !== undefined ? inp.value : area.value;
        var keep = b.fn ? b.fn(val) : true;
        if (keep !== false) closeDialog();
      }, false);
      btns.appendChild(el);
    });
    dlgWrap.className = "";
    dlgOpen = true;
  }
  function closeDialog() {
    dlgWrap.className = "hide";
    dlgOpen = false;
    try { document.activeElement.blur(); } catch (e) { /* ไม่เป็นไร */ }
  }
  function confirmDlg(title, text, okLabel, fn) {
    dialog({
      title: title, text: text,
      buttons: [{ label: "ยกเลิก" }, { label: okLabel, cls: "danger", fn: fn }]
    });
  }
  // คัดลอกข้อความ (iOS 12 ต้องเลือกด้วย range + setSelectionRange)
  function copyTextarea(ta) {
    var ro = ta.readOnly;
    ta.readOnly = false;
    ta.contentEditable = "true";
    ta.focus();
    try {
      var range = document.createRange();
      range.selectNodeContents(ta);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* ไม่เป็นไร */ }
    ta.setSelectionRange(0, ta.value.length);
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.contentEditable = "false";
    ta.readOnly = ro;
    ta.blur();
    return ok;
  }

  // =========================================================
  // Bottom sheet
  // =========================================================
  var sheetWrap = $("sheetWrap");
  var sheetOpen = false;
  var sheetOnClose = null;
  // items: [{icon, label, cls, fn}]
  function openSheet(title, items, note, onClose) {
    $("sheetTitle").textContent = title;
    var body = $("sheetBody");
    body.innerHTML = "";
    items.forEach(function (it) {
      var el = document.createElement("div");
      el.className = "tile" + (it.cls ? " " + it.cls : "");
      el.innerHTML = '<div class="ti">' + it.icon + '</div><div class="tl">' + esc(it.label) + "</div>";
      el.addEventListener("click", function () { it.fn(el); }, false);
      body.appendChild(el);
    });
    $("sheetNote").textContent = note || "";
    $("sheetNote").className = note ? "" : "hide";
    sheetOnClose = onClose || null;
    sheetWrap.className = "";
    sheetOpen = true;
    releaseAllInput();
  }
  // closeSheet(true) = ปิดเงียบ ๆ ไม่เรียก onClose
  function closeSheet(silent) {
    if (!sheetOpen) return;
    sheetWrap.className = "hide";
    sheetOpen = false;
    var cb = sheetOnClose;
    sheetOnClose = null;
    if (cb && !silent) cb();
  }
  $("sheetBg").addEventListener("click", function () { closeSheet(); }, false);
  $("sheetClose").addEventListener("click", function () { closeSheet(); }, false);

  // =========================================================
  // คลังเกม
  // =========================================================
  var romIndex = []; // [{id,name,title,code,size,added,lastPlayed,thumb}]
  var ART = [
    ["#7b2ff7", "#c2185b"], ["#0f9b8e", "#2c5364"], ["#f7971e", "#d35400"], ["#2b5876", "#4e4376"],
    ["#e53935", "#6a1b9a"], ["#11998e", "#38ef7d"], ["#3a7bd5", "#00d2ff"], ["#c94b4b", "#4b134f"]
  ];

  function saveIndex() {
    return DB.setSetting("romIndex", romIndex);
  }
  function findMeta(id) {
    for (var i = 0; i < romIndex.length; i++) if (romIndex[i].id === id) return romIndex[i];
    return null;
  }
  function initials(name) {
    var w = String(name).replace(/[^0-9A-Za-z฀-๿ ]+/g, " ").trim();
    return (w.slice(0, 2) || "GB").toUpperCase();
  }

  function renderLibrary() {
    var grid = $("grid");
    var list = romIndex.slice().sort(function (a, b) {
      return (b.lastPlayed || 0) - (a.lastPlayed || 0) || (b.added || 0) - (a.added || 0);
    });
    var html = "";
    var total = 0;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      total += m.size || 0;
      var c = ART[parseInt(m.id.slice(0, 2), 16) % ART.length];
      var art = m.thumb
        ? '<img src="' + m.thumb + '" alt="">'
        : '<div class="cardInit">' + esc(initials(m.name)) + "</div>";
      html += '<div class="card" data-id="' + esc(m.id) + '">' +
        '<div class="cardArt" style="background:linear-gradient(135deg,' + c[0] + " 0%," + c[1] + ' 100%)">' + art +
        '<div class="cardMore" data-more="1">···</div></div>' +
        '<div class="cardName">' + esc(m.name) + "</div>" +
        '<div class="cardMeta"><span class="badge">GBA</span>' + esc(fmtPlayed(m.lastPlayed)) + "</div></div>";
    }
    grid.innerHTML = html;
    $("empty").className = list.length ? "hide" : "";
    $("libFoot").textContent = APP_NAME + " v" + VERSION + " · core: IodineGBA · ใช้พื้นที่ " + fmtMB(total);
  }

  $("grid").addEventListener("click", function (e) {
    var el = e.target;
    var more = false;
    while (el && el !== this) {
      if (el.getAttribute("data-more")) more = true;
      var id = el.getAttribute("data-id");
      if (id) {
        if (more) openRomSheet(id); else playRom(id);
        return;
      }
      el = el.parentNode;
    }
  }, false);

  // ---------- เพิ่มเกม ----------
  $("addFile").addEventListener("change", function (e) {
    var files = [];
    for (var i = 0; i < e.target.files.length; i++) files.push(e.target.files[i]);
    e.target.value = "";
    addFiles(files);
  }, false);

  function addFiles(files) {
    var added = 0, skipped = [], dup = 0;
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        return readFile(f).then(function (u8) {
          return addRomBytes(u8, f.name).then(function (r) {
            if (r === "dup") dup++;
            else if (r === "bad") skipped.push(f.name + (u8.length === BIOS_SIZE ? " (อาจเป็น BIOS ใส่ได้ใน ⚙)" : ""));
            else added++;
          });
        });
      });
    });
    toast("กำลังเพิ่มเกม…", 60000);
    return chain.then(function () {
      renderLibrary();
      var msg = [];
      if (added) msg.push("เพิ่มเกมแล้ว " + added + " เกม");
      if (dup) msg.push("มีอยู่แล้ว " + dup + " เกม");
      if (skipped.length) {
        toast(msg.join(" · ") || "ไม่ได้เพิ่มเกม");
        dialog({ title: "ข้ามไฟล์ที่ไม่ใช่เกม .gba", text: skipped.join("\n") });
      } else {
        toast(msg.join(" · ") || "ไม่ได้เพิ่มเกม");
      }
    }).catch(function (err) {
      renderLibrary();
      toast("ผิดพลาด: " + err.message, 4000);
    });
  }

  // คืนค่า "ok" / "dup" / "bad"
  function addRomBytes(u8, fileName) {
    if (!isGbaRom(u8)) return Promise.resolve("bad");
    var id = hashBytes(u8) + "-" + u8.length.toString(16);
    if (findMeta(id)) return Promise.resolve("dup");
    var title = headerText(u8, 0xA0, 0xAC);
    var code = headerText(u8, 0xAC, 0xB0);
    var name = String(fileName || title || "GAME").replace(/\.[^.]+$/, "") || title || "GAME";
    var now = Date.now();
    var rec = { id: id, name: name, title: title, code: code, size: u8.length, data: u8, added: now, lastPlayed: 0, thumb: "" };
    return DB.put("roms", rec).then(function () {
      romIndex.push({ id: id, name: name, title: title, code: code, size: u8.length, added: now, lastPlayed: 0, thumb: "" });
      return saveIndex();
    }).then(function () { return "ok"; });
  }

  // ---------- เมนู ⋯ ของแต่ละเกม ----------
  function openRomSheet(id) {
    var m = findMeta(id);
    if (!m) return;
    var info = (m.title ? m.title + " · " : "") + (m.code ? m.code + " · " : "") + fmtMB(m.size);
    openSheet(m.name, [
      { icon: "▶️", label: "เล่น", fn: function () { closeSheet(true); playRom(id); } },
      { icon: "📥", label: "นำเข้า .sav", fn: function () { pickSav(id); } },
      { icon: "📋", label: "สำรองเป็นข้อความ", fn: function () { closeSheet(true); backupSaves([id]); } },
      { icon: "✏️", label: "เปลี่ยนชื่อ", fn: function () { closeSheet(true); renameRom(id); } },
      { icon: "🗑️", label: "ลบ", cls: "danger", fn: function () { closeSheet(true); deleteRom(id); } }
    ], info);
  }

  function renameRom(id) {
    var m = findMeta(id);
    if (!m) return;
    dialog({
      title: "เปลี่ยนชื่อเกม",
      input: m.name,
      buttons: [{ label: "ยกเลิก" }, {
        label: "บันทึก", cls: "primary", fn: function (v) {
          v = String(v).trim();
          if (!v) return false;
          m.name = v;
          saveIndex();
          DB.get("roms", id).then(function (r) { if (r) { r.name = v; return DB.put("roms", r); } });
          renderLibrary();
        }
      }]
    });
  }

  function deleteRom(id) {
    var m = findMeta(id);
    if (!m) return;
    confirmDlg("ลบเกมนี้?", "“" + m.name + "” และเซฟของเกมนี้จะถูกลบออกจากเครื่อง ย้อนกลับไม่ได้\nแนะนำให้สำรองเซฟเป็นข้อความก่อน", "ลบ", function () {
      DB.deleteRom(id).then(function () {
        romIndex = romIndex.filter(function (x) { return x.id !== id; });
        return saveIndex();
      }).then(function () {
        renderLibrary();
        toast("ลบแล้ว");
      }).catch(function (err) { toast("ลบไม่สำเร็จ: " + err.message); });
    });
  }

  // ---------- นำเข้า .sav ----------
  var savTarget = null;
  function pickSav(id) {
    savTarget = id;
    $("savFile").click();
  }
  $("savFile").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = "";
    var id = savTarget;
    savTarget = null;
    if (!f || !id) return;
    closeSheet(true);
    readFile(f).then(function (u8) {
      if (!u8.length || u8.length > 0x40000) throw new Error("ไฟล์เซฟไม่ถูกต้อง (" + u8.length + " ไบต์)");
      return DB.get("saves", id).then(function (old) {
        // ใช้ชนิดเซฟเดิมถ้าขนาดเท่ากัน ไม่งั้นให้แกนตรวจเอง (0)
        var type = old && old.data && old.data.length === u8.length ? old.type : 0;
        return DB.put("saves", { id: id, data: u8, type: type, time: Date.now() });
      });
    }).then(function () {
      var m = findMeta(id);
      if (cur && cur.id === id) {
        // เกมนี้กำลังเปิดอยู่ → โหลดใหม่ให้ใช้เซฟที่นำเข้า (เฟส 4 เรียกจากเมนูในเกม)
        lastSaved = null;
        playRom(id);
      }
      toast("นำเข้าเซฟแล้ว" + (m ? ": " + m.name : ""));
    }).catch(function (err) { toast(err.message, 3500); });
  }, false);

  // ---------- สำรอง / กู้คืนเป็นข้อความ ----------
  function backupSaves(ids) {
    var p = ids
      ? Promise.all(ids.map(function (id) { return DB.get("saves", id); }))
      : DB.all("saves");
    p.then(function (rows) {
      var saves = [];
      rows.forEach(function (r) {
        if (!r || !r.data) return;
        var m = findMeta(r.id);
        saves.push({ id: r.id, name: m ? m.name : "", type: r.type | 0, data: u8ToB64(toU8(r.data)) });
      });
      if (!saves.length) {
        dialog({ title: "ยังไม่มีเซฟ", text: ids ? "เกมนี้ยังไม่มีเซฟในตลับ ลองเล่นแล้วเซฟในเกมก่อน" : "ยังไม่มีเซฟของเกมไหนเลย" });
        return;
      }
      var text = JSON.stringify({ app: APP_NAME, v: 1, time: Date.now(), saves: saves });
      dialog({
        title: "สำรองเซฟเป็นข้อความ (" + saves.length + " เกม)",
        text: "กด “คัดลอก” แล้วนำไปวางเก็บไว้ในแอปโน้ต อีเมล หรือแชต\nเมื่อต้องการกู้คืน ให้ไปที่ ⚙ › กู้คืนจากข้อความ",
        area: text,
        readonly: true,
        buttons: [{ label: "ปิด" }, {
          label: "คัดลอก", cls: "primary", fn: function () {
            var ok = copyTextarea($("dlgArea"));
            toast(ok ? "คัดลอกแล้ว" : "คัดลอกไม่ได้ ให้กดค้างที่ข้อความแล้วเลือกคัดลอก", 3000);
            return false;
          }
        }]
      });
    }).catch(function (err) { toast("ผิดพลาด: " + err.message); });
  }

  function restoreSaves() {
    dialog({
      title: "กู้คืนเซฟจากข้อความ",
      text: "วางข้อความสำรองที่คัดลอกไว้ลงในช่องด้านล่าง เซฟเดิมของเกมเดียวกันจะถูกแทนที่",
      area: "",
      placeholder: "{\"app\":\"POCKET BETTER X\", ...}",
      buttons: [{ label: "ยกเลิก" }, {
        label: "กู้คืน", cls: "primary", fn: function (txt) {
          var obj;
          try { obj = JSON.parse(String(txt).trim()); } catch (e) { obj = null; }
          if (!obj || obj.app !== APP_NAME || !obj.saves || !obj.saves.length) {
            toast("ข้อความไม่ถูกต้อง", 3000);
            return false;
          }
          var n = 0, known = 0;
          var chain = Promise.resolve();
          obj.saves.forEach(function (s) {
            if (!s || !s.id || !s.data) return;
            chain = chain.then(function () {
              return DB.put("saves", { id: String(s.id), data: b64ToU8(s.data), type: s.type | 0, time: Date.now() }).then(function () {
                n++;
                if (findMeta(String(s.id))) known++;
              });
            });
          });
          chain.then(function () {
            var missing = n - known;
            dialog({
              title: "กู้คืนแล้ว " + n + " เซฟ",
              text: missing ? "มี " + missing + " เซฟที่ยังไม่มีเกมในคลัง เมื่อเพิ่มไฟล์เกมเดิมเข้ามา เซฟจะกลับมาเอง" : "พร้อมเล่นต่อได้เลย"
            });
          }).catch(function (err) { toast("กู้คืนไม่สำเร็จ: " + err.message, 3500); });
        }
      }]
    });
  }

  // =========================================================
  // BIOS
  // =========================================================
  var biosCache = null; // {custom:bool, data:Uint8Array}
  function getBios() {
    if (biosCache) return Promise.resolve(biosCache);
    return DB.getSetting("bios", null).catch(function () { return null; }).then(function (custom) {
      if (custom && custom.length === BIOS_SIZE) {
        biosCache = { custom: true, data: toU8(custom) };
        return biosCache;
      }
      return fetchBin("bios/cult-of-gba-bios.bin").then(function (u8) {
        biosCache = { custom: false, data: u8 };
        return biosCache;
      });
    });
  }
  $("biosFile").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    closeSheet(true);
    readFile(f).then(function (u8) {
      if (u8.length !== BIOS_SIZE) throw new Error("BIOS ต้องมีขนาด 16384 ไบต์ (ไฟล์นี้ " + u8.length + " ไบต์)");
      return DB.setSetting("bios", u8).then(function () {
        biosCache = { custom: true, data: u8 };
        toast("ใช้ BIOS ของคุณแล้ว (มีผลตอนเปิดเกมครั้งถัดไป)", 3000);
      });
    }).catch(function (err) { toast(err.message, 3500); });
  }, false);

  function openSettings() {
    getBios().then(function (b) {
      var note = "BIOS ที่ใช้อยู่: " + (b.custom ? "BIOS ของฉัน (16KB)" : "Cult-of-GBA (โอเพนซอร์ส)") +
        "\nเวอร์ชัน " + VERSION + " · เซฟในตลับบันทึกอัตโนมัติทุก 30 วินาทีและตอนออกจากแอป";
      openSheet("ตั้งค่า", [
        { icon: "🧩", label: "ใช้ BIOS ของฉัน (16KB)", cls: b.custom ? "on" : "", fn: function () { $("biosFile").click(); } },
        { icon: "↩️", label: "ใช้ BIOS เริ่มต้น", cls: b.custom ? "" : "dim", fn: function () {
          if (!b.custom) { toast("ใช้ BIOS เริ่มต้นอยู่แล้ว"); return; }
          DB.delSetting("bios").then(function () {
            biosCache = null;
            closeSheet(true);
            toast("กลับไปใช้ BIOS เริ่มต้นแล้ว");
          });
        } },
        { icon: "📋", label: "สำรองเซฟทั้งหมด", fn: function () { closeSheet(true); backupSaves(null); } },
        { icon: "📥", label: "กู้คืนจากข้อความ", fn: function () { closeSheet(true); restoreSaves(); } }
      ], note);
    });
  }
  $("btnSettings").addEventListener("click", openSettings, false);

  // =========================================================
  // แกนจำลอง + เซฟในตลับ
  // =========================================================
  var emu = new PBX(canvas);
  var cur = null;          // meta ของเกมที่เปิดอยู่
  var curSave = null;      // {data, type} ที่ป้อนเข้าแกนตอนเปิดเกม
  var lastSaved = null;    // ไบต์ล่าสุดที่เขียนลง DB (กันเขียนซ้ำ)
  var pendingSave = null;  // ข้อมูลเซฟที่รอชนิด (แกนส่ง name แล้วตามด้วย TYPE_name)
  var userPaused = false;
  var autosaveTimer = 0;

  emu.onSpeed(function (p) {
    autoEcoTick(p);
    if (!prefs.showSpeed) return;
    var r = Math.round(p);
    spdEl.textContent = r + "%";
    var slow = r < 95;
    if (slow !== spdEl._slow) {
      spdEl._slow = slow;
      spdEl.className = slow ? "slow" : "";
    }
  });
  emu.onStatus(function (on) {
    $("led").className = on ? "on" : "";
    if (on) ecoHoldUntil = Date.now() + 4000; // ช่วงอุ่นเครื่องหลังเริ่ม/เล่นต่อ: ไม่ปรับโหมดประหยัด
  });
  spdEl.className = prefs.showSpeed ? "" : "hide";
  emu.setAudioEnabled(prefs.sound);
  applyEco();

  // ---------- โหมดประหยัดอัตโนมัติ ----------
  // แกนรายงานความเร็วทุก 0.5 วินาที: ช้ากว่า 93% ติดกัน 1.5 วิ → ข้ามเฟรมเพิ่ม (สูงสุด 2)
  // เต็ม 99% ขึ้นไปติดกัน 20 วิ → ลดการข้ามลง 1 ขั้น (ช้า ๆ เพื่อไม่ให้สลับไปมาจนกระตุก)
  var autoSkip = 0, lowRuns = 0, highRuns = 0, ecoHoldUntil = 0;
  function ecoLevel() {
    if (prefs.eco === "on") return 1;
    if (prefs.eco === "auto") return autoSkip;
    return 0;
  }
  function applyEco() { emu.setFrameSkip(ecoLevel()); }
  function resetAutoEco() {
    autoSkip = 0;
    lowRuns = highRuns = 0;
    applyEco();
  }
  function autoEcoTick(p) {
    if (prefs.eco !== "auto" || !emu.running || fast || document.hidden || Date.now() < ecoHoldUntil) {
      lowRuns = highRuns = 0;
      return;
    }
    if (p < 93) {
      highRuns = 0;
      if (++lowRuns >= 3 && autoSkip < 2) { autoSkip++; lowRuns = 0; applyEco(); }
    } else if (p >= 99) {
      lowRuns = 0;
      if (++highRuns >= 40 && autoSkip > 0) { autoSkip--; highRuns = 0; applyEco(); }
    } else {
      lowRuns = highRuns = 0;
    }
  }
  function ecoLabel() {
    return "โหมดประหยัด: " + (prefs.eco === "auto" ? "อัตโนมัติ" : prefs.eco === "on" ? "เปิด" : "ปิด");
  }

  emu.setSaveImport(function (name, onLoaded, onFail) {
    if (!curSave || !curSave.data) { onFail(); return; }
    if (name.indexOf("TYPE_") === 0) onLoaded([curSave.type | 0]);
    else onLoaded(curSave.data);
  });
  emu.onSaveExport(function (name, data) {
    if (name.indexOf("TYPE_") === 0) {
      if (pendingSave) persistSave(pendingSave, data && data.length ? data[0] | 0 : 0);
      pendingSave = null;
    } else {
      pendingSave = data;
    }
  });

  function persistSave(data, type) {
    if (!cur || !data || !data.length) return;
    if (sameBytes(data, lastSaved)) return;
    var copy = toU8(data);
    var id = cur.id;
    lastSaved = copy;
    DB.put("saves", { id: id, data: copy, type: type | 0, time: Date.now() }).catch(function (err) {
      lastSaved = null;
      toast("บันทึกเซฟไม่สำเร็จ: " + err.message, 4000);
    });
  }

  function flushSave() {
    if (cur && emu.running) emu.flushSave();
  }

  function playRom(id) {
    var m = findMeta(id);
    if (!m) return;
    toast("กำลังเปิดเกม…", 30000);
    Promise.all([DB.get("roms", id), getBios(), DB.get("saves", id)]).then(function (r) {
      var rom = r[0], bios = r[1], save = r[2];
      if (!rom || !rom.data) throw new Error("ไม่พบไฟล์เกมในเครื่อง");
      if (cur && emu.running) emu.stop(); // ส่งเซฟเกมเดิมออกก่อน
      cur = m;
      curSave = save && save.data ? { data: toU8(save.data), type: save.type | 0 } : null;
      lastSaved = curSave ? curSave.data : null;
      pendingSave = null;
      setFast(false);
      releaseAllInput();
      // ไม่คัดลอก ROM ซ้ำ (ประหยัด RAM บน iPhone 6)
      emu.load(bios.data, rom.data instanceof Uint8Array ? rom.data : new Uint8Array(rom.data));
      userPaused = false;
      $("gameTitle").textContent = m.name;
      showPlayer();
      emu.start();
      m.lastPlayed = Date.now();
      saveIndex();
      clearInterval(autosaveTimer);
      autosaveTimer = setInterval(flushSave, AUTOSAVE_MS);
      stateMeta = {};
      loadStateMeta(m.id);
      startRewindCapture();
      resetAutoEco();
      toastEl.className = "";
    }).catch(function (err) {
      toast("เปิดเกมไม่ได้: " + err.message, 4000);
    });
  }

  function exitGame() {
    closeSheet(true);
    if (!cur) { showLibrary(); return; }
    clearInterval(autosaveTimer);
    autosaveTimer = 0;
    setFast(false);
    endRewind(true);
    stopRewindCapture();
    emu.stop(); // แกน export เซฟตอน pause → persistSave
    writeState("auto").catch(function () { /* ฟีเจอร์ทดลอง: ไม่ต้องแจ้ง */ });
    var m = cur;
    try { m.thumb = canvas.toDataURL("image/jpeg", 0.75); } catch (e) { /* ไม่เป็นไร */ }
    saveIndex();
    cur = null;
    curSave = null;
    showLibrary();
  }

  // =========================================================
  // Save State (ทดลอง): 4 ช่อง + ช่องอัตโนมัติ (ตอนออกจากเกม/สลับแอป)
  // ข้อมูลอยู่ใน store "states"; รายการช่อง (เวลา+ภาพย่อ) อยู่ใน settings "states:<romId>"
  // =========================================================
  var stateMeta = {};
  function loadStateMeta(id) {
    return DB.getSetting("states:" + id, {}).then(function (m) {
      if (cur && cur.id === id) stateMeta = m || {};
      return stateMeta;
    }).catch(function () { return stateMeta; });
  }
  function slotName(slot) { return slot === "auto" ? "อัตโนมัติ" : "ช่อง " + slot; }
  function fmtTime(t) {
    var d = new Date(t);
    var mm = d.getMinutes();
    return d.getDate() + "/" + (d.getMonth() + 1) + " " + d.getHours() + ":" + (mm < 10 ? "0" : "") + mm;
  }

  function writeState(slot) {
    if (!cur) return Promise.reject(new Error("ยังไม่ได้เปิดเกม"));
    var st;
    try { st = emu.saveState(); } catch (e) { return Promise.reject(e); }
    var thumb = "";
    try { thumb = canvas.toDataURL("image/jpeg", 0.6); } catch (e) { /* ไม่เป็นไร */ }
    var id = cur.id;
    var meta = stateMeta;
    var t = Date.now();
    return DB.put("states", { key: id + ":" + slot, romId: id, slot: slot, data: st, thumb: thumb, time: t, ver: VERSION }).then(function () {
      meta[slot] = { time: t, thumb: thumb };
      return DB.setSetting("states:" + id, meta);
    });
  }

  function readState(slot) {
    if (!cur) return Promise.reject(new Error("ยังไม่ได้เปิดเกม"));
    return DB.get("states", cur.id + ":" + slot).then(function (rec) {
      if (!rec || !rec.data) throw new Error("ช่องนี้ว่าง");
      releaseAllInput();
      emu.loadState(rec.data);
      ring = [];
    });
  }

  function openStateSheet(mode) {
    closeSheet(true);
    var slots = mode === "load" ? ["auto", 1, 2, 3, 4] : [1, 2, 3, 4];
    var items = slots.map(function (slot) {
      var m = stateMeta[slot];
      var icon = m && m.thumb ? '<img class="slotImg" src="' + m.thumb + '" alt="">' : '<div class="slotEmpty">' + (slot === "auto" ? "A" : slot) + "</div>";
      return {
        icon: icon,
        label: slotName(slot) + " · " + (m ? fmtTime(m.time) : "ว่าง"),
        cls: mode === "load" && !m ? "dim" : "",
        fn: function () {
          if (mode === "save") {
            writeState(slot).then(function () {
              toast("บันทึกสถานะ " + slotName(slot) + " แล้ว");
              closeSheet();
            }).catch(function (err) { toast("บันทึกสถานะไม่สำเร็จ: " + err.message, 4000); });
          } else {
            if (!m) { toast("ช่องนี้ว่าง"); return; }
            toast("กำลังโหลด…", 10000);
            readState(slot).then(function () {
              toast("โหลดสถานะ " + slotName(slot) + " แล้ว");
              closeSheet();
            }).catch(function (err) { toast("โหลดสถานะไม่สำเร็จ: " + err.message, 4000); });
          }
        }
      };
    });
    openSheet(mode === "load" ? "โหลดสถานะ" : "บันทึกสถานะ", items,
      "ฟีเจอร์ทดลอง: ถ้าเกมทำงานผิดปกติหลังโหลดสถานะ ให้ใช้เซฟในเกมแทน" +
      (mode === "load" ? " · ช่องอัตโนมัติบันทึกตอนออกจากเกมหรือสลับแอป" : ""),
      function () { resumeGame(); });
  }

  // =========================================================
  // ย้อนเวลา: เก็บสถานะทุก 1 วินาที (สูงสุด 20 วินาที) กด ⏪ ค้างเพื่อย้อน
  // ปิดไว้เป็นค่าเริ่มต้นเพื่อความเร็วบน iPhone 6
  // =========================================================
  var REWIND_EVERY = 1000, REWIND_MAX = 20, REWIND_STEP_MS = 350;
  var ring = [];
  var ringTimer = 0, rewTimer = 0;
  var rewinding = false;

  function stopRewindCapture() {
    clearInterval(ringTimer);
    ringTimer = 0;
    ring = [];
  }
  function startRewindCapture() {
    stopRewindCapture();
    if (prefs.rewind && cur) ringTimer = setInterval(captureRewind, REWIND_EVERY);
    $("chipRew").className = "chip" + (prefs.rewind ? "" : " off");
  }
  function captureRewind() {
    if (!cur || !emu.running || rewinding) return;
    var reuse = ring.length >= REWIND_MAX ? ring.shift() : null;
    try { ring.push(emu.saveState(reuse)); } catch (e) { /* ข้าม */ }
  }
  function stepBack() {
    if (!ring.length) return;
    try { emu.loadState(ring.pop()); } catch (e) { endRewind(); }
  }
  function beginRewind() {
    if (!prefs.rewind) { toast("เปิด “ย้อนเวลา” ได้ในเมนู ☰"); return; }
    if (rewinding) return;
    if (!ring.length) { toast("ยังไม่มีข้อมูลย้อนเวลา"); return; }
    rewinding = true;
    $("chipRew").className = "chip on";
    releaseAllInput();
    emu.stop();
    stepBack();
    rewTimer = setInterval(stepBack, REWIND_STEP_MS);
  }
  // noResume = true: ไม่ต้องเล่นต่อ (เช่น กำลังออกจากเกม)
  function endRewind(noResume) {
    if (!rewinding) return;
    rewinding = false;
    clearInterval(rewTimer);
    rewTimer = 0;
    $("chipRew").className = "chip" + (prefs.rewind ? "" : " off");
    if (!noResume && cur && !userPaused && !sheetOpen) emu.start();
  }

  function showPlayer() {
    library.className = "hide";
    player.className = "";
    document.body.className = "playing";
    layout();
  }
  function showLibrary() {
    player.className = "hide";
    library.className = "";
    document.body.className = "";
    renderLibrary();
  }

  // =========================================================
  // เมนูในเกม (Bottom sheet) — หยุดเกมทุกครั้งที่เปิด
  // =========================================================
  function setTile(el, label, on) {
    el.querySelector(".tl").textContent = label;
    el.className = "tile" + (on ? " on" : "");
  }
  function onOff(v) { return v ? "เปิด" : "ปิด"; }

  function openGameMenu() {
    if (!cur) return;
    userPaused = true;
    emu.stop(); // pause → แกนส่งเซฟออก → บันทึกลง DB
    openSheet(cur.name, [
      { icon: "💾", label: "บันทึกสถานะ", fn: function () { openStateSheet("save"); } },
      { icon: "📂", label: "โหลดสถานะ", fn: function () { openStateSheet("load"); } },
      { icon: "⏩", label: "ความเร็ว x" + prefs.fastSpeed, fn: function (el) {
        prefs.fastSpeed = prefs.fastSpeed === 2 ? 3 : 2;
        setPref("fastSpeed", prefs.fastSpeed);
        setTile(el, "ความเร็ว x" + prefs.fastSpeed, false);
        if (fast) setFast(true);
        toast("ปุ่ม ▶▶ จะเร่งเป็น x" + prefs.fastSpeed + " (ปิดเสียงขณะเร่ง)");
      } },
      { icon: "🔊", label: "เสียง: " + onOff(prefs.sound), cls: prefs.sound ? "on" : "", fn: function (el) {
        prefs.sound = !prefs.sound;
        setPref("sound", prefs.sound);
        emu.setAudioEnabled(prefs.sound);
        el.querySelector(".ti").textContent = prefs.sound ? "🔊" : "🔇";
        setTile(el, "เสียง: " + onOff(prefs.sound), prefs.sound);
      } },
      { icon: "📈", label: "แสดงความเร็ว %", cls: prefs.showSpeed ? "on" : "", fn: function (el) {
        prefs.showSpeed = !prefs.showSpeed;
        setPref("showSpeed", prefs.showSpeed);
        spdEl.className = prefs.showSpeed ? "" : "hide";
        spdEl._slow = false;
        setTile(el, "แสดงความเร็ว %", prefs.showSpeed);
      } },
      { icon: "🔲", label: "สเกลจำนวนเต็ม", cls: prefs.intScale ? "on" : "", fn: function (el) {
        prefs.intScale = !prefs.intScale;
        setPref("intScale", prefs.intScale);
        layout();
        setTile(el, "สเกลจำนวนเต็ม", prefs.intScale);
      } },
      { icon: "🔋", label: ecoLabel(), cls: prefs.eco !== "off" ? "on" : "", fn: function (el) {
        prefs.eco = prefs.eco === "auto" ? "off" : prefs.eco === "off" ? "on" : "auto";
        setPref("ecoMode", prefs.eco);
        resetAutoEco();
        setTile(el, ecoLabel(), prefs.eco !== "off");
        toast(prefs.eco === "auto" ? "ข้ามการวาดภาพเองเมื่อเครื่องช้า" :
          prefs.eco === "on" ? "วาดภาพเฟรมเว้นเฟรมตลอด" : "วาดภาพทุกเฟรม", 2500);
      } },
      { icon: "⏪", label: "ย้อนเวลา", cls: prefs.rewind ? "on" : "", fn: function (el) {
        prefs.rewind = !prefs.rewind;
        setPref("rewind", prefs.rewind);
        startRewindCapture();
        setTile(el, "ย้อนเวลา", prefs.rewind);
        toast(prefs.rewind ? "ย้อนเวลา: เปิด · กด ⏪ ค้างเพื่อย้อน (ใช้แรงเครื่องเพิ่ม)" : "ย้อนเวลา: ปิด", 3000);
      } },
      { icon: "📸", label: "ภาพหน้าจอ", fn: function () { showScreenshot(); } },
      { icon: "📋", label: "สำรองเซฟเป็นข้อความ", fn: function () { backupSaves([cur.id]); } },
      { icon: "📥", label: "นำเข้า .sav", fn: function () { pickSav(cur.id); } },
      { icon: "🔄", label: "รีเซ็ตเกม", fn: function () {
        closeSheet(true);
        dialog({
          title: "รีเซ็ตเกม?",
          text: "เริ่มเกมใหม่ตั้งแต่ต้น ความคืบหน้าที่ยังไม่ได้เซฟในเกมจะหายไป",
          buttons: [
            { label: "ยกเลิก", fn: function () { resumeGame(); } },
            { label: "รีเซ็ต", cls: "danger", fn: function () { emu.reset(); ring = []; resumeGame(); } }
          ]
        });
      } },
      { icon: "⏏️", label: "ออกจากเกม", cls: "danger", fn: function () { exitGame(); } }
    ], "เคล็ดลับ: แตะ ▶▶ เพื่อเร่งความเร็ว · กด A+B พร้อมกันได้โดยแตะจุดตรงกลางระหว่างปุ่ม · เกมหยุดอยู่ระหว่างเปิดเมนู", function () {
      resumeGame();
    });
  }

  // ภาพหน้าจอ: iOS 12 บันทึกไฟล์จากเว็บไม่ได้ → แสดงภาพให้กดค้างแล้ว “บันทึกภาพ”
  function showScreenshot() {
    var url;
    try { url = emu.screenshot(3); } catch (e) { toast("ถ่ายภาพหน้าจอไม่ได้"); return; }
    var img = $("shotImg");
    img.src = url;
    var a = $("shotSave");
    a.href = url;
    a.setAttribute("download", (cur ? cur.name : "screenshot").replace(/[\\\/:*?"<>|]+/g, "_") + "-" + Date.now() + ".png");
    $("shotWrap").className = "";
  }
  // iOS: ลิงก์ data: จะพาออกจากแอปที่ติดตั้งบนหน้าจอโฮม → ซ่อนปุ่มดาวน์โหลด ใช้กดค้างแทน
  var IS_IOS = /iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (IS_IOS) $("shotSave").className = "hide";
  else $("shotHint").textContent = "กด “ดาวน์โหลด” เพื่อบันทึกภาพ (บน iPhone ให้กดค้างที่ภาพ)";
  $("shotClose").addEventListener("click", function () {
    $("shotWrap").className = "hide";
    $("shotImg").src = "";
  }, false);
  function resumeGame() {
    if (!cur) return;
    userPaused = false;
    emu.start();
  }

  // =========================================================
  // layout(): จอ 240x160 ใหญ่ที่สุดที่ไม่ทับปุ่ม
  // =========================================================
  var BEZEL_PAD_X = 6, BEZEL_HEAD = 18, BEZEL_PAD_B = 6;

  // =========================================================
  // แนวนอนเสมอ: ถ้าถือเครื่องแนวตั้ง (หรือล็อกการหมุนจอไว้) หมุน #root -90° ให้เอง
  // iOS 12 ล็อกการหมุนจอจากเว็บไม่ได้ จึงหมุนเนื้อหาแทน
  // =========================================================
  var rotated = false;
  var vw = window.innerWidth, vh = window.innerHeight; // ขนาด "แนวนอน" ที่ใช้วางหน้าจอ
  function applyOrientation() {
    var W = window.innerWidth, H = window.innerHeight;
    rotated = H > W;
    if (rotated) {
      root.style.width = H + "px";
      root.style.height = W + "px";
      // หมุนทวนเข็ม: ด้านบนของหน้าจออยู่ฝั่งซ้ายของเครื่อง (ปุ่มโฮมอยู่ขวามือ)
      var tf = "translate(0px," + H + "px) rotate(-90deg)";
      root.style.webkitTransform = tf;
      root.style.transform = tf;
      vw = H; vh = W;
    } else {
      root.style.width = "";
      root.style.height = "";
      root.style.webkitTransform = "";
      root.style.transform = "";
      vw = W; vh = H;
    }
    root.className = vw >= 800 ? "wide" : "";
  }
  var dpadRect = null;

  function safeInsets() {
    var cs = window.getComputedStyle(player);
    return {
      t: parseFloat(cs.paddingTop) || 0,
      r: parseFloat(cs.paddingRight) || 0,
      b: parseFloat(cs.paddingBottom) || 0,
      l: parseFloat(cs.paddingLeft) || 0
    };
  }

  function layout() {
    if (player.className === "hide") return;
    var W = vw;
    var H = vh;
    var s = safeInsets();
    // จออยู่ระหว่าง D-pad (ซ้าย) กับ A/B (ขวา) ส่วน L/R และชิปอยู่ในแถบข้างจึงใช้ความสูงได้เกือบเต็ม
    var areaL = s.l + 132;               // ขอบขวาของ D-pad/ปุ่ม L + ระยะห่าง
    var areaT = s.t + 8;
    var areaW = W - areaL - (s.r + 142); // ขอบซ้ายของปุ่ม B + ระยะห่าง
    var areaH = H - areaT - (s.b + 30);  // เหนือชื่อแบรนด์

    var maxW = areaW - BEZEL_PAD_X * 2;
    var maxH = areaH - BEZEL_HEAD - BEZEL_PAD_B;
    var scale = Math.min(maxW / 240, maxH / 160);
    if (prefs.intScale && scale >= 1) scale = Math.floor(scale);
    if (scale < 0.5) scale = 0.5;
    var sw = Math.floor(240 * scale);
    var sh = Math.floor(160 * scale);
    var bw = sw + BEZEL_PAD_X * 2;
    var bh = sh + BEZEL_HEAD + BEZEL_PAD_B;
    var bl = Math.round(areaL + (areaW - bw) / 2);
    var bt = Math.round(areaT + Math.max(0, areaH - bh) / 2);

    bezel.style.left = bl + "px";
    bezel.style.top = bt + "px";
    bezel.style.width = bw + "px";
    bezel.style.height = bh + "px";
    screenBox.style.left = BEZEL_PAD_X + "px";
    screenBox.style.top = BEZEL_HEAD + "px";
    screenBox.style.width = sw + "px";
    screenBox.style.height = sh + "px";

    // เก็บตำแหน่ง D-pad ไว้ใช้ตอนคำนวณทิศ (ไม่อ่าน layout ระหว่างเล่น)
    var r = dpadEl.getBoundingClientRect();
    dpadRect = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width };
  }

  var layoutTimer = 0;
  function layoutSoon() {
    applyOrientation();
    layout();
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(function () { applyOrientation(); layout(); }, 350); // iOS อัปเดตขนาดช้าหลังหมุนจอ
  }
  window.addEventListener("resize", layoutSoon, false);
  window.addEventListener("orientationchange", layoutSoon, false);

  // =========================================================
  // สถานะปุ่ม: รวมจากหลายแหล่ง (สัมผัส / เมาส์ / คีย์บอร์ด / จอย)
  // =========================================================
  var srcMask = { touch: 0, mouse: 0, kb: 0, pad: 0 };
  var curMask = 0;
  var dpadTouches = {}; // identifier → true ถ้านิ้วนั้นเริ่มบน D-pad
  var keyEls = {};
  keyEls[K.A] = $("btnA");
  keyEls[K.B] = $("btnB");
  keyEls[K.SELECT] = $("btnSelect");
  keyEls[K.START] = $("btnStart");
  keyEls[K.R] = $("btnR");
  keyEls[K.L] = $("btnL");
  var baseClass = {};
  (function () {
    for (var k in keyEls) baseClass[k] = keyEls[k].className;
  })();
  var DIR_BITS = (1 << K.RIGHT) | (1 << K.LEFT) | (1 << K.UP) | (1 << K.DOWN);
  var AB_BITS = (1 << K.A) | (1 << K.B);

  function applyMask() {
    var m = srcMask.touch | srcMask.mouse | srcMask.kb | srcMask.pad;
    var diff = m ^ curMask;
    if (!diff) return;
    for (var n = 0; n < 10; n++) {
      var bit = 1 << n;
      if (diff & bit) {
        var down = !!(m & bit);
        emu.key(n, down);
        var el = keyEls[n];
        if (el) el.className = baseClass[n] + (down ? " on" : "");
      }
    }
    if (diff & DIR_BITS) {
      var c = "";
      if (m & (1 << K.UP)) c += " u";
      if (m & (1 << K.DOWN)) c += " d";
      if (m & (1 << K.LEFT)) c += " l";
      if (m & (1 << K.RIGHT)) c += " r";
      dpadEl.className = c;
    }
    if (diff & AB_BITS) {
      $("btnAB").className = ((m & AB_BITS) === AB_BITS) ? "on" : "";
    }
    curMask = m;
  }

  function releaseAllInput() {
    srcMask.touch = srcMask.mouse = srcMask.kb = srcMask.pad = 0;
    dpadTouches = {};
    applyMask();
  }

  // D-pad 8 ทิศจากมุม atan2 (แต่ละทิศกว้าง 135° → ทแยงได้ 45°)
  function dpadBits(x, y) {
    if (!dpadRect) return 0;
    var dx = x - dpadRect.cx;
    var dy = y - dpadRect.cy;
    if (rotated) { var t = dx; dx = -dy; dy = t; } // แปลงพิกัดจอ → พิกัดของหน้าที่ถูกหมุน -90°
    if (dx * dx + dy * dy < 100) return 0; // จุดตายตรงกลาง ~10px
    var a = Math.atan2(dy, dx) * 180 / Math.PI; // -180..180, y ลง = บวก
    var m = 0;
    if (a > -67.5 && a < 67.5) m |= 1 << K.RIGHT;
    if (a > 112.5 || a < -112.5) m |= 1 << K.LEFT;
    if (a > 22.5 && a < 157.5) m |= 1 << K.DOWN;
    if (a < -22.5 && a > -157.5) m |= 1 << K.UP;
    return m;
  }

  // หาปุ่มจาก element (ไล่ขึ้นหา data-key / data-act / #dpad)
  function hit(el) {
    while (el && el !== player && el !== document.body) {
      if (el.id === "dpad") return { dpad: true };
      var k = el.getAttribute && el.getAttribute("data-key");
      if (k) {
        var parts = k.split(",");
        var m = 0;
        for (var i = 0; i < parts.length; i++) m |= 1 << (parts[i] | 0);
        return { mask: m };
      }
      var act = el.getAttribute && el.getAttribute("data-act");
      if (act) return { act: act, el: el };
      el = el.parentNode;
    }
    return null;
  }

  // =========================================================
  // จอยสัมผัสหลายนิ้ว
  // =========================================================
  function recomputeTouches(touches) {
    var m = 0;
    var rewHeld = false;
    for (var i = 0; i < touches.length; i++) {
      var t = touches[i];
      if (dpadTouches[t.identifier]) {
        m |= dpadBits(t.clientX, t.clientY);
      } else {
        var h = hit(document.elementFromPoint(t.clientX, t.clientY));
        if (h && h.mask) m |= h.mask;
        if (h && h.act === "rewind") rewHeld = true;
      }
    }
    if (rewinding && !rewHeld) endRewind();
    srcMask.touch = m;
    applyMask();
  }

  function onTouchStart(e) {
    e.preventDefault();
    var ch = e.changedTouches;
    for (var i = 0; i < ch.length; i++) {
      var t = ch[i];
      var h = hit(document.elementFromPoint(t.clientX, t.clientY));
      if (h && h.dpad) dpadTouches[t.identifier] = true;
      else if (h && h.act) doAct(h.act);
    }
    recomputeTouches(e.touches);
  }
  function onTouchMove(e) {
    e.preventDefault();
    recomputeTouches(e.touches);
  }
  function onTouchEnd(e) {
    var ch = e.changedTouches;
    for (var i = 0; i < ch.length; i++) delete dpadTouches[ch[i].identifier];
    e.preventDefault();
    unlockAudio(); // iOS ปลดล็อกเสียงได้ใน touchend
    recomputeTouches(e.touches);
  }
  player.addEventListener("touchstart", onTouchStart, { passive: false });
  player.addEventListener("touchmove", onTouchMove, { passive: false });
  player.addEventListener("touchend", onTouchEnd, { passive: false });
  player.addEventListener("touchcancel", onTouchEnd, { passive: false });
  // ระหว่างเล่น: กันหน้าเลื่อน/ซูม (ยกเว้นใน sheet/dialog ที่ต้องเลื่อนได้)
  document.addEventListener("touchmove", function (e) {
    if (document.body.className !== "playing") return;
    var el = e.target;
    while (el && el !== document.body) {
      if (el.id === "sheet" || el.id === "dlg") return;
      el = el.parentNode;
    }
    e.preventDefault();
  }, { passive: false });
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); }, false);

  // ตอนหมุนหน้า: เลื่อนรายการเองด้วย JS (การเลื่อนของ iOS 12 ในกล่องที่ถูกหมุนไม่แน่นอน)
  var scrollTouch = null;
  function findScroller(el) {
    while (el && el !== root) {
      if ((el.id === "library" || el.id === "sheet" || el.id === "dlg" || el.tagName === "TEXTAREA") &&
          el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentNode;
    }
    return null;
  }
  root.addEventListener("touchstart", function (e) {
    scrollTouch = null;
    if (!rotated || e.touches.length !== 1) return;
    var el = findScroller(e.target);
    if (!el) return;
    scrollTouch = { el: el, x: e.touches[0].clientX, top: el.scrollTop };
  }, { passive: true });
  root.addEventListener("touchmove", function (e) {
    if (!rotated || !scrollTouch) return;
    // หมุน -90°: แนวตั้งของเนื้อหา = แนวนอนของจอจริง
    scrollTouch.el.scrollTop = scrollTouch.top - (e.touches[0].clientX - scrollTouch.x);
    e.preventDefault();
  }, { passive: false });
  root.addEventListener("touchend", function () { scrollTouch = null; }, false);

  // ---------- เมาส์ (ทดสอบบนคอม) ----------
  var mouseDpad = false;
  player.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    var h = hit(e.target);
    if (!h) return;
    if (h.act) { doAct(h.act); return; }
    e.preventDefault();
    if (h.dpad) { mouseDpad = true; srcMask.mouse = dpadBits(e.clientX, e.clientY); }
    else srcMask.mouse = h.mask;
    applyMask();
  }, false);
  window.addEventListener("mousemove", function (e) {
    if (!mouseDpad) return;
    srcMask.mouse = dpadBits(e.clientX, e.clientY);
    applyMask();
  }, false);
  window.addEventListener("mouseup", function () {
    endRewind();
    mouseDpad = false;
    if (srcMask.mouse) { srcMask.mouse = 0; applyMask(); }
  }, false);

  // =========================================================
  // คีย์บอร์ด
  // =========================================================
  var KB = {
    ArrowRight: K.RIGHT, ArrowLeft: K.LEFT, ArrowUp: K.UP, ArrowDown: K.DOWN,
    Right: K.RIGHT, Left: K.LEFT, Up: K.UP, Down: K.DOWN,
    x: K.A, X: K.A, z: K.B, Z: K.B, a: K.L, A: K.L, s: K.R, S: K.R,
    Enter: K.START, Backspace: K.SELECT
  };
  var KB_CODE = { 39: K.RIGHT, 37: K.LEFT, 38: K.UP, 40: K.DOWN, 88: K.A, 90: K.B, 65: K.L, 83: K.R, 13: K.START, 8: K.SELECT };

  function kbKey(e) {
    var n = KB[e.key];
    if (n === undefined) n = KB_CODE[e.keyCode];
    return n;
  }
  function isTyping(e) {
    return e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
  }
  document.addEventListener("keydown", function (e) {
    var isEsc = e.key === "Escape" || e.key === "Esc" || e.keyCode === 27;
    if (isEsc && $("shotWrap").className === "") { e.preventDefault(); $("shotClose").click(); return; }
    if (isEsc && dlgOpen) { e.preventDefault(); closeDialog(); return; }
    if (isEsc && sheetOpen) { e.preventDefault(); closeSheet(); return; }
    if (isTyping(e) || dlgOpen || sheetOpen || !cur) return;
    if (e.key === " " || e.key === "Spacebar" || e.keyCode === 32) {
      e.preventDefault();
      if (!e.repeat) doAct("fast");
      return;
    }
    if (isEsc) {
      e.preventDefault();
      if (!e.repeat) doAct("menu");
      return;
    }
    var n = kbKey(e);
    if (n === undefined) return;
    e.preventDefault();
    srcMask.kb |= 1 << n;
    applyMask();
  }, false);
  document.addEventListener("keyup", function (e) {
    if (isTyping(e)) return;
    var n = kbKey(e);
    if (n === undefined) return;
    if (srcMask.kb & (1 << n)) {
      e.preventDefault();
      srcMask.kb &= ~(1 << n);
      applyMask();
    }
  }, false);
  window.addEventListener("blur", releaseAllInput, false);

  // =========================================================
  // Gamepad (เฉพาะเครื่องที่รองรับ) — poll เฉพาะตอนมีจอยต่ออยู่
  // =========================================================
  var padPolling = false;
  var padPrevFast = false;
  var padPrevMenu = false;
  // mapping มาตรฐาน: 0=ล่าง 1=ขวา 2=ซ้าย 3=บน 4/6=L 5/7=R 8=Select 9=Start 12-15=D-pad 16=Home
  var PAD_MAP = [K.B, K.A, K.B, K.A, K.L, K.R, K.L, K.R, K.SELECT, K.START, -1, -1, K.UP, K.DOWN, K.LEFT, K.RIGHT];

  function pressed(b) { return b && (typeof b === "object" ? (b.pressed || b.value > 0.5) : b > 0.5); }

  function pollPads() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var m = 0, any = false, fast = false, menu = false;
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p || !p.connected) continue;
      any = true;
      for (var b = 0; b < PAD_MAP.length && b < p.buttons.length; b++) {
        if (PAD_MAP[b] >= 0 && pressed(p.buttons[b])) m |= 1 << PAD_MAP[b];
      }
      if (p.buttons.length > 16 && pressed(p.buttons[16])) menu = true;
      if (p.buttons.length > 11 && pressed(p.buttons[11])) fast = true; // คลิกสติ๊กขวา = เร่ง
      if (p.axes.length >= 2) {
        if (p.axes[0] < -0.5) m |= 1 << K.LEFT;
        if (p.axes[0] > 0.5) m |= 1 << K.RIGHT;
        if (p.axes[1] < -0.5) m |= 1 << K.UP;
        if (p.axes[1] > 0.5) m |= 1 << K.DOWN;
      }
    }
    if (sheetOpen || dlgOpen || !cur) m = 0;
    else {
      if (fast && !padPrevFast) doAct("fast");
      if (menu && !padPrevMenu) doAct("menu");
    }
    padPrevFast = fast;
    padPrevMenu = menu;
    if (m !== srcMask.pad) { srcMask.pad = m; applyMask(); }
    if (any) requestAnimationFrame(pollPads);
    else { padPolling = false; srcMask.pad = 0; applyMask(); }
  }
  if (navigator.getGamepads) {
    window.addEventListener("gamepadconnected", function () {
      toast("เชื่อมต่อจอยแล้ว");
      if (!padPolling) { padPolling = true; requestAnimationFrame(pollPads); }
    }, false);
  }

  // =========================================================
  // ชิป: เมนู / ย้อนเวลา / เร่งความเร็ว
  // =========================================================
  var fast = false;
  function setFast(on) {
    fast = !!on;
    emu.setSpeed(fast ? prefs.fastSpeed : 1);
    emu.setAudioMuted(fast); // ปิดเสียงตอนเร่ง
    $("chipFast").className = "chip" + (fast ? " on" : "");
  }

  function doAct(act) {
    if (!cur) return;
    if (act === "fast") {
      setFast(!fast);
      toast(fast ? "เร่งความเร็ว x" + prefs.fastSpeed : "ความเร็วปกติ");
    } else if (act === "rewind") {
      beginRewind();
    } else if (act === "menu") {
      openGameMenu();
    }
  }
  $("chipRew").className = "chip" + (prefs.rewind ? "" : " off");

  // =========================================================
  // เสียง: ปลดล็อกด้วยการแตะ/คลิก/กดปุ่มครั้งแรก
  // =========================================================
  var audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = emu.unlockAudio();
  }
  document.addEventListener("touchend", unlockAudio, false);
  document.addEventListener("click", unlockAudio, false);
  document.addEventListener("keydown", unlockAudio, false);

  // =========================================================
  // ซ่อนแอป → หยุดเกม บันทึกเซฟ พักเสียง
  // =========================================================
  var autoPaused = false;
  var hideSaved = false;
  function onHide() {
    releaseAllInput();
    endRewind(true);
    if (emu.running) { autoPaused = true; emu.stop(); } // pause → export เซฟ
    // ช่องอัตโนมัติ: iOS อาจปิดแอปทิ้งระหว่างอยู่เบื้องหลัง (ครั้งเดียวต่อการซ่อน)
    if (cur && !hideSaved) {
      hideSaved = true;
      writeState("auto").catch(function () { /* ไม่เป็นไร */ });
    }
    emu.suspendAudio();
  }
  function onShow() {
    hideSaved = false;
    emu.resumeAudio();
    if (autoPaused && cur && !userPaused && !sheetOpen) emu.start();
    autoPaused = false;
    layoutSoon();
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) onHide(); else onShow();
  }, false);
  window.addEventListener("pagehide", onHide, false);

  // =========================================================
  // เริ่ม
  // =========================================================
  // สำหรับทดสอบอัตโนมัติ
  window.pbxApp = {
    version: VERSION,
    emu: emu,
    addRomBytes: function (u8, name) { return addRomBytes(u8, name).then(function (r) { renderLibrary(); return r; }); },
    play: playRom,
    exit: exitGame,
    index: function () { return romIndex; },
    writeState: function (slot) { return writeState(slot); },
    readState: function (slot) { return readState(slot); },
    rewind: { begin: function () { beginRewind(); }, end: function () { endRewind(); }, ring: function () { return ring; } },
    layout: layout,
    eco: function () { return { mode: prefs.eco, level: ecoLevel() }; },
    rotated: function () { return rotated; }
  };

  // ออฟไลน์: Service Worker (iOS 11.3+)
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch(function () { /* ไม่เป็นไร */ });
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (hadController) toast("อัปเดตแอปแล้ว · ปิดแล้วเปิดแอปใหม่เพื่อใช้เวอร์ชันล่าสุด", 5000);
    });
  }

  if (navigator.storage && navigator.storage.persist) {
    try { navigator.storage.persist(); } catch (e) { /* ไม่เป็นไร */ }
  }

  DB.getSetting("romIndex", []).then(function (list) {
    romIndex = list || [];
    renderLibrary();
  }).catch(function (err) {
    renderLibrary();
    dialog({ title: "เปิดฐานข้อมูลไม่ได้", text: err.message + "\nถ้าเปิดในโหมดส่วนตัว (Private) ให้ปิดโหมดนี้ก่อน" });
  });
  applyOrientation();
  renderLibrary();
})();
