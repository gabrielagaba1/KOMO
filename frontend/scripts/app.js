const $ = (id) => document.getElementById(id);
const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(2, "0");
const load = (k, fb) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; }
};

const settings = load("komo_settings", { timeFormat: "24", dateFormat: "long" });
let historyItems = load("komo_history", []);
let weatherData = null;
let tempUnit = localStorage.getItem("komo_unit") || "C";
let cityTimer = null;

const state = {
  mode: "clock",
  timeOffsetMs: 0,
  running: false,
  paused: false,
  secondsLeft: 0,
  elapsedSeconds: 0,
  intervalId: null,
  task: "",
  breakSeconds: 0,
  phase: "focus",
  filter: "all",
  search: "",
  sort: "newest"
};

function formatDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(d) {
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const dn = days[d.getDay()], mn = months[d.getMonth()];
  const dd = pad(d.getDate()), mm = pad(d.getMonth() + 1), yyyy = d.getFullYear();
  const formats = {
    dayFirst: `${dn} ${dd} ${mn} ${yyyy}`,
    dmy: `${dd}/${mm}/${yyyy}`,
    mdy: `${mm}/${dd}/${yyyy}`,
    iso: `${yyyy}-${mm}-${dd}`
  };
  return formats[settings.dateFormat] || `${dn} - ${mn} ${dd}, ${yyyy}`;
}

function setClock(h, m, s, ampm = "") {
  $("slotH").textContent = pad(h);
  $("slotM").textContent = pad(m);
  $("slotS").textContent = pad(s);
  $("ampmBadge").textContent = ampm;
  $("ampmBadge").classList.toggle("hidden", !ampm);
}

function render() {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === state.mode));
  const isClock = state.mode === "clock";
  $("stageControls").classList.toggle("hidden", isClock);
  $("weatherPanel").classList.toggle("hidden", !isClock);

  if (isClock) {
    const now = new Date(Date.now() + state.timeOffsetMs);
    let h = now.getHours(), ampm = "";
    if (settings.timeFormat === "12") {
      ampm = h >= 12 ? "PM" : "AM";
      h = h % 12 || 12;
    }
    setClock(h, now.getMinutes(), now.getSeconds(), ampm);
    $("stageSubtitle").textContent = formatDate(now);
    return;
  }

  setClock(Math.floor(state.secondsLeft / 3600), Math.floor((state.secondsLeft % 3600) / 60), state.secondsLeft % 60);
  const active = state.running || state.paused;
  $("primaryActionBtn").textContent = !active ? "Start" : state.paused ? "Resume" : "Pause";
  $("stopActionBtn").classList.toggle("hidden", !active);
  $("stageSubtitle").textContent = !active ? "READY"
    : state.mode === "pomodoro" ? (state.phase === "break" ? `BREAK — ${state.task}` : state.task)
    : state.paused ? "PAUSED" : "RUNNING";
}

function stopTick() {
  clearInterval(state.intervalId);
  state.intervalId = null;
  state.running = false;
}

function resetTimer() {
  stopTick();
  Object.assign(state, { paused: false, secondsLeft: 0, elapsedSeconds: 0, task: "", breakSeconds: 0, phase: "focus" });
}

function startTick() {
  stopTick();
  state.running = true;
  state.paused = false;
  render();

  state.intervalId = setInterval(() => {
    if (state.secondsLeft <= 1) {
      state.secondsLeft = 0;
      if (state.mode === "pomodoro" && state.phase === "focus") {
        state.elapsedSeconds += 1;
        if (state.breakSeconds > 0) {
          state.phase = "break";
          state.secondsLeft = state.breakSeconds;
          return render();
        }
      }
      stopTick();
      return state.mode === "pomodoro" ? openSaveModal() : render();
    }
    state.secondsLeft -= 1;
    if (state.mode === "pomodoro" && state.phase === "focus") state.elapsedSeconds += 1;
    render();
  }, 1000);
}

const OVERLAYS = ["timerModal", "pomoModal", "saveModal", "settingsDrawer", "historyDrawer"];
function closeOverlays() {
  $("backdrop").classList.add("hidden");
  OVERLAYS.forEach((id) => $(id).classList.add("hidden"));
}
function openOverlay(id) {
  closeOverlays();
  $("backdrop").classList.remove("hidden");
  $(id).classList.remove("hidden");
}

function openSaveModal() {
  $("saveSummary").textContent = `${state.task} · ${formatDuration(state.elapsedSeconds)}`;
  $("saveDone").checked = state.secondsLeft === 0;
  $("saveNote").value = "";
  openOverlay("saveModal");
}

function syncSettingsUI() {
  document.querySelectorAll("[data-time-format]").forEach((b) => b.classList.toggle("active", b.dataset.timeFormat === settings.timeFormat));
  $("dateFormatSelect").value = settings.dateFormat;
}

function showHistory() {
  const q = state.search.toLowerCase();
  const filtered = historyItems
    .filter((item) => {
      if (state.filter === "done" && !item.done) return false;
      if (state.filter === "incomplete" && item.done) return false;
      return !q || item.task.toLowerCase().includes(q) || (item.note || "").toLowerCase().includes(q);
    })
    .sort((a, b) => state.sort === "oldest" ? a.id - b.id : state.sort === "longest" ? b.durationSec - a.durationSec : b.id - a.id);

  const list = $("historyList");
  list.innerHTML = "";
  if (!filtered.length) {
    const empty = document.createElement("li");
    empty.className = "empty-note";
    empty.textContent = historyItems.length ? "No matching sessions." : "No saved sessions yet.";
    return list.appendChild(empty);
  }

  filtered.forEach((item) => {
    const li = document.createElement("li");
    li.className = "history-item";
    li.innerHTML = `<div class="history-top"><div class="history-title"></div><button type="button" class="delete-btn">Delete</button></div><div class="history-meta"></div>`;
    li.querySelector(".history-title").textContent = item.task;
    li.querySelector(".history-meta").textContent = `${formatDuration(item.durationSec)} · ${item.done ? "Done" : "Not done"} · ${new Date(item.savedAt).toLocaleString()}`;
    li.querySelector(".delete-btn").onclick = () => {
      historyItems = historyItems.filter((h) => h.id !== item.id);
      localStorage.setItem("komo_history", JSON.stringify(historyItems));
      showHistory();
    };
    if (item.note) {
      const note = document.createElement("p");
      note.className = "history-note";
      note.textContent = item.note;
      li.appendChild(note);
    }
    list.appendChild(li);
  });
}

const toUnit = (c) => (tempUnit === "F" ? Math.round((c * 9) / 5 + 32) : c);

function renderWeatherChart(hourly) {
  if (!hourly || hourly.length <= 1) return;
  const temps = hourly.map((h) => toUnit(h.tempC));
  const min = Math.min(...temps) - 2;
  const range = Math.max(1, Math.max(...temps) + 2 - min);

  let labels = "", hours = "";
  const pts = temps.map((t, i) => {
    const x = Math.round((i / (temps.length - 1)) * 400) + 10;
    const y = Math.round(74 - ((t - min) / range) * 52);
    labels += `<text x="${x}" y="${y - 7}" text-anchor="middle" fill="#968e7e" font-size="11">${t}°</text>`;
    hours += `<span>${hourly[i].label}</span>`;
    return `${x},${y}`;
  }).join(" ");

  $("wxChart").innerHTML =
    `<defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d4a84f" stop-opacity="0.35"/><stop offset="100%" stop-color="#d4a84f" stop-opacity="0"/></linearGradient></defs>` +
    `<polygon points="10,88 ${pts} 410,88" fill="url(#wg)"/><polyline points="${pts}" fill="none" stroke="#d4a84f" stroke-width="2"/>${labels}`;
  $("wxHours").innerHTML = hours;
}

function renderWeather() {
  if (!weatherData) return;
  document.querySelectorAll(".unit-btn").forEach((b) => b.classList.toggle("active", b.dataset.unit === tempUnit));
  $("wxLocation").textContent = [weatherData.city, weatherData.country].filter(Boolean).join(", ") || "Current location";
  $("wxMeta").textContent = weatherData.sunrise && weatherData.sunset
    ? `${weatherData.condition} · ${weatherData.sunrise} – ${weatherData.sunset}`
    : weatherData.condition;
  $("wxTemp").textContent = `${toUnit(weatherData.tempC)}°`;
  $("wxHiLo").textContent = `High ${toUnit(weatherData.highC)}° · Low ${toUnit(weatherData.lowC)}°`;
  $("wxStats").innerHTML = `<span>Humidity ${weatherData.humidity}%</span><span>Precipitation ${weatherData.precipProb}%</span><span>Wind ${weatherData.windKmh} km/h</span>`;
  $("wxSource").textContent = `Data from ${weatherData.source}`;
  renderWeatherChart(weatherData.hourly);
}

async function syncClock(params) {
  try {
    const res = await fetch(`/api/time?${new URLSearchParams(params)}`);
    const data = res.ok ? await res.json() : null;
    if (data?.dateTime) {
      state.timeOffsetMs = new Date(data.dateTime).getTime() - Date.now();
      if (state.mode === "clock") render();
    }
  } catch { /* keep browser time */ }
}

async function loadWeather(loc) {
  try {
    const q = new URLSearchParams({ lat: loc.lat, lon: loc.lon, city: loc.city || "", country: loc.country || "" });
    const res = await fetch(`/api/weather?${q}`);
    if (!res.ok) throw new Error();
    weatherData = await res.json();
    localStorage.setItem("komo_loc", JSON.stringify(loc));
    renderWeather();
    syncClock({ lat: loc.lat, lon: loc.lon });
  } catch {
    $("wxLocation").textContent = "Weather unavailable";
  }
}

async function initWeather() {
  const saved = load("komo_loc", null);
  if (saved?.lat != null && saved?.lon != null) return loadWeather(saved);
  try {
    const res = await fetch("/api/locate");
    const loc = res.ok ? await res.json() : null;
    if (loc?.lat != null && loc?.lon != null) return loadWeather(loc);
  } catch { /* fallback below */ }
  $("wxLocation").textContent = "Search a city for weather";
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.onclick = () => {
    if (btn.dataset.mode === state.mode) return;
    resetTimer();
    state.mode = btn.dataset.mode;
    render();
  };
});

$("primaryActionBtn").onclick = () => {
  if (!state.running && !state.paused) {
    const isTimer = state.mode === "timer";
    $(isTimer ? "timerForm" : "pomoForm").reset();
    $(isTimer ? "timerError" : "pomoError").classList.add("hidden");
    return openOverlay(isTimer ? "timerModal" : "pomoModal");
  }
  if (state.running) {
    stopTick();
    state.paused = true;
    render();
  } else {
    startTick();
  }
};

$("stopActionBtn").onclick = () => {
  stopTick();
  if (state.mode === "pomodoro") {
    state.paused = true;
    render();
    openSaveModal();
  } else {
    resetTimer();
    render();
  }
};

$("timerForm").onsubmit = (e) => {
  e.preventDefault();
  const total = Math.round((Number($("timerHours").value) || 0) * 3600 + (Number($("timerMinutes").value) || 0) * 60);
  if (total <= 0) {
    $("timerError").textContent = "Enter at least 1 minute.";
    return $("timerError").classList.remove("hidden");
  }
  state.secondsLeft = total;
  closeOverlays();
  startTick();
};

$("pomoForm").onsubmit = (e) => {
  e.preventDefault();
  const task = $("pomoTask").value.trim();
  const focus = Number($("pomoFocus").value);
  const brk = Number($("pomoBreak").value || 0);
  if (!task || focus < 1 || focus > 240 || brk < 0 || brk > 60) {
    $("pomoError").textContent = "Enter a task and valid minutes.";
    return $("pomoError").classList.remove("hidden");
  }
  Object.assign(state, {
    task,
    secondsLeft: Math.round(focus * 60),
    breakSeconds: Math.round(brk * 60),
    elapsedSeconds: 0,
    phase: "focus"
  });
  closeOverlays();
  startTick();
};

$("saveForm").onsubmit = (e) => {
  e.preventDefault();
  historyItems.unshift({
    id: Date.now(),
    task: state.task,
    durationSec: state.elapsedSeconds,
    done: $("saveDone").checked,
    note: $("saveNote").value.trim(),
    savedAt: new Date().toISOString()
  });
  localStorage.setItem("komo_history", JSON.stringify(historyItems));
  closeOverlays();
  resetTimer();
  state.mode = "clock";
  render();
};

$("settingsBtn").onclick = () => { syncSettingsUI(); openOverlay("settingsDrawer"); };
$("historyBtn").onclick = () => { showHistory(); openOverlay("historyDrawer"); };
$("fullscreenBtn").onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
};

document.querySelectorAll("[data-time-format]").forEach((btn) => {
  btn.onclick = () => {
    settings.timeFormat = btn.dataset.timeFormat;
    localStorage.setItem("komo_settings", JSON.stringify(settings));
    syncSettingsUI();
    render();
  };
});

$("dateFormatSelect").onchange = (e) => {
  settings.dateFormat = e.target.value;
  localStorage.setItem("komo_settings", JSON.stringify(settings));
  render();
};

$("historySearch").oninput = (e) => { state.search = e.target.value.trim(); showHistory(); };
$("historySort").onchange = (e) => { state.sort = e.target.value; showHistory(); };
$("historyFilterRow").onclick = (e) => {
  const btn = e.target.closest("[data-filter]");
  if (!btn) return;
  $("historyFilterRow").querySelectorAll("[data-filter]").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  state.filter = btn.dataset.filter;
  showHistory();
};

$("backdrop").onclick = closeOverlays;
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeOverlays));
document.onkeydown = (e) => { if (e.key === "Escape") closeOverlays(); };

document.querySelectorAll(".unit-btn").forEach((btn) => {
  btn.onclick = () => {
    tempUnit = btn.dataset.unit;
    localStorage.setItem("komo_unit", tempUnit);
    renderWeather();
  };
});

$("citySearch").oninput = () => {
  clearTimeout(cityTimer);
  const q = $("citySearch").value.trim();
  if (q.length < 2) return $("cityList").classList.add("hidden");

  cityTimer = setTimeout(async () => {
    const list = $("cityList");
    list.innerHTML = "";
    try {
      const res = await fetch(`/api/cities?q=${encodeURIComponent(q)}`);
      const cities = res.ok ? (await res.json()).cities || [] : [];
      if (!cities.length) {
        list.innerHTML = `<li class="empty">City not available</li>`;
      } else {
        cities.forEach((c) => {
          const li = document.createElement("li");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = [c.name, c.admin1, c.country].filter(Boolean).join(", ");
          btn.onclick = () => {
            list.classList.add("hidden");
            $("citySearch").value = "";
            loadWeather({ lat: c.lat, lon: c.lon, city: c.name, country: c.country });
          };
          li.appendChild(btn);
          list.appendChild(li);
        });
      }
    } catch {
      list.innerHTML = `<li class="empty">City not available</li>`;
    }
    list.classList.remove("hidden");
  }, 250);
};

document.addEventListener("click", (e) => {
  if (!e.target.closest(".city-wrap")) $("cityList").classList.add("hidden");
});

syncClock({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
initWeather();
render();
setInterval(() => { if (state.mode === "clock") render(); }, 1000);
