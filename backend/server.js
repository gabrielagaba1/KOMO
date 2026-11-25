const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");

const app = express();
const PORT = Number(process.env.PORT) || 8081;
const HOST = process.env.HOST || "127.0.0.1";
const FRONTEND_DIR = path.join(__dirname, "../frontend");

const WEATHER_CODES = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Foggy", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 73: "Snow",
  75: "Heavy snow", 80: "Rain showers", 81: "Showers", 82: "Heavy showers", 95: "Thunderstorm"
};

app.use(express.static(FRONTEND_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(FRONTEND_DIR, "html/index.html")));
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "komo", port: PORT }));

function formatTime(value, isUnix) {
  if (!value) return "";
  const date = new Date(isUnix ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 502, data: {} };
  }
}

function parseCoords(query) {
  const latStr = String(query.lat ?? "").trim();
  const lonStr = String(query.lon ?? "").trim();
  if (!latStr || !lonStr) return null;
  const lat = Number(latStr);
  const lon = Number(lonStr);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function apiRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  };
}

app.get("/api/time", apiRoute(async (req, res) => {
  const zone = String(req.query.zone || "").trim() || "UTC";
  const coords = parseCoords(req.query);
  const tzKey = process.env.TIMEZONEDB_API_KEY;

  if (tzKey) {
    const target = coords ? `by=position&lat=${coords.lat}&lng=${coords.lon}` : `by=zone&zone=${encodeURIComponent(zone)}`;
    const { ok, data } = await fetchJson(`https://api.timezonedb.com/v2.1/get-time-zone?key=${encodeURIComponent(tzKey)}&format=json&${target}`);
    if (ok && data.status === "OK" && data.formatted) {
      return res.json({ dateTime: data.formatted.replace(" ", "T"), timeZone: data.zoneName || zone, source: "TimeZoneDB" });
    }
  }

  const { ok, status, data } = await fetchJson(`https://timeapi.io/api/time/current/zone?timeZone=${encodeURIComponent(zone)}`);
  if (!ok) return res.status(status === 400 ? 400 : 502).json({ error: "Could not fetch time." });
  res.json({ dateTime: data.dateTime, timeZone: data.timeZone || zone, source: "timeapi.io" });
}));

app.get("/api/locate", apiRoute(async (_req, res) => {
  const geoKey = process.env.IPGEO_API_KEY;
  if (geoKey) {
    const { ok, data } = await fetchJson(`https://api.ipgeolocation.io/ipgeo?apiKey=${encodeURIComponent(geoKey)}`);
    if (ok && data.latitude && data.longitude) {
      return res.json({
        city: data.city || "",
        country: data.country_name || "",
        lat: Number(data.latitude),
        lon: Number(data.longitude),
        source: "IPGeolocation"
      });
    }
  }

  const { ok, data } = await fetchJson("https://ipwho.is/");
  if (!ok || data.success === false) return res.status(502).json({ error: "Could not detect location." });
  res.json({ city: data.city || "", country: data.country || "", lat: data.latitude, lon: data.longitude, source: "ipwho.is" });
}));

app.get("/api/cities", apiRoute(async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 2) return res.json({ cities: [] });
  const owmKey = process.env.OPENWEATHER_API_KEY;

  if (owmKey) {
    const { ok, data } = await fetchJson(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=5&appid=${encodeURIComponent(owmKey)}`);
    if (ok && Array.isArray(data)) {
      return res.json({
        cities: data.map((p) => ({ name: p.name, admin1: p.state || "", country: p.country || "", lat: p.lat, lon: p.lon }))
      });
    }
  }

  const { ok, data } = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`);
  if (!ok) return res.status(502).json({ error: "City lookup failed." });
  res.json({
    cities: (data.results || []).map((p) => ({ name: p.name, admin1: p.admin1 || "", country: p.country || "", lat: p.latitude, lon: p.longitude }))
  });
}));

async function fetchOpenWeather(lat, lon, city, country) {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return null;

  const base = `lat=${lat}&lon=${lon}&units=metric&appid=${encodeURIComponent(key)}`;
  const [cur, fc] = await Promise.all([
    fetchJson(`https://api.openweathermap.org/data/2.5/weather?${base}`),
    fetchJson(`https://api.openweathermap.org/data/2.5/forecast?${base}`)
  ]);
  if (!cur.ok || !fc.ok || !cur.data.main) return null;

  const list = fc.data.list || [];
  const sys = cur.data.sys || {};
  return {
    source: "OpenWeatherMap",
    city: city || cur.data.name || "",
    country: country || sys.country || "",
    condition: cur.data.weather?.[0]?.description || "",
    tempC: Math.round(cur.data.main.temp),
    highC: Math.round(cur.data.main.temp_max),
    lowC: Math.round(cur.data.main.temp_min),
    humidity: cur.data.main.humidity,
    precipProb: list[0]?.pop ? Math.round(list[0].pop * 100) : 0,
    windKmh: Math.round((cur.data.wind?.speed || 0) * 3.6),
    sunrise: formatTime(sys.sunrise, true),
    sunset: formatTime(sys.sunset, true),
    hourly: list.slice(0, 8).map((item, i) => ({
      label: i === 0 ? "Now" : formatTime(item.dt, true),
      tempC: Math.round(item.main.temp)
    }))
  };
}

async function fetchOpenMeteo(lat, lon, city, country) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=2`;
  const { ok, data } = await fetchJson(url);
  if (!ok) throw new Error("Weather service unavailable.");

  const cur = data.current || {};
  const hourlyData = data.hourly || {};
  const dailyData = data.daily || {};
  const times = hourlyData.time || [];
  const nowHour = (cur.time || "").slice(0, 13);
  const startIndex = Math.max(0, times.findIndex((t) => t.startsWith(nowHour)));

  const temps = hourlyData.temperature_2m || [];
  const hourly = [];
  for (let i = 0; i < 8 && startIndex + i * 3 < times.length; i++) {
    const idx = startIndex + i * 3;
    if (temps[idx] == null) continue;
    hourly.push({
      label: i === 0 ? "Now" : formatTime(times[idx], false),
      tempC: Math.round(temps[idx])
    });
  }

  const tempC = Math.round(cur.temperature_2m || 0);
  const rain = hourlyData.precipitation_probability?.[startIndex];
  return {
    source: "Open-Meteo",
    city,
    country,
    condition: WEATHER_CODES[cur.weather_code] || "Cloudy",
    tempC,
    highC: dailyData.temperature_2m_max?.[0] != null ? Math.round(dailyData.temperature_2m_max[0]) : tempC,
    lowC: dailyData.temperature_2m_min?.[0] != null ? Math.round(dailyData.temperature_2m_min[0]) : tempC,
    humidity: Math.round(cur.relative_humidity_2m || 0),
    precipProb: rain != null ? Math.round(rain) : 0,
    windKmh: Math.round(cur.wind_speed_10m || 0),
    sunrise: formatTime(dailyData.sunrise?.[0], false),
    sunset: formatTime(dailyData.sunset?.[0], false),
    hourly
  };
}

app.get("/api/weather", apiRoute(async (req, res) => {
  const coords = parseCoords(req.query);
  if (!coords) return res.status(400).json({ error: "Valid latitude and longitude are required." });

  const city = String(req.query.city || "").trim();
  const country = String(req.query.country || "").trim();
  const weather = (await fetchOpenWeather(coords.lat, coords.lon, city, country))
    || (await fetchOpenMeteo(coords.lat, coords.lon, city, country));
  res.json(weather);
}));

app.listen(PORT, HOST, () => {
  console.log(`Komo server running at http://${HOST}:${PORT}`);
});
