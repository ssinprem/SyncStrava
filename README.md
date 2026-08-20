# 🏃‍♂️ Strava to Google Calendar Sync

ระบบ Automate สคริปต์ Google Apps Script สำหรับดึงข้อมูลกิจกรรมการออกกำลังกายจาก Strava API เข้ามาลงใน Google Calendar อัตโนมัติ พร้อมฟีเจอร์คำนวณสถานที่ใกล้เคียง, แมปรองเท้าวิ่ง, ระบุประเภท Workout ด้วย Emoji สี และการคำนวณสถิติเชิงลึก

---

## ✨ Features

* 🗺️ Smart Location Matching: คำนวณพิกัดเริ่มต้น (Lat/Lng) ด้วยสูตร Haversine Formula เพื่อระบุชื่อสถานที่วิ่งประจำให้อัตโนมัติ (พร้อมเทคนิค Bounding Box ช่วยให้ประมวลผลเร็วขึ้น)
* 👟 Shoe / Gear Tracker: แสดงรุ่นรองเท้าวิ่งที่ใช้ในแต่ละ Session โดยดึงผ่าน Strava Gear ID หรือแมปเข้ากับ `GEAR_MAP` ส่วนตัว
* 🟢🔴🔵 Visual Color Coding: แสดงสัญลักษณ์ Emoji สีนำหน้าชื่อ Event เพื่อจำแนกประเภท Workout ช่วยให้ดูภาพรวมใน Calendar ได้ง่ายขึ้น:
  * 🟡 Race / Test: งานแข่ง หรือวิ่งทดสอบระยะ
  * 🔴 Interval / Speed / Workout: ซ้อมทำความเร็ว หรือคอร์ด
  * 🔵 Long Run: วิ่งระยะไกล
  * 🟢 Easy / Base Run: วิ่งโซนต่ำ / วิ่งทั่วไป
  * 🟣 Strength / Weight Training: เวทเทรนนิ่ง
* 📊 Detailed Metrics: แสดงสถิติสำคัญครบถ้วนใน Description:
  * Moving Time / Elapsed Time (แสดงฟอร์แมต `hh:mm:ss` หรือ `mm:ss`)
  * Distance & Avg Pace (`mm:ss /km`)
  * ⛰️ Elevation Gain สะสม พร้อมคำนวณ Avg Grade (%) ความชันเฉลี่ย
  * ❤️ Heart Rate & Calories
* 🔄 Sync & Pagination System: ระบบรองรับทั้งการ Sync ประจำวันแบบอัตโนมัติ และฟังก์ชัน `syncAllStravaHistory()` สำหรับดึงข้อมูลย้อนหลังทั้งหมดแบบต่อหน้า (Pagination)

---

## 📁 Project Structure
```text
📁 strava-calendar-sync/
 ├── Code.js             # Logic หลักในการเชื่อมต่อ Strava API และจัดการ Google Calendar
 ├── Locations.js        # พิกัด Lat/Lng และรายชื่อสถานที่วิ่งประจำ (SAVED_LOCATIONS)
 ├── Shoes.js            # ตารางแมป Strava Gear ID กับชื่อรุ่นรองเท้า (GEAR_MAP)
 └── README.md           # เอกสารแนะนำการใช้งาน
```
---

## ⚙️ Setup & Authentication

### 1. การเตรียม Strava API
1. เข้าไปที่ Strava API Settings ([https://www.strava.com/settings/api](https://www.strava.com/settings/api)) เพื่อสร้าง Application
2. บันทึกค่า Client ID, Client Secret และทำการขอ Refresh Token (อ่านสิทธิ์ `activity:read_all`)

### 2. การตั้งค่าบน Google Apps Script
1. เข้าไปที่ Google Apps Script ([https://script.google.com/](https://script.google.com/)) แล้วสร้าง New Project
2. เพิ่มไฟล์ในโปรเจกต์ให้ครบทั้ง `Code.gs`, `Locations.gs`, และ `Shoes.gs` แล้วคัดลอกโค้ดจาก Repository นี้ไปวาง
3. ย้ายรหัสความลับไปเก็บใน Script Properties เพื่อความปลอดภัย:
   * ไปที่ Project Settings (รูปเฟือง ⚙️) -> Script Properties
   * กด Add script property แล้วเพิ่มค่าดังนี้:
     * `STRAVA_CLIENT_ID` : [Client ID จาก Strava]
     * `STRAVA_CLIENT_SECRET` : [Client Secret จาก Strava]
     * `STRAVA_REFRESH_TOKEN` : [Refresh Token จาก Strava]
     * `CALENDAR_ID` : [ID ของ Google Calendar ที่ต้องการให้ลงกิจกรรม หรือใช้ `primary`]

---

## 🚀 Usage & Triggers

### 🔄 การ Sync ประจำวัน (Daily Routine Sync)
ใช้ฟังก์ชัน `syncStravaToCalendar()` เพื่อดึงข้อมูลกิจกรรมย้อนหลัง 7 วันล่าสุด เหมาะสำหรับตั้งเวลาให้ทำงานอัตโนมัติ:
1. ไปที่เมนู Triggers (รูปนาฬิกา ⏰ ด้านซ้าย) -> กด Add Trigger
2. เลือกฟังก์ชัน: `syncStravaToCalendar`
3. Select event source: `Time-driven`
4. Select type of time based trigger: `Every hour` หรือ `Every 6 hours`

### 📜 การ Sync ข้อมูลประวัติย้อนหลังทั้งหมด (Historical All-Sync)
หากต้องการดึงประวัติการวิ่งทั้งหมดตั้งแต่เริ่มใช้งาน Strava เข้า Google Calendar ให้ใช้ฟังก์ชัน `syncAllStravaHistory()`:
1. เลือกฟังก์ชัน `syncAllStravaHistory` บน Editor แล้วกด Run
2. สคริปต์จะดึงข้อมูลครั้งละ 50 กิจกรรม (1 Page) และบันทึกหน้าล่าสุดลงใน `PropertiesService`
3. กด Run ซ้ำเรื่อยๆ จนกระทั่งบน Executions Log ขึ้นข้อความ `🎉 Sync completed!`
4. หากต้องการเริ่มต้นนับหน้าใหม่ตั้งแต่ Page 1 ให้กด Run ฟังก์ชัน `resetSyncPage()`

---

## 🛠️ Configuration Customization

### การเพิ่มสถานที่วิ่งประจำ (`Locations.js`)
สามารถเพิ่มพิกัดสถานที่วิ่งบ่อยๆ ลงใน `SAVED_LOCATIONS` ได้ดังนี้:
```gs
const SAVED_LOCATIONS = {
  "สนามสุขภาพเกาะลอย": [13.17350, 100.92310],
  "สวนแหลมฉบัง": [13.084887, 100.922320],
  // [ชื่อสถานที่]: [Latitude, Longitude]
};
```
### การเพิ่มข้อมูลรองเท้า (`Shoes.js`)
นำ `gear_id` ที่ได้จาก URL หน้า My Gear บนเว็บ Strava ([https://www.strava.com/gear/gXXXXXXX](https://www.strava.com/gear/gXXXXXXX)) มาเพิ่มใน `GEAR_MAP`:
```gs
const GEAR_MAP = {
  'g21220467': 'ASICS Novablast 5 🧊🟠',
  'g23257221': 'ASICS Magic Speed 4 🧊',
  'g25293429': 'HOKA Mach 6 💎🟢'
};
```
---

## 📝 License

This project is open-source under the MIT License.
