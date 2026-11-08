# SPEC — POCKET BETTER X v1.0 (เล่นเกม .gba)

PWA ตัวจำลองเกม .gba แบบออฟไลน์ สำหรับ iPhone 6 (iOS 12.5.8) เล่นในแนวนอนเป็นหลัก

---

## 1. โครงสร้างไฟล์ที่ต้องได้
```
index.html  manifest.webmanifest  sw.js  README.md
css/style.css
js/app.js        (UI, คลังเกม, เมนู, การควบคุม)
js/emu.js        (ตัวห่อ IodineGBA: start/stop/keys/speed/saves/state)
js/db.js         (IndexedDB)
js/fflate.min.js (ไม่บังคับ: npm pack fflate ใช้แตกไฟล์ .zip เลือกเฉพาะไฟล์ build UMD)
core/            (คัดลอกจาก vendor/IodineGBA/core + includes + glue)
bios/cult-of-gba-bios.bin
icons/
```

## 2. หน้าตา
**แนวนอน 667×375 (หน้าหลักตอนเล่น)** ดูภาพ `design/01-player-landscape.png`
- ตัวเครื่องสีกรมท่า `#22304f` → `#18223a` มีแสงไฮไลต์มุมบนซ้าย
- จอ 240×160 อยู่กลาง ขยายให้ใหญ่ที่สุดที่ไม่ทับปุ่ม ใช้สเกลจำนวนเต็มได้ถ้าเปิดในตั้งค่า ใช้ `image-rendering: pixelated` ล้อมด้วยกรอบจอ `#10141d` มีไฟ PWR และชื่อเกม
- ซ้าย: D-pad สีเข้ม `#151a26` ขนาดประมาณ 120px
- ขวา: ปุ่ม A และ B กลมสีคอรัล `#ff6b4a` ขนาด 60px วางเฉียงโดย A อยู่สูงกว่า และมีจุดกด A+B พร้อมกันตรงกลาง
- มุมบนซ้ายและขวา: ปุ่มไหล่ **L** และ **R** แบบแคปซูลยาว
- ด้านบนตรงกลาง: ชิป ☰ เมนู · ⏪ ย้อนเวลา (ถ้าทำได้) · ▶▶ เร่งความเร็ว
- ด้านล่างขวา: Select และ Start · ด้านล่างกลาง: ชื่อแบรนด์ “POCKET *BETTER* X” · ด้านล่างซ้าย: ลายรูลำโพง
- มุมจอมีตัวเลขความเร็ว (%) เปิด/ปิดได้

**แนวตั้ง:** จอด้านบน และปุ่มทั้งหมดอยู่ด้านล่าง แบบเดียวกับ `design/03-menu-style.png` และย้าย L/R ไปไว้เหนือ D-pad และปุ่ม A/B
**คลังเกม:** การ์ดเกมแบบกริด ปุ่ม ＋ เพิ่มเกม และปุ่ม ⋯ ต่อเกม ดูตัวอย่างสไตล์ใน `design/02-library-style.png` (ภาพจากแอป GB ตระกูลเดียวกัน)

## 3. การควบคุม
- จอยแบบสัมผัสรองรับหลายนิ้ว: ฟัง touchstart/move/end บนพื้นที่ปุ่มทั้งหมด หาปุ่มด้วย `elementFromPoint` และ D-pad ใช้ 8 ทิศจากมุม `atan2`
- นิ้วที่เริ่มกดบน D-pad ให้ถือเป็นการกด D-pad ต่อไปจนยกนิ้ว ลากนิ้วระหว่าง A กับ B ได้
- คีย์บอร์ด: ลูกศร, X = A, Z = B, A = L, S = R, Enter = Start, Backspace = Select, Space = เร่งความเร็ว, Esc = เมนู
- จอย Bluetooth (Gamepad API): ทำเฉพาะเมื่อเครื่องรองรับ
- ต้องเรียก `preventDefault` ทุก touch ในพื้นที่ปุ่ม เพื่อกันจอเลื่อนหรือซูม

## 4. เมนูในเกม (Bottom sheet แบบ Delta)
บันทึกสถานะ (ถ้าแกนรองรับ ดูข้อ 6) · โหลดสถานะ · ความเร็ว x2/x3 (เวลาเร่งให้ปิดเสียง) · เสียง เปิด/ปิด · แสดงความเร็ว % · สเกลจำนวนเต็ม · ภาพหน้าจอ (บน iOS 12 ให้แสดงภาพเพื่อกดค้างแล้วบันทึก) · สำรองเซฟเป็นข้อความ · นำเข้า .sav · รีเซ็ต · ออกจากเกม

## 5. คลังเกมและไฟล์
- นำเข้า `.gba` (และ `.zip` ถ้าใส่ fflate) ผ่าน `<input type=file multiple>` อ่านไฟล์ด้วย FileReader
- อ่านชื่อเกมจาก header (offset 0xA0, 12 ตัวอักษร) และรหัสเกมจาก 0xAC (4 ตัวอักษร) ใช้ id = hash ของไฟล์
- BIOS: ค่าเริ่มต้นใช้ `bios/cult-of-gba-bios.bin` ในตั้งค่ามีเมนู “ใช้ BIOS ของฉัน (16KB)” ให้นำเข้าไฟล์ BIOS ที่ดัมพ์เอง (ตรวจว่าขนาด = 16384) เก็บใน IndexedDB และสลับกลับเป็นค่าเริ่มต้นได้
- IndexedDB `pocket-better-x` v1 มี store: `roms` {id, name, title, code, size, data, added, lastPlayed, thumb}, `saves` {id, data, type, time}, `states` {key, romId, slot, data, thumb, time}, `settings` {key, value} สำหรับ BIOS ที่ผู้ใช้นำเข้า
- เซฟในตลับ: IodineGBA จะเรียก saveExportHandler(name, data) ตอน pause และ handler ชื่อ "TYPE_"+name สำหรับชนิดเซฟ ให้เก็บทั้งสองอย่างตาม romId ตอนเปิดเกมให้ป้อนกลับผ่าน saveImportHandler และให้เรียก `I.pause()` → `I.play()` (หรือ export เซฟ) ทุก 30 วินาทีและตอน visibilitychange/pagehide เพื่อบันทึกเซฟ
- สำรองเป็นข้อความ: JSON `{app:"POCKET BETTER X", v:1, saves:[{id,name,type,data(base64)}]}` มีปุ่มคัดลอก (execCommand('copy')) และหน้าวางข้อความเพื่อกู้คืน

## 6. Save State
- IodineGBA ไม่มี API บันทึก/โหลดสถานะสำเร็จรูป ให้ลองทำในเฟส 5 ด้วยการ serialize ออบเจกต์ `I.IOCore` (คัดลอก typed arrays และ field ที่เป็นตัวเลข/boolean แบบ recursive แล้วข้ามฟังก์ชันและ reference วนซ้ำ)
- ถ้าทำแล้วไม่เสถียร ให้ตัดฟีเจอร์นี้ออกและแจ้งใน README ไม่ต้องฝืน

## 7. ออฟไลน์และการติดตั้ง
- `sw.js` precache ทุกไฟล์รวม bios ใช้แบบ cache-first และลบแคชเก่า
- meta tag สำหรับ iOS, apple-touch-icon, viewport-fit=cover, safe-area และ `user-scalable=no`
- เมื่อแอปถูกซ่อน (`visibilitychange` hidden): หยุดเกม บันทึกเซฟ และ suspend เสียง

## 8. เงื่อนไขผ่านงาน
1. ผ่านการตรวจไวยากรณ์ ES2018 และไม่มี CSS ต้องห้าม
2. `vendor/test-roms/memory.gba` แสดง “All tests passed” ในแอป (ใช้แค่ตอนทดสอบ)
3. ความเร็วประมาณ 100% บนคอม และตัวเลข % แสดงบนจอ
4. แตะปุ่มหลายนิ้วพร้อมกันได้ และ L/R ทำงาน
5. ตรวจว่าเซฟถูกเขียนลง IndexedDB และหลัง reload กลับมาเล่นต่อได้
6. ปิดเน็ตแล้ว reload ยังเปิดแอปได้
7. ระบบสำรอง/กู้คืนเป็นข้อความทำงาน

## 9. เรื่องความเร็วบน iPhone 6
- ใช้ main thread อย่างเดียว ไม่ทำงานซ้ำซ้อนในแต่ละเฟรม และห้ามใช้ CSS filter/blur ตอนกำลังเล่น
- ตั้งค่า: “โหมดประหยัด” ข้ามการวาด 1 ใน 2 เฟรม (frameskip) ถ้าแกนรองรับ หรือลดความถี่การวาดใน GfxGlueCode
- ใช้ `timerIntervalRate` 16ms และให้ dynamicSpeed ของแกนปรับเอง
- แสดงความเร็ว % เพื่อให้ผู้ใช้รายงานผลบนเครื่องจริงได้
