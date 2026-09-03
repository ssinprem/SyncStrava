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
  return data.access_token;
}

// ฟังก์ชันดึงรายละเอียด activity แบบเจาะลึก เพื่อเอาข้อมูล Laps/Intervals
function getStravaActivityDetails(activityId, accessToken) {
  try {
    const url = `https://www.strava.com/api/v3/activities/${activityId}`;
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + accessToken },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      return JSON.parse(response.getContentText());
    }
  } catch (e) {
    Logger.log(`Error fetching activity details for ${activityId}: ${e.message}`);
  }
  return null;
}

// ฟังก์ชันดึงชื่อรองเท้าโดยตรงจาก Strava Gear API หากไม่ได้ตั้งใน GEAR_MAP
function getShoeNameFromStrava(gearId, accessToken) {
  if (!gearId) return null;
  
  // 1. ตรวจสอบจาก GEAR_MAP ก่อนเพื่อความเร็ว (กรณีมีไฟล์ Shoes.js)
  if (typeof GEAR_MAP !== 'undefined' && GEAR_MAP[gearId]) {
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
      return '❓' + (gearData.name || (gearData.brand_name + ' ' + gearData.model_name));
    }
  } catch (e) {
    Logger.log("Error fetching gear info: " + e.message);
  }

  return gearId;
}

// ฟังก์ชันคำนวณระยะทางระหว่าง 2 พิกัด LatLng (Haversine Formula) คืนค่าเป็น km
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; 
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
  if (typeof SAVED_LOCATIONS === 'undefined' || typeof MATCH_THRESHOLD_KM === 'undefined') return null;

  let closestName = null;
  let minDistance = Infinity;

  for (const [name, coords] of Object.entries(SAVED_LOCATIONS)) {
    if (Math.abs(lat-coords[0]) > 0.05 || Math.abs(lng-coords[1]) > 0.05) continue;

    const dist = calculateDistanceKm(lat, lng, coords[0], coords[1]);
    if (dist < minDistance) {
      minDistance = dist;
      closestName = name;
    }
  }

  if (minDistance <= MATCH_THRESHOLD_KM) {
    return closestName;
  }

  return null;
}

// ฟังก์ชันเลือกรหัส Emoji ตามประเภทกิจกรรม
function getActivityEmoji(activity) {
  switch (activity.type) {
    case 'Run':
    case 'VirtualRun':
      let extra = '';
      if (activity.name.includes("Test") || activity.name.includes("เทส") ) {
        extra += '🧪';
      } else if (activity.workout_type == 1) { // Race
        extra += '🏁';
      } else if (activity.workout_type == 2) { // Long Run
        extra += '🟣';
      } else if (activity.workout_type == 3) { // Training Run / Interval
        extra += '🟠';
      } else { // Easy Run
        extra += '🟢';
      }
      return extra + '🏃';
    case 'Ride':
    case 'VirtualRide':
    case 'EBikeRide':
      return '🚴';
    case 'Swim':
      return '🔵🏊';
    case 'WeightTraining':
    case 'Workout':
    case 'Crossfit':
      return '🔵🏋️‍♂️';
    case 'Walk':
    case 'Hike':
      return '🟢🚶';
    case 'Yoga':
      return '🔵🧘';
    default:
      return '❓';
  }
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const formattedMins = String(mins).padStart(2, '0');
  const formattedSecs = String(secs).padStart(2, '0');

  if (hrs > 0) {
    const formattedHrs = String(hrs).padStart(2, '0');
    return `${formattedHrs}:${formattedMins}:${formattedSecs}`;
  }

  return `${formattedMins}:${formattedSecs}`;
}

// ฟังก์ชันจัดรูปแบบคำนวณ Pace (mm:ss) จากวินาทีและระยะทางเมตร
function calculatePace(seconds, meters) {
  if (!meters || meters === 0) return "0:00";
  const paceSecondsPerKm = seconds / (meters / 1000);
  const minutes = Math.floor(paceSecondsPerKm / 60);
  const remainingSeconds = Math.round(paceSecondsPerKm % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
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

  // 2. จัดการเรื่องสถานที่ (Location)
  let matchedLocationName = '';
  let locationString = '';
  let mapsUrl = '';

  if (activity.start_latlng && activity.start_latlng.length === 2) {
    const [lat, lng] = activity.start_latlng;
    mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
    matchedLocationName = findMatchingLocation(lat, lng);
  }

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
    description += `Elapsed Time: ${formatDuration(activity.elapsed_time)} \n`;
  } else {
    description += `Moving Time: ${formatDuration(activity.moving_time)} \n`;
  }

  if (!isGymWorkout && activity.distance > 0) {
    description += `Distance: ${distanceKm} km\n`;

    if (["Run","VirtualRun"].includes(activity.type) && activity.average_speed) {
      description += `Avg Pace: ${calculatePace(activity.moving_time, activity.distance)} /km\n`;
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

    if (activity.distance && activity.distance > 0) {
      const avgGradePercent = ((activity.total_elevation_gain / activity.distance) * 100).toFixed(2);
      description += ` (Avg ${avgGradePercent}%)`;
    }
    description += `\n`;
  }

  // 📌 [ดึงข้อมูล LAPS / INTERVALS สำหรับ Training Run (3) และ Race Run (1)]
  const isTrainingOrRace = ["Run", "VirtualRun"].includes(activity.type) && (activity.workout_type == 3 || activity.workout_type == 1);
  if (isTrainingOrRace) {
    const activityDetails = getStravaActivityDetails(activity.id, accessToken);
    if (activityDetails && activityDetails.laps && activityDetails.laps.length > 0) {
      description += `\n⏱️ **Laps / Splits:**\n`;
      activityDetails.laps.forEach((lap, idx) => {
        const lapDist = (lap.distance / 1000).toFixed(2);
        const lapTime = formatDuration(lap.moving_time);
        const lapPace = calculatePace(lap.moving_time, lap.distance);
        const lapHr = lap.average_heartrate ? ` | ❤️ ${Math.round(lap.average_heartrate)}` : '';
        
        description += `• Lap ${idx + 1}: ${lapDist} km | ⏱️ ${lapTime} | Pace ${lapPace} /km${lapHr}\n`;
      });
    }
  }

  // ใส่ข้อมูลรองเท้า
  if (shoeName) {
    description += `\n👟 Shoes: ${shoeName}\n`;
  } else if (["Run","VirtualRun"].includes(activity.type)){
    title = `👟❓` + title;
  }

  // แสดง Description/Note จาก Strava
  if (activity.description && activity.description.trim() !== '') {
    description += `\n📝 Note:\n${activity.description.trim()}\n`;
  }

  if (locationString) {
    description += `🗺️ Location: ${locationString}\n`;
  }
  if (mapsUrl) {
    description += `📍 Start Location Map: ${mapsUrl}\n`;
  }

  const stravaUrl = `https://www.strava.com/activities/${activity.id}`;
  description += `\nStrava Link: ${stravaUrl}`;

  // 5. ค้นหา Event เดิมจาก Strava Link ในช่วงเวลา +/- 1 วัน
  const searchStart = new Date(startTime.getTime() - (24 * 60 * 60 * 1000));
  const searchEnd = new Date(endTime.getTime() + (24 * 60 * 60 * 1000));
  const existingEvents = calendar.getEvents(searchStart, searchEnd, { search: stravaUrl });

  const dateFormat = Utilities.formatDate(startTime, Session.getScriptTimeZone(), "yyyy-MM-dd");

  if (existingEvents.length > 0) {
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