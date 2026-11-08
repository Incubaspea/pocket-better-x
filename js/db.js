/*
 * POCKET BETTER X — db.js
 * IndexedDB "pocket-better-x" v1
 *   roms     {id, name, title, code, size, data, added, lastPlayed, thumb}
 *   saves    {id, data, type, time}            (id = romId)
 *   states   {key, romId, slot, data, thumb, time}
 *   settings {key, value}
 * หมายเหตุ: รายการเกม (ไม่รวม data) ถูกเก็บซ้ำไว้ใน settings "romIndex"
 * เพื่อให้หน้าคลังไม่ต้องโหลด ROM ขนาดหลาย MB ทุกเกมเข้าหน่วยความจำ (iPhone 6 มี RAM 1 GB)
 * ES2018 / Safari 12
 */
(function (global) {
  "use strict";

  var DB_NAME = "pocket-better-x";
  var DB_VER = 1;
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var idb = global.indexedDB || global.webkitIndexedDB;
      if (!idb) { reject(new Error("เบราว์เซอร์นี้ไม่มี IndexedDB")); return; }
      var req;
      try { req = idb.open(DB_NAME, DB_VER); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("roms")) db.createObjectStore("roms", { keyPath: "id" });
        if (!db.objectStoreNames.contains("saves")) db.createObjectStore("saves", { keyPath: "id" });
        if (!db.objectStoreNames.contains("states")) {
          var st = db.createObjectStore("states", { keyPath: "key" });
          st.createIndex("romId", "romId", { unique: false });
        }
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () { db.close(); dbp = null; };
        resolve(db);
      };
      req.onerror = function () { dbp = null; reject(req.error || new Error("เปิดฐานข้อมูลไม่ได้")); };
      req.onblocked = function () { /* รอแท็บอื่นปิด */ };
    });
    return dbp;
  }

  // ทำงานใน transaction เดียว; fn(stores) คืน IDBRequest (หรือไม่คืนก็ได้)
  function tx(storeNames, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t;
        try { t = db.transaction(storeNames, mode); } catch (e) { reject(e); return; }
        var names = typeof storeNames === "string" ? [storeNames] : storeNames;
        var stores = {};
        for (var i = 0; i < names.length; i++) stores[names[i]] = t.objectStore(names[i]);
        var req = fn(stores, t);
        var result;
        if (req && "onsuccess" in req) {
          req.onsuccess = function () { result = req.result; };
        } else {
          result = req;
        }
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error || new Error("ฐานข้อมูลผิดพลาด")); };
        t.onabort = function () { reject(t.error || new Error("ฐานข้อมูลถูกยกเลิก (พื้นที่เต็ม?)")); };
      });
    });
  }

  var DB = {
    open: open,
    get: function (store, key) {
      return tx(store, "readonly", function (s) { return s[store].get(key); });
    },
    put: function (store, value) {
      return tx(store, "readwrite", function (s) { return s[store].put(value); });
    },
    del: function (store, key) {
      return tx(store, "readwrite", function (s) { return s[store].delete(key); });
    },
    // อ่านทุกแถว (ใช้กับ store ที่ไม่ใหญ่ เช่น saves)
    all: function (store) {
      return tx(store, "readonly", function (s) {
        var out = [];
        var req = s[store].openCursor();
        req.onsuccess = function () {
          var c = req.result;
          if (c) { out.push(c.value); c.continue(); }
        };
        return out;
      });
    },
    getSetting: function (key, def) {
      return DB.get("settings", key).then(function (r) { return r ? r.value : def; });
    },
    setSetting: function (key, value) {
      return DB.put("settings", { key: key, value: value });
    },
    delSetting: function (key) {
      return DB.del("settings", key);
    },
    // ลบเกม + เซฟ + สถานะของเกมนั้นใน transaction เดียว
    deleteRom: function (romId) {
      return tx(["roms", "saves", "states", "settings"], "readwrite", function (s) {
        s.roms.delete(romId);
        s.saves.delete(romId);
        s.settings.delete("states:" + romId);
        var req = s.states.index("romId").openCursor(romId);
        req.onsuccess = function () {
          var c = req.result;
          if (c) { c.delete(); c.continue(); }
        };
      });
    }
  };

  global.DB = DB;
})(window);
