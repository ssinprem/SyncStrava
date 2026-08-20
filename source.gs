// ==================== CONFIGURATION ====================
const scriptProperties = PropertiesService.getScriptProperties();
const STRAVA_CLIENT_ID = scriptProperties.getProperty('STRAVA_CLIENT_ID');
const STRAVA_CLIENT_SECRET = scriptProperties.getProperty('STRAVA_CLIENT_SECRET');
const STRAVA_REFRESH_TOKEN = scriptProperties.getProperty('STRAVA_REFRESH_TOKEN');

// ID ของ Calendar ที่ต้องการให้ลงกิจกรรม (ถ้าใช้ Calendar หลักให้ใส่ 'primary')
const CALENDAR_ID = scriptProperties.getProperty('CALENDAR_ID');

// =======================================================

function syncStravaToCalendar() {
  const accessToken = getStravaAccessToken();
  if (!accessToken) {
    Logger.log("Failed to get Access Token");
    return;
  }

  // ดึงกิจกรรมล่าสุดจาก Strava (ย้อนหลัง 7 วัน)
  const afterTimestamp = Math.floor((Date.now() - (7 * 24 * 60 * 60 * 1000)) / 1000);
  const url = `https://www.strava.com/api/v3/athlete/activities?after=${afterTimestamp}&per_page=30`;
  
  const response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log("Error fetching activities: " + response.getContentText());
    return;
  }

  const activities = JSON.parse(response.getContentText());
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);

  activities.forEach(activity => {
    addOrUpdateActivityInCalendar(calendar, activity, accessToken);
  });
}

function getStravaAccessToken() {
  const url = 'https://www.strava.com/oauth/token';
  const payload = {
    client_id: STRAVA_CLIENT_ID,
    client_secret: STRAVA_CLIENT_SECRET,
    refresh_token: STRAVA_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  });
  const data = JSON.parse(response.getContentText());
  // Logger.log(data.access_token)
  return data.access_token;
}

// ฟังก์ชันดึงชื่อรองเท้าโดยตรงจาก Strava Gear API หากไม่ได้ตั้งใน GEAR_MAP
function getShoeNameFromStrava(gearId, accessToken) {
  if (!gearId) return null;
  
  // 1. ตรวจสอบจาก GEAR_MAP ก่อนเพื่อความเร็ว
  if (GEAR_MAP[gearId]) {
    return GEAR_MAP[gearId];
  }

  // 2. ถ้าไม่มีใน Map ให้ยิง API ไปถาม Strava
  try {
    const url = `https://www.strava.com/api/v3/gear/${gearId}`;
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + accessToken },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      const gearData = JSON.parse(response.getContentText());
      return '❓' + gearData.name || '❔' +gearData.brand_name + ' ' + gearData.model_name;
    }
  } catch (e) {
    Logger.log("Error fetching gear info: " + e.message);
  }

  return gearId; // คืนค่า gear_id เดิมถ้าดึงชื่อไม่สำเร็จ
}

// ฟังก์ชันคำนวณระยะทางระหว่าง 2 พิกัด LatLng (Haversine Formula) คืนค่าเป็น km
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // รัศมีของโลก (กิโลเมตร)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; 
}

// ฟังก์ชันเทียบ LatLng หา ቦታที่ใกล้ที่สุด และไม่เกินระยะ Threshold
function findMatchingLocation(lat, lng) {
  let closestName = null;
  let minDistance = Infinity; // ตั้งค่าเริ่มต้นเป็นระยะทางที่ไม่สิ้นสุด

  // 1. วนลูปหาจุดที่ "ใกล้ที่สุด" จากรายการสถานที่ทั้งหมด
  for (const [name, coords] of Object.entries(SAVED_LOCATIONS)) {
    if (Math.abs(lat-coords[0]) > 0.05 || Math.abs(lng-coords[1]) > 0.05) continue;

    const dist = calculateDistanceKm(lat, lng, coords[0], coords[1]);
    if (dist < minDistance) {
      minDistance = dist;
      closestName = name;
    }
  }

  // 2. เช็กว่าจุดที่ใกล้ที่สุดนั้น อยู่ในระยะ THRESHOLD_KM หรือไม่
  if (minDistance <= MATCH_THRESHOLD_KM) {
    return closestName;
  }

  // ถ้าสถานที่ที่ใกล้ที่สุดยังไกลเกิน THRESHOLD_KM ให้คืนค่า null
  return null;
}

// ฟังก์ชันเลือกรหัส Emoji ตามประเภทกิจกรรม
function getActivityEmoji(activity) {
  switch (activity.type) {
    case 'Run':
    case 'VirtualRun':
      let extra = '';
      if (activity.workout_type == 1) {
        if (activity.name.includes("Test") || activity.name.includes("เทส") )
          extra += '🧪';
        else
          extra += '🏁';
      } else if (activity.workout_type == 2) { // Long Run
        extra += '🟣';
      } else if (activity.workout_type == 3) { // Long Run
        extra += '🟠';
      } else {
        extra += '🟢';
      }
      return extra+'🏃';
    case 'Ride':
    case 'VirtualRide':
    case 'EBikeRide':
      return '🚴';
    case 'Swim':
      return '🏊';
    case 'WeightTraining':
    case 'Workout':
    case 'Crossfit':
      return '🔵🏋️‍♂️';
    case 'Walk':
    case 'Hike':
      return '🚶';
    case 'Yoga':
      return '🔵🧘';
    default:
      return '❓';
  }
}

function formatDuration(totalSeconds) {
  // แปลงให้เป็นจำนวนเต็ม และป้องกันค่าติดลบ
  const seconds = Math.max(0, Math.floor(totalSeconds));

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  // เติมเลข 0 ด้านหน้าถ้าเลขไม่ถึง 2 หลัก (e.g., 5 -> "05")
  const formattedMins = String(mins).padStart(2, '0');
  const formattedSecs = String(secs).padStart(2, '0');

  // ถ้าเกิน 1 ชั่วโมง ให้แสดง hh:mm:ss ถ้าไม่เกิน ให้แสดง mm:ss
  if (hrs > 0) {
    const formattedHrs = String(hrs).padStart(2, '0');
    return `${formattedHrs}:${formattedMins}:${formattedSecs}`;
  }

  return `${formattedMins}:${formattedSecs}`;
}

function addOrUpdateActivityInCalendar(calendar, activity, accessToken) {
  const startTime = new Date(activity.start_date);
  const endTime = new Date(startTime.getTime() + (activity.elapsed_time * 1000));
  
  const emoji = getActivityEmoji(activity);
  const distanceKm = (activity.distance / 1000).toFixed(2);
  const movingTimeMin = Math.round(activity.moving_time / 60);

  const isGymWorkout = ['WeightTraining', 'Workout', 'Crossfit'].includes(activity.type);

  // 1. กำหนดชื่อ Title ของ Event
  let title = '';
  if (isGymWorkout || activity.distance === 0) {
    title = `${emoji} ${activity.name} (${movingTimeMin} mins)`;
  } else {
    title = `${emoji} ${activity.name} (${distanceKm} km)`;
  }

  // 2. จัดการเรื่องสถานที่ (Location) โดยเปรียบเทียบพิกัด
  let matchedLocationName = '';
  let locationString = '';
  let mapsUrl = '';

  if (activity.start_latlng && activity.start_latlng.length === 2) {
    const [lat, lng] = activity.start_latlng;
    mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
    
    // ค้นหาว่าตรงกับสถานที่วิ่งประจำไหม
    matchedLocationName = findMatchingLocation(lat, lng);
  }

  // กำหนดข้อความสถานที่สำหรับใส่ใน Event Location
  if (matchedLocationName) {
    locationString = matchedLocationName;
    title = "🗺️" + title;
  } else if (activity.location_city || activity.location_state || activity.location_country) {
    const locParts = [activity.location_city, activity.location_state, activity.location_country].filter(Boolean);
    locationString = locParts.join(', ');
  } else if (activity.start_latlng && activity.start_latlng.length === 2){
    title = "❔" + title;
  }

  // 3. ดึงข้อมูลรองเท้า (Shoes / Gear)
  let shoeName = '';
  if (activity.gear_id) {
    shoeName = getShoeNameFromStrava(activity.gear_id, accessToken);
  }

  // 4. กำหนดรายละเอียด (Description)
  let description = `Type: `;
  if (activity.type === "Run") {
    if (activity.workout_type == 1) {
      description += "Race ";
    } else if (activity.workout_type == 2) {
      description += "Long ";
    } else if (activity.workout_type == 3) {
      description += "Training ";
    }
  }
  description += `${activity.type}\n`;
  if (activity.type === "Run" && activity.workout_type == 1) {
    description += `Elasped Time: ${formatDuration(activity.elapsed_time)} \n`;
  } else {
    description += `Moving Time: ${formatDuration(activity.moving_time)} \n`;
  }

  if (!isGymWorkout && activity.distance > 0) {
    description += `Distance: ${distanceKm} km\n`;

    if (activity.type === 'Run' && activity.average_speed) {
      const paceSeconds = 1000 / activity.average_speed;
      const paceMin = Math.floor(paceSeconds / 60);
      const paceSec = Math.round(paceSeconds % 60).toString().padStart(2, '0');
      description += `Avg Pace: ${paceMin}:${paceSec} /km\n`;
    } else if (activity.average_speed) {
      const speedKmh = (activity.average_speed * 3.6).toFixed(1);
      description += `Avg Speed: ${speedKmh} km/h\n`;
    }
  }

  if (activity.kilocalories) {
    description += `🔥 Calories: ${Math.round(activity.kilocalories)} kcal\n`;
  }
  if (activity.average_heartrate) {
    description += `❤️ Avg HR: ${Math.round(activity.average_heartrate)} bpm\n`;
  }

  if (activity.average_cadence && activity.type === 'Run') {
    description += `🦶 Avg Cadence: ${Math.round(activity.average_cadence * 2)} spm\n`;
  }

  if (activity.total_elevation_gain && activity.total_elevation_gain > 0) {
    const elevGain = Math.round(activity.total_elevation_gain);
    description += `⛰️ Elevation Gain: ${elevGain} m`;

    // คำนวณ % ความชันเฉลี่ย (ต้องมีระยะทาง > 0)
    if (activity.distance && activity.distance > 0) {
      const avgGradePercent = ((activity.total_elevation_gain / activity.distance) * 100).toFixed(2);
      description += ` (Avg ${avgGradePercent}%)`;
    }
    
    description += `\n`;
  }

  // ใส่ข้อมูลรองเท้าหากมีบันทึกใน Strava
  if (shoeName) {
    description += `👟 Shoes: ${shoeName}\n`;
  }

  // แสดง Description/Note จาก Strava (ถ้ามี)
  if (activity.description && activity.description.trim() !== '') {
    description += `\n📝 Note:\n${activity.description.trim()}\n`;
  }

  if (locationString) {
    description += `🗺️ Location: ${locationString}\n`;
  }
  if (mapsUrl) {
    description += `\n📍 Start Location Map: ${mapsUrl}`;
  }

  const stravaUrl = `https://www.strava.com/activities/${activity.id}`;
  description += `\nStrava Link: ${stravaUrl}`;

  // 5. ค้นหา Event เดิมจาก Strava Link ในช่วงเวลา +/- 1 วัน
  const searchStart = new Date(startTime.getTime() - (24 * 60 * 60 * 1000));
  const searchEnd = new Date(endTime.getTime() + (24 * 60 * 60 * 1000));
  const existingEvents = calendar.getEvents(searchStart, searchEnd, { search: stravaUrl });

  const dateFormat = Utilities.formatDate(startTime, Session.getScriptTimeZone(), "yyyy-MM-dd");

  if (existingEvents.length > 0) {
    // พบ Event เดิม -> ตรวจสอบว่าต้องอัปเดตหรือไม่
    const event = existingEvents[0];
    const isTitleChanged = event.getTitle() !== title;
    const isDescriptionChanged = event.getDescription() !== description;
    const isLocationChanged = event.getLocation() !== locationString;
    const isTimeChanged = event.getStartTime().getTime() !== startTime.getTime() || 
                         event.getEndTime().getTime() !== endTime.getTime();

    if (isTitleChanged || isDescriptionChanged || isLocationChanged || isTimeChanged) {
      event.setTitle(title);
      event.setDescription(description);
      event.setLocation(locationString);
      event.setTime(startTime, endTime);
      Logger.log(`Updated event: ${dateFormat} ${title}`);
    } else {
      Logger.log(`No changes for: ${dateFormat} ${title}`);
    }
  } else {
    // ไม่พบ Event เดิม -> สร้าง Event ใหม่
    calendar.createEvent(title, startTime, endTime, {
      description: description,
      location: locationString
    });
    Logger.log(`Added new event: ${dateFormat} ${title}`);
  }
}

// =======================================================
// ฟังก์ชันสำหรับ SYNC ข้อมูลย้อนหลังทั้งหมด
// =======================================================

function syncAllStravaHistory() {
  const accessToken = getStravaAccessToken();
  if (!accessToken) {
    Logger.log("Failed to get Access Token");
    return;
  }

  let page = parseInt(scriptProperties.getProperty('CURRENT_PAGE') || '1');
  const perPage = 50;

  Logger.log(`--- Starting Sync Page: ${page} ---`);

  const url = `https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=${perPage}`;
  
  const response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log("Error fetching activities: " + response.getContentText());
    return;
  }

  const activities = JSON.parse(response.getContentText());
  
  if (activities.length === 0) {
    Logger.log("🎉 Sync completed! All historical activities have been added.");
    scriptProperties.deleteProperty('CURRENT_PAGE');
    return;
  }

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);

  activities.forEach(activity => {
    addOrUpdateActivityInCalendar(calendar, activity, accessToken);
  });

  Logger.log(`Finished processing Page ${page} (${activities.length} items).`);

  scriptProperties.setProperty('CURRENT_PAGE', (page + 1).toString());
  Logger.log(`Next page to sync: ${page + 1}`);
}

function resetSyncPage() {
  PropertiesService.getScriptProperties().deleteProperty('CURRENT_PAGE');
  Logger.log("Reset sync page counter to 1.");
}
