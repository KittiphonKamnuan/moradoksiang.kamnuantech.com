# Deploy บนเซิร์ฟเวอร์ที่บ้าน (macOS) + Auto deploy

ภาพรวม: `git push` เข้า `main` → GitHub Actions รันเทสต์บนคลาวด์ → ถ้าผ่าน งาน `deploy` จะรันบน **self-hosted runner ในเครื่องที่บ้าน** → `scripts/deploy.sh` build รีลีสใหม่ข้าง ๆ ตัวที่รันอยู่ → สลับ symlink → `pm2 reload` → เช็ก `/api/health` → ถ้าพังจะ **rollback อัตโนมัติ**

```
~/moradoksiang/
├─ current -> releases/20261029-0407-e8a154e   ← pm2 รันจากตรงนี้
├─ releases/                                   ← เก็บ 3 รีลีสล่าสุด
└─ shared/
   ├─ data/            app.db + ไฟล์เสียง (deploy ไม่แตะ)
   ├─ .env.local
   ├─ cloudflared/config.yml
   └─ venv/            (ถ้าใช้ worker ถอดความ)
```

ระหว่าง reload เว็บจะหยุด ~1–2 วินาที คำตอบที่กำลังอัปโหลดไม่หาย เพราะมือถือเก็บไว้ใน IndexedDB แล้ว retry เอง

---

## 1. ติดตั้งโปรแกรม (ครั้งเดียว)

```bash
brew install node@22 ffmpeg cloudflared git
npm i -g pm2
# ถ้าจะถอดความ:
brew install python@3.12
```

## 2. ไม่ให้ MacBook หลับ (สำคัญ)

```bash
sudo pmset -a sleep 0 disksleep 0
sudo pmset -a disablesleep 1      # พับจอแล้วก็ไม่หลับ (ยกเลิก: sudo pmset -a disablesleep 0)
```

เสียบสายชาร์จไว้ และปิด System Settings → Lock Screen → "Turn display off" ได้ตามสบาย (จอดับไม่เป็นไร แค่อย่าให้เครื่อง sleep)

## 3. เตรียมโฟลเดอร์ + config

```bash
git clone https://github.com/KittiphonKamnuan/moradoksiang.kamnuantech.com.git ~/moradoksiang-src
cd ~/moradoksiang-src
bash scripts/server-setup.sh               # หรือ --with-worker ถ้าจะถอดความ
```

แก้ `~/moradoksiang/shared/cloudflared/config.yml` บรรทัด `credentials-file` ให้ชี้ไฟล์ tunnel ที่สร้างไว้:

```yaml
tunnel: moradoksiang
credentials-file: /Users/<ชื่อผู้ใช้>/.cloudflared/4fa886e4-20eb-4700-b3fa-7e4da13dd831.json
```

## 4. Deploy ครั้งแรก + เปิด tunnel

```bash
bash scripts/deploy.sh
MORADOK_ROOT=~/moradoksiang/current MORADOK_SHARED=~/moradoksiang/shared \
  pm2 start ~/moradoksiang/current/ecosystem.config.js --only moradok-tunnel
pm2 save
pm2 startup        # จะพิมพ์คำสั่ง sudo มาให้ — copy ไปรัน เพื่อให้ pm2 เปิดเองหลังรีสตาร์ทเครื่อง
```

ทดสอบ: ปิด WiFi มือถือ แล้วเปิด https://moradoksiang.kamnuantech.com

## 5. ติดตั้ง GitHub self-hosted runner (สำหรับ auto deploy)

1. GitHub repo → **Settings → Actions → Runners → New self-hosted runner** → เลือก **macOS** + **ARM64** (หรือ x64 ถ้าเป็น Intel)
2. ทำตามคำสั่งที่ GitHub แสดง (download → `./config.sh ...`) — ตอน config ถาม **labels** ให้ใส่ `moradoksiang`
3. ให้ runner เห็น PATH เดียวกับ terminal (node, pm2, ffmpeg จาก Homebrew):
   ```bash
   cd ~/actions-runner
   echo "PATH=$PATH" >> .env
   echo "HOME=$HOME" >> .env
   ```
4. ติดตั้งเป็น service ให้รันตลอด:
   ```bash
   ./svc.sh install && ./svc.sh start
   ```
5. ถ้าเก็บแอปไว้ที่อื่นที่ไม่ใช่ `~/moradoksiang` ให้ตั้ง **Settings → Secrets and variables → Actions → Variables** → `MORADOK_APP_DIR`

### ⚠️ ความปลอดภัย (repo เป็น public)

self-hosted runner บน public repo เสี่ยงที่คนนอก fork แล้วเปิด PR ที่มี workflow มารันบนเครื่องเรา ตั้งค่านี้ **ก่อน** เปิดใช้ runner:

- **Settings → Actions → General → Fork pull request workflows from outside collaborators** → เลือก **Require approval for all outside collaborators**
- อย่ากด approve workflow ของ PR จากคนที่ไม่รู้จัก
- (ทางเลือก) Settings → Environments → `production` → เพิ่ม Required reviewers = ตัวเอง ถ้าอยากกดยืนยันก่อน deploy ทุกครั้ง

## 6. ใช้งาน

- `git push origin main` → ดูที่แท็บ **Actions** → `test` ผ่านแล้ว `deploy` จะรันบนเครื่องที่บ้าน
- deploy ซ้ำด้วยมือ: Actions → **CI / Deploy** → **Run workflow** (branch `main`) หรือรัน `bash scripts/deploy.sh` ในเครื่อง
- ดู log: `pm2 logs moradok-web` · สถานะ: `pm2 status`
- rollback ด้วยมือ:
  ```bash
  ls ~/moradoksiang/releases
  ln -sfn ~/moradoksiang/releases/<ตัวที่ต้องการ> ~/moradoksiang/current
  pm2 reload moradok-web
  ```
- สำรองข้อมูล: copy `~/moradoksiang/shared/data/` (มีทั้ง DB และไฟล์เสียง)
