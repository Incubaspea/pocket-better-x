# PROMPTS — คำสั่งสำหรับ Claude Code ทีละเฟส

คัดลอกไปวางทีละเฟส รอให้แต่ละเฟสเสร็จและทดสอบผ่านก่อนค่อยวางเฟสถัดไป

---

## เฟส 0 — อ่านและวางแผน
```text
อ่าน CLAUDE.md, docs/SPEC.md, vendor/IodineGBA/LOAD-ORDER.txt และดูภาพใน design/
สรุปสั้น ๆ ว่าจะสร้างอะไร มีข้อจำกัดของ Safari 12 อะไรบ้าง และลำดับการเรียก API ของ IodineGBA ที่ทดลองแล้วว่าทำงาน
ยังไม่ต้องเขียนโค้ด
```

## เฟส 1 — ทดสอบแกนจำลองให้ทำงานก่อน (ยังไม่ต้องทำ UI)
```text
ทำเฟส 1:
- คัดลอก vendor/IodineGBA/core, includes, glue ไปไว้ที่ core/ และคัดลอก bios ไปไว้ที่ bios/
- สร้าง test.html ที่โหลดสคริปต์ตาม LOAD-ORDER.txt + GfxGlueCode + AudioGlueCode + XAudioJS
- เขียน js/emu.js เป็นคลาส PBX ที่ห่อ IodineGBA ตามลำดับ API ใน CLAUDE.md
  มีฟังก์ชัน load(biosU8, romU8), start(), stop(), key(n, down), setSpeed(x), onSpeed(cb), onSaveExport(cb), setSaveImport(fn), destroy()
- ทดสอบด้วย Playwright: โหลด vendor/test-roms/memory.gba แล้วแคปจอ ต้องเห็น "All tests passed" และความเร็วประมาณ 100%
- ทดสอบเสียงด้วย webkitAudioContext fallback (ปลดล็อกเสียงด้วยการแตะครั้งแรก)
ตรวจไวยากรณ์ ES2018 ด้วย acorn
```

## เฟส 2 — ตัวเครื่องและการควบคุม
```text
ทำเฟส 2:
- index.html + css/style.css: ตัวเครื่องแนวนอนตาม design/01-player-landscape.png (D-pad, A/B สีคอรัล, L/R, Start/Select, ชิปเมนู/⏪/▶▶, กรอบจอ PWR, แบรนด์ POCKET BETTER X)
  และทำแนวตั้งตาม SPEC ข้อ 2
- ฟังก์ชัน layout(): คำนวณขนาดจอ 240x160 ให้ใหญ่ที่สุดที่ไม่ทับปุ่ม และปรับใหม่เมื่อ resize/orientationchange
- จอยสัมผัสแบบหลายนิ้วตาม SPEC ข้อ 3 (ใช้ index loop กับ TouchList, preventDefault, เก็บว่านิ้วไหนเริ่มบน D-pad, มีจุดกด A+B)
- คีย์บอร์ด + Gamepad
ห้ามใช้ CSS ต้องห้าม (inset, flex gap, aspect-ratio) แคปหน้าจอ 667x375 และ 375x667 มาให้ดู
```

## เฟส 3 — คลังเกม, BIOS และเซฟ
```text
ทำเฟส 3:
- js/db.js (IndexedDB ตาม SPEC ข้อ 5)
- หน้าคลังเกม: ＋ เพิ่มเกม (.gba, และ .zip ถ้าใส่ fflate), การ์ดเกม, ปุ่ม ⋯ (เล่น / นำเข้า .sav / สำรองเป็นข้อความ / เปลี่ยนชื่อ / ลบ)
- BIOS: ค่าเริ่มต้นใช้ Cult-of-GBA และมีตัวเลือก “ใช้ BIOS ของฉัน” (ตรวจว่าขนาด = 16384)
- เซฟในตลับ: export/import ผ่าน handler ของ IodineGBA และบันทึกอัตโนมัติทุก 30 วินาที + ตอน visibilitychange/pagehide
- สำรองและกู้คืนแบบข้อความ (base64 JSON + ปุ่มคัดลอก + หน้าวางข้อความ)
ทดสอบ: ใช้ ROM ทดสอบ แล้วตรวจว่ามีข้อมูลใน store saves และ reload แล้วโหลดเซฟกลับได้
```

## เฟส 4 — เมนูในเกม
```text
ทำเฟส 4: Bottom sheet ตาม SPEC ข้อ 4
(ความเร็ว x2/x3 แบบปิดเสียงตอนเร่ง, เสียง, แสดง %, สเกลจำนวนเต็ม, ภาพหน้าจอ (iOS 12 ให้แสดงภาพให้กดค้างบันทึก), นำเข้า .sav, รีเซ็ต, ออกจากเกม)
และหยุดเกมทุกครั้งที่เปิดเมนู
```

## เฟส 5 — Save State (ทดลอง)
```text
ทำเฟส 5 ตาม SPEC ข้อ 6: ลอง serialize I.IOCore เป็นข้อมูลไบนารี (typed arrays + ตัวเลข) แล้วโหลดกลับ
ทำ 4 ช่อง + ช่องอัตโนมัติตอนออกเกม แล้วทดสอบว่าโหลดกลับแล้วเกมเล่นต่อได้จริง 3 ครั้งติด
ถ้าไม่เสถียร ให้ปิดฟีเจอร์นี้ แจ้งผม และระบุใน README
```

## เฟส 6 — ออฟไลน์, ตรวจงาน และ deploy
```text
ทำเฟส 6:
- sw.js (precache รวม core/, bios/, ไอคอน) + manifest + ลงทะเบียน SW
- ตรวจเงื่อนไขผ่านงาน SPEC ข้อ 8 ให้ครบทุกข้อ รวมการทดสอบออฟไลน์
- grep หา JS และ CSS ต้องห้ามอีกครั้ง และตรวจว่าไม่มีไฟล์ test-roms หรือ BIOS ของ Nintendo อยู่ในโฟลเดอร์ที่จะ deploy
- เขียน README.md ภาษาไทย (วิธีติดตั้ง, เรื่อง BIOS, ข้อจำกัดบน iOS 12, ใส่ license ของ IodineGBA / Cult-of-GBA / XAudioJS)
- git init, commit, สร้าง repo สาธารณะ pocket-better-x ด้วย gh, push และเปิด GitHub Pages:
  gh api -X POST repos/{owner}/pocket-better-x/pages -f "source[branch]=main" -f "source[path]=/"
  ระวังอย่าให้ vendor/test-roms ถูก deploy (ใส่ใน .gitignore หรือลบออก)
- บอก URL ที่ได้
```

---

## Prompt แก้ปัญหาบน iPhone 6
```text
บน iPhone 6 (iOS 12.5.8) เจออาการ: <อธิบาย เช่น จอดำ / ความเร็วแค่ 45% / ไม่มีเสียง>
ตรวจหาสาเหตุที่เกี่ยวกับ Safari 12 ตามรายการต้องห้ามใน CLAUDE.md แล้วแก้ไข
ถ้าเป็นเรื่องความเร็ว ให้ทำโหมดประหยัดตาม SPEC ข้อ 9 แล้วเพิ่มเลข CACHE_VERSION
```
