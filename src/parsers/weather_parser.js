const axios = require('axios');

// City name to coordinates mapping
const CITY_COORDS = {
  'wellington': { lat: -41.2865, lon: 174.7762, tz: 'Pacific/Auckland' },
  'shanghai': { lat: 31.2304, lon: 121.4737, tz: 'Asia/Shanghai' },
  'guangzhou': { lat: 23.1291, lon: 113.2644, tz: 'Asia/Shanghai' },
  'moscow': { lat: 55.7558, lon: 37.6176, tz: 'Europe/Moscow' },
  'miami': { lat: 25.7617, lon: -80.1918, tz: 'America/New_York' },
  'chicago': { lat: 41.8781, lon: -87.6298, tz: 'America/Chicago' },
  'new york': { lat: 40.7128, lon: -74.0060, tz: 'America/New_York' },
  'los angeles': { lat: 34.0522, lon: -118.2437, tz: 'America/Los_Angeles' },
  'london': { lat: 51.5074, lon: -0.1278, tz: 'Europe/London' },
  'tokyo': { lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo' },
  'cape town': { lat: -33.9249, lon: 18.4241, tz: 'Africa/Johannesburg' },
  'wuhan': { lat: 30.5928, lon: 114.3055, tz: 'Asia/Shanghai' },
  'paris': { lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris' },
  'sydney': { lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney' },
};

// Parse weather market question
// Returns: { city, date, metric, threshold, comparison, unit } or null
function parseWeatherQuestion(question) {
  if (!question) return null;
  const q = question.toLowerCase();
  
  // Find city
  let cityMatch = null;
  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    if (q.includes(city)) { cityMatch = { name: city, ...coords }; break; }
  }
  if (!cityMatch) return null;
  
  // Find temperature threshold
  const tempMatch = q.match(/(\d+\.?\d*)°?\s*(c|f)/i) || q.match(/(\d+\.?\d*)\s*degrees/i);
  if (!tempMatch) return null;
  const threshold = parseFloat(tempMatch[1]);
  const unit = (tempMatch[2]?.toLowerCase() === 'f') ? 'F' : 'C';
  
  // Find date (look for dates like "May 31", "June 1", "2026-06-01")
  const today = new Date();
  const months = {'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12,'january':1,'february':2,'march':3,'april':4,'june':6,'july':7,'august':8,'september':9,'october':10,'november':11,'december':12};
  let targetDate = null;
  
  // Pattern: "on June 1" or "on May 31"
  const dateMatch = q.match(/on\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})/i);
  if (dateMatch) {
    const month = months[dateMatch[1].toLowerCase().substring(0,3)];
    const day = parseInt(dateMatch[2]);
    const year = today.getFullYear();
    targetDate = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  
  if (!targetDate) return null;
  
  // Determine metric (highest/lowest) and comparison
  const isHigh = q.includes('highest') || q.includes('high temp') || q.includes('maximum');
  const isLow = q.includes('lowest') || q.includes('low temp') || q.includes('minimum');
  const metric = isLow ? 'low' : 'high'; // default to high
  
  const comparison = q.includes('or below') || q.includes('below') || q.includes('under') ? 'lte' :
                     q.includes('or above') || q.includes('above') || q.includes('exceed') ? 'gte' :
                     'eq'; // exact match
  
  return { city: cityMatch.name, lat: cityMatch.lat, lon: cityMatch.lon, 
           tz: cityMatch.tz, date: targetDate, metric, threshold, unit, comparison,
           question };
}

// Fetch actual weather and determine if outcome occurred
async function verifyWeatherOutcome(parsed) {
  const { lat, lon, date, metric, threshold, unit, comparison, tz } = parsed;
  
  const resp = await axios.get('https://api.open-meteo.com/v1/forecast', {
    params: {
      latitude: lat, longitude: lon,
      daily: 'temperature_2m_max,temperature_2m_min',
      timezone: tz || 'auto',
      start_date: date, end_date: date
    },
    timeout: 8000
  });
  
  const daily = resp.data.daily;
  if (!daily || !daily.temperature_2m_max) return null;
  
  let actual = metric === 'low' ? daily.temperature_2m_min?.[0] : daily.temperature_2m_max?.[0];
  if (actual === null || actual === undefined) return null;
  
  // Convert to Fahrenheit if needed
  if (unit === 'F') actual = actual * 9/5 + 32;
  
  let outcome;
  if (comparison === 'lte') outcome = actual <= threshold;
  else if (comparison === 'gte') outcome = actual >= threshold;
  else outcome = Math.abs(actual - threshold) <= 0.6; // within 0.6 degrees = "is X degrees"
  
  // Check if date has passed (outcome is known)
  const targetDate = new Date(date + 'T23:59:59Z');
  const isPast = targetDate < new Date();
  
  return { actual, threshold, unit, outcome, isPast, date };
}

module.exports = { parseWeatherQuestion, verifyWeatherOutcome };
