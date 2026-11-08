# CLAUDE.md — POCKET BETTER X (GBA emulator Starter Kit)

You are building **POCKET BETTER X**, an offline web emulator (PWA) for `.gba` games, from scratch in this folder.
Read `docs/SPEC.md` first, then follow `docs/PROMPTS.md` **one phase at a time**. After each phase, summarise what you did and wait for the user to tell you to continue.

## Target device (most important)
- **iPhone 6 (A8 chip, 1 GB RAM), iOS 12.5.8, Safari 12.1**, added to the Home Screen and played in **landscape**.
- It must also run on desktop Chrome/Safari for testing.
- Performance on the iPhone 6 has not been measured yet. Design for speed (see SPEC section 9) and show the speed % on screen.

## What's already in vendor/ (verified)
| Path | What it is | License |
|---|---|---|
| `vendor/IodineGBA/core`, `includes` | JavaScript GBA emulator core (Grant Galitz) | MIT (`LICENSE-IodineGBA.md`) |
| `vendor/IodineGBA/LOAD-ORDER.txt` | **The script load order that works** (from the original index.html) | — |
| `vendor/IodineGBA/glue/GfxGlueCode.js` | Blitter that draws the 240×160 frame onto a canvas | MIT |
| `vendor/IodineGBA/glue/AudioGlueCode.js`, `XAudioJS/` | Audio output (XAudioJS is public domain) | MIT / PD |
| `vendor/bios/cult-of-gba-bios.bin` | **Open-source replacement BIOS, 16 KB** (Cult-of-GBA) | MIT |
| `vendor/test-roms/*.gba` | jsmolka/gba-tests test ROMs (for testing only — do not ship them in the app) | MIT |

All vendor JS already parses as ES2018 (checked with acorn).

### Verified test results (desktop Chromium)
- Core + Cult-of-GBA BIOS boots and runs at **~100%** speed in main-thread mode.
- `memory.gba` → "All tests passed". `arm.gba` fails test 223 and `thumb.gba` fails test 227 (core accuracy limits), so some games may have glitches. Let the user supply their own BIOS dump.
- The 220-byte `bios.bin` from gbajs **does not work** with IodineGBA (it's only a stub). Don't use it.

### API sequence that works (do not change the order)
```js
var I = new GameBoyAdvanceEmulator();
I.toggleOffthreadGraphics(false);          // iOS 12 has no SharedArrayBuffer/Atomics — must run on the main thread
I.attachPlayStatusHandler(function (on) {}); // must be attached BEFORE play(), otherwise TypeError
I.attachSpeedHandler(function (pct) {});    // receives speed %
var gfx = new GfxGlueCode(240, 160); gfx.attachCanvas(canvas); I.attachGraphicsFrameHandler(gfx);
I.attachBIOS(biosU8); I.attachROM(romU8);
I.toggleSkipBootROM(true);
I.play();
var t0 = Date.now();
setInterval(function () { I.timerCallback((Date.now() - t0) >>> 0); }, 16);
// keys: I.keyDown(n) / I.keyUp(n), n = 0..9 → A,B,Select,Start,Right,Left,Up,Down,R,L
// saves: I.attachSaveExportHandler(fn(name, data)), I.attachSaveImportHandler(fn(name, onLoaded, onFail))
// speed: I.setSpeed(x) (1 = normal)  pause: I.pause()  reset: I.restart()
```
(The key numbers are bits of the GBA KEYINPUT register, verified against `core/JoyPad.js`.)

## Safari 12 rules (if you break these, the app won't run on the real phone)
**Forbidden JS:** `?.`, `??`, `??=`, class fields, BigInt, `Blob.arrayBuffer()` (use FileReader), `structuredClone`, `.at()`, `replaceAll`, `Promise.allSettled`, `scrollIntoView({...})`, `for...of` over TouchList (use an index loop), SharedArrayBuffer/Atomics/Worker for the core.
**Forbidden CSS:** `inset`, `gap` in flexbox (use margins), `aspect-ratio`, `:has()`, `touch-action: none` (call preventDefault in listeners registered with `{passive:false}` instead).
**Audio:** `window.AudioContext || window.webkitAudioContext`, unlocked by the first touch.
**Files:** iOS 12 can't save files into the Files app from a web page, so exporting saves = "back up as text" (base64 JSON + a copy button + restore by pasting). Importing via `<input type=file>` works normally.
**Syntax check after every phase:**
```bash
npm i -D acorn && node -e "const a=require('acorn'),fs=require('fs');for(const f of ['js/app.js','js/db.js','sw.js'])a.parse(fs.readFileSync(f,'utf8'),{ecmaVersion:2018});console.log('ES2018 OK')"
```

## Design and legal rules
- Original design (see `design/01-player-landscape.png`): a navy landscape handheld with coral A/B buttons. **It must not look like a Game Boy Advance**, and must not use Nintendo's name, logo, or the "GAME BOY" wordmark anywhere.
- The app must not include any game ROMs or a Nintendo BIOS. The user brings their own files.
- All UI text is in Thai.

## Working conventions
- Always deliver complete files. Bump `CACHE_VERSION` in `sw.js` and `VERSION` in `js/app.js` together on every deploy.
- Test locally with `python3 -m http.server 8080`. If you use Playwright, test with the `iPhone 8 landscape` profile (667×375).
