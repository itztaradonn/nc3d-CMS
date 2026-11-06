# NC3D — 3D Color Customizer + CMS

Customers pick a model, choose a color for every part, spin it in 3D, and tap **Order on Facebook**. The design details get copied so they can paste them into your Messenger chat. There's no cart and no payment.

- 3MF models (works with Bambu Studio, OrcaSlicer, PrusaSlicer, multi-part files)
- Admin panel: logo, favicon, site name, texts (TH/EN), theme colors, Facebook/Messenger link, color library, models, color zones, thumbnails, password, backup
- No database, no Node, no Composer, no cron, no SSH needed. Plain PHP + files.

---

## 🇹🇭 วิธีติดตั้งบน DirectAdmin (ruk-com)

1. ดาวน์โหลดโปรเจกต์เป็น ZIP (GitHub → Code → Download ZIP)
2. เข้า DirectAdmin → **File Manager** → เปิดโฟลเดอร์ `domains/โดเมนของคุณ/public_html`
3. อัปโหลด ZIP แล้วกด **Extract** ให้ไฟล์ `index.html`, `admin/`, `assets/` ฯลฯ อยู่ใน `public_html` โดยตรง (ถ้าแตกแล้วได้โฟลเดอร์ซ้อนอยู่ ให้ย้ายไฟล์ออกมา)
4. ตั้ง permission (ปกติใช้ได้เลย): โฟลเดอร์ `data`, `uploads`, `uploads/models`, `uploads/images`, `private` เป็น **755** และไฟล์ `data/content.json` เป็น **644**
5. เปิด `https://โดเมนของคุณ/admin/` → ระบบจะพาไปหน้า Setup → ตั้งรหัสผ่านแอดมิน
6. เสร็จ! เข้าแท็บต่าง ๆ เพื่อแก้โลโก้ ข้อความ ลิงก์ Facebook สี และเพิ่มโมเดลได้เลย

**ไฟล์ 3MF ใหญ่อัปโหลดไม่ได้?** DirectAdmin → **Select PHP Version / PHP Settings** → ตั้ง `upload_max_filesize` และ `post_max_size` เป็น `64M` หรือมากกว่า (หน้าแอดมินจะบอกขนาดที่รับได้)

**ลืมรหัสผ่าน?** ลบไฟล์ `private/auth.php` ใน File Manager แล้วเปิด `/admin/` ใหม่เพื่อตั้งรหัสใหม่

**สำรองข้อมูล:** แท็บ Account → Download backup และดาวน์โหลดโฟลเดอร์ `uploads/` เก็บไว้

### เตรียมไฟล์ 3MF ให้เปลี่ยนสีได้ทีละชิ้น
- ใน Bambu Studio / OrcaSlicer: ทำให้แต่ละชิ้นที่จะเปลี่ยนสีเป็น **part** หรือ **object** แยกกัน (เช่น Split to parts) ตั้งชื่อ part ให้เข้าใจง่าย แล้ว **File → Export → Export all objects as 3MF / Save project**
- อัปโหลดในแอดมิน → ระบบสร้าง "โซนสี" ให้ 1 ชิ้นต่อ 1 โซนอัตโนมัติ
- ปรับได้: รวมหลายชิ้นในโซนเดียว, จำกัดสีที่เลือกได้, ตั้งสีเริ่มต้น, ล็อกสีบางชิ้น, ซ่อนบางชิ้น
- กด 📷 เพื่อถ่ายรูปปกจากพรีวิวได้เลย

## 🇹🇭 ทดลองบน Vercel
1. Vercel → **Add New Project** → เลือก repo นี้ → Framework: **Other** → Deploy (ไม่ต้องตั้งค่า build)
2. หน้าเว็บลูกค้าใช้ได้ปกติ แต่ **หน้าแอดมินใช้ไม่ได้บน Vercel** (Vercel ไม่รัน PHP และเขียนไฟล์ไม่ได้)
3. วิธีอัปเดตข้อมูลบน Vercel: แก้ข้อมูลในแอดมินบน DirectAdmin → Account → Download backup → เอาไฟล์ไปแทน `data/content.json` ใน repo พร้อมไฟล์ใน `uploads/` แล้ว push

> แนะนำ: ใช้ DirectAdmin เป็นตัวหลัก (แอดมินใช้ได้ครบ) แล้วชี้โดเมนมาที่โฮสติ้งนั้น

---

## 🇬🇧 Deploy on DirectAdmin (no SSH, no cron)

1. Download the repo as a ZIP.
2. DirectAdmin → File Manager → `domains/<your-domain>/public_html` → upload the ZIP → Extract. `index.html` must sit directly in `public_html`.
3. Permissions (normally already right): folders `data`, `uploads`, `uploads/models`, `uploads/images`, `private` → 755; `data/content.json` → 644.
4. Open `https://your-domain/admin/` to run first-time setup and create the admin password.
5. Large 3MF files: raise `upload_max_filesize` and `post_max_size` in DirectAdmin PHP settings.
6. Forgot the password? Delete `private/auth.php`, then open `/admin/` again.

Needs PHP 7.4+ (8.x recommended) and Apache or LiteSpeed. Both are standard on DirectAdmin.

## 🇬🇧 Vercel (preview only)
Import the repo, choose Framework **Other**, and deploy. The public site runs fine. `/admin` points to a notice page because Vercel can't run PHP or save files. To publish changes there, download a backup from the DirectAdmin admin panel, commit it as `data/content.json` along with `uploads/`, and push.

---

## Structure
```
index.html            public customizer
assets/js/            app.js (site), viewer3d.js (three.js viewer), threemf.js (3MF parser), content.js
assets/vendor/three/  three.js r160 (MIT), bundled locally, no CDN needed
admin/                PHP admin panel (index.php, api.php, setup.php, lib.php, admin.js)
data/content.json     all site content (edited by the admin panel)
uploads/              uploaded 3MF + images (scripts blocked by .htaccess)
private/              password hash + backup (web access blocked)
```

## Security notes
- Password stored as a hash in `private/auth.php`, a PHP file, so it is never served as text.
- Session login, CSRF token on every change, and a lockout after 8 wrong passwords (15 min).
- Uploads: only `.3mf` (checked as zip) and real images (png/jpg/webp/gif), saved with random names. Scripts can't run inside `uploads/`.
