/*
 * POCKET BETTER X — sw.js
 * precache ทุกไฟล์ของแอป (รวม core/ และ BIOS) แบบ cache-first และลบแคชเก่า
 * ต้องเพิ่ม CACHE_VERSION พร้อมกับ VERSION ใน js/app.js ทุกครั้งที่ deploy
 */
var CACHE_VERSION = "pbx-0.7.0";

var FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/app.js",
  "js/db.js",
  "js/emu.js",
  "bios/cult-of-gba-bios.bin",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "core/includes/TypedArrayShim.js",
  "core/Cartridge.js",
  "core/DMA.js",
  "core/Emulator.js",
  "core/Graphics.js",
  "core/RunLoop.js",
  "core/Memory.js",
  "core/IRQ.js",
  "core/JoyPad.js",
  "core/Serial.js",
  "core/Sound.js",
  "core/Timer.js",
  "core/Wait.js",
  "core/CPU.js",
  "core/Saves.js",
  "core/sound/FIFO.js",
  "core/sound/Channel1.js",
  "core/sound/Channel2.js",
  "core/sound/Channel3.js",
  "core/sound/Channel4.js",
  "core/CPU/ARM.js",
  "core/CPU/THUMB.js",
  "core/CPU/CPSR.js",
  "core/graphics/Renderer.js",
  "core/graphics/RendererShim.js",
  "core/graphics/RendererProxy.js",
  "core/graphics/BGTEXT.js",
  "core/graphics/BG2FrameBuffer.js",
  "core/graphics/BGMatrix.js",
  "core/graphics/AffineBG.js",
  "core/graphics/ColorEffects.js",
  "core/graphics/Mosaic.js",
  "core/graphics/OBJ.js",
  "core/graphics/OBJWindow.js",
  "core/graphics/Window.js",
  "core/graphics/Compositor.js",
  "core/memory/DMA0.js",
  "core/memory/DMA1.js",
  "core/memory/DMA2.js",
  "core/memory/DMA3.js",
  "core/cartridge/SaveDeterminer.js",
  "core/cartridge/SRAM.js",
  "core/cartridge/FLASH.js",
  "core/cartridge/EEPROM.js",
  "core/cartridge/GPIO.js",
  "core/glue/GfxGlueCode.js",
  "core/glue/XAudioJS/resampler.js",
  "core/glue/XAudioJS/XAudioServer.js",
  "core/glue/AudioGlueCode.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // cache: "reload" กันได้ไฟล์เก่าจาก HTTP cache ของเบราว์เซอร์
      return Promise.all(FILES.map(function (url) {
        return fetch(new Request(url, { cache: "reload" })).then(function (res) {
          if (!res.ok) throw new Error("precache ไม่สำเร็จ: " + url);
          return cache.put(url, res);
        });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VERSION && k.indexOf("pbx-") === 0) return caches.delete(k);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // หน้าเว็บ: หน้าที่ขอ (จากแคช ไม่สน ?query) → เน็ต → index.html ตอนออฟไลน์
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || fetch(req).catch(function () {
          return caches.match("index.html");
        });
      })
    );
    return;
  }

  // cache-first
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || fetch(req);
    })
  );
});
