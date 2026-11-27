// City Club Maintenance — front end
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  token: localStorage.getItem("ccm_token"),
  user: null,
  config: null,
  jobs: [],
  tab: null,
  filters: { building: "", person: "", status: "active" },
  form: null,
  plan: null,
  advice: null,
  dismissed: new Set(),
  reportDate: null,
  detailPeriod: "wtd",
  allJobs: null,
  recurring: null,
  recToday: null,
  recBuilding: "",
  calDay: 0,
};

const STATUS_LABEL = { open: "Not started", in_progress: "Busy", waiting: "Waiting", done: "Fixed" };

// ---------- helpers
async function api(path, opts = {}) {
  const res = await fetch("/api/" + path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", ...(state.token ? { authorization: "Bearer " + state.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "login") { logout(); throw new Error("Please log in again"); }
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 3000);
}
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
  const d = Math.round(h / 24);
  return d + (d === 1 ? " day ago" : " days ago");
}
const teamName = (id) => (state.config.team.find((t) => t.id === id) || {}).name;
const catLabel = (id) => (state.config.categories.find((c) => c.id === id) || {}).label || id;
const photoUrl = (key) => `/api/photos/${encodeURIComponent(key)}?t=${encodeURIComponent(state.token)}`;
const isActive = (j) => j.status !== "done";
const byPriority = (a, b) => (b.blocking - a.blocking) || (a.createdAt - b.createdAt);

function suggest(building, cat) {
  // mirrors lib/config.mjs suggestAssignee
  if (cat === "paint") return "pathy";
  if (cat === "power") return "kabos";
  const local = state.config.team.find((t) => t.buildings.includes(building));
  if ((cat === "water" || cat === "geyser") && local && local.id === "paul") return "dadou";
  return local ? local.id : null;
}

// ---------- day planning
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HORIZON = 60; // days looked ahead
const jobMins = (j) => j.minutes || (state.config.categories.find((c) => c.id === j.category) || {}).minutes || 60;
const fmtH = (m) => (!m ? "0 h" : m >= 60 ? Math.round(m / 6) / 10 + " h" : Math.round(m) + " min");
const workers = () => state.config.team.filter((t) => !t.external);
const dayOffOf = (id) => { const v = (state.config.settings.daysOff || {})[id]; return v === undefined ? null : v; };
function dateAt(d, now = new Date()) { const x = new Date(now); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() + d); return x; }
function dayLabel(d, short) {
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  const x = dateAt(d);
  return short ? DAYS[x.getDay()].slice(0, 3) + " " + x.getDate() : DAYS[x.getDay()] + " " + x.getDate() + " " + x.toLocaleString([], { month: "short" });
}
function capacity(id, d, now) {
  if (dayOffOf(id) === dateAt(d, now).getDay()) return 0;
  const { start, end } = state.config.work;
  if (d > 0) return (end - start) * 60;
  const n = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, Math.min((end - start) * 60, end * 60 - Math.max(n, start * 60)));
}
const planOrder = (a, b) => ((b.status === "in_progress") - (a.status === "in_progress")) || (b.blocking - a.blocking) || (a.createdAt - b.createdAt);

// Fills each person's working days with their jobs, most urgent first.
function dayIndexOf(dateStr, now) {
  const [y, m, dd] = dateStr.split("-").map(Number);
  return Math.round((new Date(y, m - 1, dd, 12) - dateAt(0, now)) / 864e5);
}

// Works out each handyman's days. Jobs a manager booked at a set time sit there;
// the rest fill the free time around them, most urgent first.
function buildPlan(now = new Date()) {
  const plan = { person: {}, jobDay: {}, now };
  const endMin = state.config.work.end * 60;
  for (const w of workers()) {
    const all = state.jobs.filter((j) => isActive(j) && j.status !== "waiting" && j.assignee === w.id).sort(planOrder);
    const used = [], jobsByDay = [], segs = [], busy = [];
    const add = (d, j, start, mins, pinned) => {
      (segs[d] = segs[d] || []).push({ job: j, start, mins, pinned });
      used[d] = (used[d] || 0) + mins;
      if (!(jobsByDay[d] = jobsByDay[d] || []).includes(j)) jobsByDay[d].push(j);
      if (plan.jobDay[j.id] === undefined) plan.jobDay[j.id] = d;
    };
    const queue = [];
    for (const j of all) {
      const d = j.slot ? dayIndexOf(j.slot.date, now) : -1;
      if (j.slot && d >= 0 && d < HORIZON) {
        const m = Math.min(jobMins(j), endMin - j.slot.start);
        add(d, j, j.slot.start, m, true);
        (busy[d] = busy[d] || []).push([j.slot.start, j.slot.start + m]);
      } else queue.push(j);
    }
    const dayStartMin = (d) => d === 0 ? Math.max(state.config.work.start * 60, now.getHours() * 60 + now.getMinutes()) : state.config.work.start * 60;
    let d = 0, clock = dayStartMin(0);
    for (const j of queue) {
      let m = jobMins(j);
      while (m > 0 && d < HORIZON) {
        if (capacity(w.id, d, now) === 0 || clock >= endMin) { d++; clock = dayStartMin(d); continue; }
        const inside = (busy[d] || []).find(([s, e]) => clock >= s && clock < e);
        if (inside) { clock = inside[1]; continue; }
        const limit = Math.min(endMin, ...(busy[d] || []).filter(([s]) => s > clock).map(([s]) => s));
        const t = Math.min(m, limit - clock);
        if (t <= 0) { clock = limit; continue; }
        add(d, j, clock, t, false);
        clock += t; m -= t;
      }
    }
    for (const sg of segs) if (sg) sg.sort((x, y) => x.start - y.start);
    const lastDay = all.length ? Math.max(...all.map((j) => plan.jobDay[j.id] ?? 0)) : -1;
    plan.person[w.id] = { used, jobsByDay, lastDay, segs };
  }
  return plan;
}

// Suggested moves and warnings for the manager.
function advise(plan) {
  const now = plan.now, moves = [], warnings = [];
  const free = {};
  for (const w of workers()) free[w.id] = [0, 1].map((d) => capacity(w.id, d, now) - (plan.person[w.id].used[d] || 0));
  const canDo = (w, j) => w.can.includes(j.category);
  const pickBest = (cands, j, d) => cands
    .filter((w) => free[w.id][d] >= jobMins(j))
    .sort((a, b) => (b.buildings.includes(j.building) - a.buildings.includes(j.building)) || (free[b.id][d] - free[a.id][d]))[0];

  // 1. jobs nobody has yet
  const unassigned = state.jobs.filter((j) => isActive(j) && !j.assignee).sort(planOrder);
  for (const j of unassigned) {
    const cands = workers().filter((w) => canDo(w, j));
    let done = false;
    for (const d of [0, 1]) {
      const q = pickBest(cands, j, d);
      if (q) {
        moves.push({ job: j, to: q.id, why: `Not assigned yet. ${q.name} has ${fmtH(free[q.id][d])} free ${d ? "tomorrow" : "today"}.` });
        free[q.id][d] -= jobMins(j);
        done = true;
        break;
      }
    }
    if (!done && cands.length) {
      const q = cands.sort((a, b) => plan.person[a.id].lastDay - plan.person[b.id].lastDay)[0];
      moves.push({ job: j, to: q.id, why: `Not assigned yet. ${q.name} has the shortest list.` });
    }
  }

  // 2. someone is booked into later days while someone else has free time sooner
  for (const p of workers()) {
    const later = state.jobs
      .filter((j) => j.assignee === p.id && j.status === "open" && (plan.jobDay[j.id] ?? 0) > 0)
      .sort(planOrder);
    for (const j of later) {
      const jd = plan.jobDay[j.id];
      for (const d of [0, 1].filter((x) => x < jd)) {
        const q = pickBest(workers().filter((w) => w.id !== p.id && canDo(w, j)), j, d);
        if (q) {
          moves.push({ job: j, from: p.id, to: q.id,
            why: `${p.name} is booked until ${dayLabel(plan.person[p.id].lastDay).toLowerCase()} — this job would wait until ${dayLabel(jd).toLowerCase()}. ${q.name} has ${fmtH(free[q.id][d])} free ${d ? "tomorrow" : "today"}.` });
          free[q.id][d] -= jobMins(j);
          break;
        }
      }
    }
  }

  // 3. warnings
  const noDaysOff = workers().filter((w) => dayOffOf(w.id) === null);
  if (noDaysOff.length) warnings.push({ level: "info", text: `Days off not set for ${noDaysOff.map((w) => w.name).join(", ")} — the plan assumes they work every day. Set them below.` });
  for (const w of workers()) {
    const cap = capacity(w.id, 0, now);
    const booked = plan.person[w.id].used[0] || 0;
    if (dayOffOf(w.id) === dateAt(0, now).getDay()) { warnings.push({ level: "info", text: `${w.name} is off today.` }); continue; }
    if (cap >= 120 && booked < cap / 2) warnings.push({ level: "amber", text: `${w.name} is not fully allocated: ${fmtH(booked)} of work booked, ${fmtH(cap - booked)} still free today.` });
    if (plan.person[w.id].lastDay >= 2) warnings.push({ level: "red", text: `${w.name} is over-allocated: booked until ${dayLabel(plan.person[w.id].lastDay).toLowerCase()}.` });
  }
  return { moves: moves.slice(0, 10), warnings };
}

async function compressPhoto(file) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });
  const max = 1280;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return c.toDataURL("image/jpeg", 0.72);
}
async function uploadPhoto(file) {
  const dataUrl = await compressPhoto(file);
  const { key } = await api("photos", { method: "POST", body: { dataUrl } });
  return { key, dataUrl };
}

// ---------- session
function logout() {
  localStorage.removeItem("ccm_token");
  state.token = null;
  state.user = null;
  render();
}

async function start() {
  if (!state.token) return render();
  try {
    state.config = await api("config");
    state.user = state.config.user;
    if (!state.tab) state.tab = defaultTab();
    await loadJobs();
  } catch (e) {
    /* api() logs out on 401 */
  }
  render();
}
function defaultTab() {
  return state.user.role === "manager" ? "calendar" : state.user.role === "handyman" ? "mine" : "report";
}
async function loadJobs() {
  const { jobs } = await api("jobs");
  state.jobs = jobs;
}

// simple line icons for the bottom menu bar
const svg = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  calendar: svg('<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h3v3h-3z"/>'),
  jobs: svg('<path d="M14.7 6.3a4 4 0 0 0-5.3 5.3L3 18l3 3 6.4-6.4a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  planner: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  planned: svg('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'),
  reports: svg('<path d="M3 21h18"/><rect x="5" y="11" width="3" height="7"/><rect x="10.5" y="6" width="3" height="12"/><rect x="16" y="9" width="3" height="9"/>'),
  status: svg('<rect x="5" y="3.5" width="14" height="18" rx="2"/><path d="M9 3.5V2.5h6v1M8.5 10h7M8.5 14h7M8.5 18h4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
};

// ---------- render
function render() {
  const app = $("#app");
  $("#sheet").classList.add("hidden");
  if (!state.user) {
    $("#who").innerHTML = "";
    $("#tabs").innerHTML = "";
    $("#banner").innerHTML = "";
    app.innerHTML = loginView();
    const pin = $("#pin");
    pin.focus();
    $("#loginForm").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("#loginBtn");
      btn.disabled = true;
      try {
        const r = await api("login", { method: "POST", body: { pin: pin.value } });
        state.token = r.token;
        localStorage.setItem("ccm_token", r.token);
        state.tab = null;
        await start();
      } catch (err) {
        $("#loginErr").textContent = err.message;
        pin.value = "";
        btn.disabled = false;
        pin.focus();
      }
    };
    return;
  }

  $("#who").innerHTML = `${esc(state.user.name)}${state.config.demo ? "" : `<button id="mypin">My PIN</button>`}<button id="logout">Log out</button>`;
  $("#logout").onclick = logout;
  if ($("#mypin")) $("#mypin").onclick = () => pinSheet(false);
  if (state.config.mustSetPin) {
    $("#tabs").innerHTML = "";
    $("#banner").innerHTML = "";
    document.body.classList.remove("navtop");
    app.innerHTML = setPinView(true);
    wireSetPin(true);
    return;
  }
  $("#banner").innerHTML = state.config.demo
    ? `<div class="warn"><b>Test mode:</b> demo PINs are switched on. Set your own staff PINs in Netlify before real use.</div>`
    : "";

  state.plan = buildPlan();
  if (state.user.role === "manager") {
    state.advice = advise(state.plan);
    state.advice.moves = state.advice.moves.filter((m) => !state.dismissed.has(m.job.id + ">" + m.to));
  }
  // bottom menu bar (phone-app style) with a big + in the middle for reporting a problem
  const r = state.user.role;
  const unassignedN = state.jobs.filter((j) => isActive(j) && !j.assignee).length;
  const tabs = [];
  if (r === "manager") {
    tabs.push(["calendar", ICON.calendar, "Calendar"], ["all", ICON.jobs, "Jobs", unassignedN], ["report", ICON.plus, "Report"],
      ["planner", ICON.planner, "Planner", state.advice.moves.length], ["planned", ICON.planned, "Planned"], ["daily", ICON.reports, "Reports"]);
  } else if (r === "handyman") {
    tabs.push(["mine", ICON.jobs, "My jobs", state.jobs.filter((j) => isActive(j) && j.assignee === state.user.team).length], ["report", ICON.plus, "Report"]);
  } else {
    tabs.push(["status", ICON.status, "Job status"], ["report", ICON.plus, "Report"]);
  }
  // managers (often on a laptop) get the menu across the top; handymen and staff keep the phone-style bar at the bottom
  document.body.classList.toggle("navtop", r === "manager");
  $("#tabs").innerHTML = tabs
    .map(([id, icon, label, n]) => `<button data-tab="${id}" class="${state.tab === id ? "on" : ""} ${id === "report" ? "plus" : ""}">
      <span class="ico">${icon}</span><span class="lbl">${label}</span>${n ? `<span class="count">${n}</span>` : ""}</button>`)
    .join("");
  document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));

  if (state.tab === "report") return renderReport();
  if (state.tab === "mine") return renderMine();
  if (state.tab === "status") return renderStatus();
  if (state.tab === "planner") return renderPlanner();
  if (state.tab === "daily") return renderDaily();
  if (state.tab === "planned") return renderPlanned();
  if (state.tab === "calendar") return renderCalendar();
  return renderAll();
}

function loginView() {
  return `<form id="loginForm" class="login">
    <h2>Staff login</h2>
    <p class="muted">Enter your PIN</p>
    <input id="pin" class="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" required>
    <button id="loginBtn" class="btn gold block">Log in</button>
    <p id="loginErr" style="color:var(--red);min-height:1.4em"></p>
  </form>`;
}

// ---------- report form
function freshForm() {
  return { building: state.form?.building || "", room: "", category: "", blocking: null, description: "", photo: null, preview: null, assignee: undefined };
}
function renderReport() {
  if (!state.form) state.form = freshForm();
  const f = state.form;
  const cfg = state.config;
  const suggested = f.building && f.category ? suggest(f.building, f.category) : undefined;
  const assignee = f.assignee !== undefined ? f.assignee : suggested;
  const isMgr = state.user.role === "manager";

  $("#app").innerHTML = `
    <h2>Report a problem</h2>
    <label class="f">Building</label>
    <div class="chips">${cfg.buildings.map((b) => `<button type="button" class="chip ${f.building === b ? "on" : ""}" data-b="${esc(b)}">${esc(b)}</button>`).join("")}</div>

    <label class="f" for="room">Room number or area</label>
    <input id="room" class="t" placeholder="e.g. 304, or Lobby" value="${esc(f.room)}" maxlength="30">

    <label class="f">What is broken?</label>
    <div class="grid2">${cfg.categories.map((c) => `<button type="button" class="opt ${f.category === c.id ? "on" : ""}" data-c="${c.id}">${esc(c.label)}</button>`).join("")}</div>

    <label class="f">Can the room still be sold?</label>
    <div class="yn">
      <button type="button" class="opt good ${f.blocking === false ? "on" : ""}" data-y="0">Yes, it can</button>
      <button type="button" class="opt bad ${f.blocking === true ? "on" : ""}" data-y="1">No, it's out of order</button>
    </div>

    <label class="f" for="desc">Describe the problem</label>
    <textarea id="desc" class="t" placeholder="What did you see? Anything the handyman should know?" maxlength="1000">${esc(f.description)}</textarea>

    <label class="f">Photo</label>
    <div class="photo-pick">
      ${f.preview ? `<img src="${f.preview}" alt="">` : ""}
      <label class="btn light small" for="photo">${f.preview ? "Change photo" : "Take or add photo"}</label>
      <input id="photo" type="file" accept="image/*" capture="environment" class="hidden">
      <span id="photoMsg" class="muted"></span>
    </div>

    ${f.building && f.category ? `<div class="goes-to">
      ${isMgr ? `<b>Send to:</b> <select id="assignee" class="t" style="margin-top:6px">
          <option value="">Not assigned yet</option>
          ${cfg.team.map((t) => `<option value="${t.id}" ${assignee === t.id ? "selected" : ""}>${esc(t.name)}${t.id === suggested ? " (suggested)" : ""}</option>`).join("")}
        </select>`
        : assignee ? `This will go to <b>${esc(teamName(assignee))}</b>.` : `A manager will choose who fixes this.`}
    </div>` : ""}

    <p id="formErr" style="color:var(--red);min-height:1.2em;margin:12px 4px"></p>
    <button id="send" class="btn gold block">Send report</button>
  `;

  const keep = () => { f.room = $("#room").value; f.description = $("#desc").value; };
  document.querySelectorAll("[data-b]").forEach((b) => (b.onclick = () => { keep(); f.building = b.dataset.b; f.assignee = undefined; renderReport(); }));
  document.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => {
    keep();
    f.category = b.dataset.c;
    f.assignee = undefined;
    if (f.blocking === null) f.blocking = !!cfg.categories.find((c) => c.id === f.category).blocking;
    renderReport();
  }));
  document.querySelectorAll("[data-y]").forEach((b) => (b.onclick = () => { keep(); f.blocking = b.dataset.y === "1"; renderReport(); }));
  if ($("#assignee")) $("#assignee").onchange = (e) => { keep(); f.assignee = e.target.value || null; };
  $("#photo").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    keep();
    $("#photoMsg").textContent = "Uploading…";
    $("#send").disabled = true;
    try {
      const { key, dataUrl } = await uploadPhoto(file);
      f.photo = key;
      f.preview = dataUrl;
      renderReport();
    } catch (err) {
      $("#photoMsg").textContent = err.message;
      $("#send").disabled = false;
    }
  };
  $("#send").onclick = async () => {
    keep();
    const errEl = $("#formErr");
    if (!f.building) return (errEl.textContent = "Choose the building.");
    if (!f.room.trim()) return (errEl.textContent = "Enter the room number or area.");
    if (!f.category) return (errEl.textContent = "Choose what is broken.");
    if (f.blocking === null) return (errEl.textContent = "Say whether the room can still be sold.");
    $("#send").disabled = true;
    try {
      const body = { building: f.building, room: f.room, category: f.category, blocking: f.blocking, description: f.description, photo: f.photo };
      if (isMgr) body.assignee = assignee || "";
      const { job } = await api("jobs", { method: "POST", body });
      state.jobs.unshift(job);
      state.form = null;
      renderSent(job);
    } catch (err) {
      errEl.textContent = err.message;
      $("#send").disabled = false;
    }
  };
}

function renderSent(job) {
  const who = job.assignee ? teamName(job.assignee) : null;
  const msg = `🔧 Maintenance: ${job.building} ${job.room} — ${catLabel(job.category)}${job.blocking ? " — ROOM OUT OF ORDER" : ""}${job.description ? "\n" + job.description : ""}${who ? "\nFor: " + who : ""}\nOpen the app: ${location.origin}`;
  $("#app").innerHTML = `<div class="ok-box">
    <div class="tick">✓</div>
    <h2>Report sent</h2>
    <p>${esc(job.building)} · ${esc(job.room)} — ${esc(catLabel(job.category))}</p>
    <p>${who ? `It's on <b>${esc(who)}</b>'s job list.` : "A manager will assign it."}</p>
    <div class="row" style="max-width:420px;margin:20px auto 0">
      <a class="btn green" style="text-decoration:none;text-align:center" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Also send on WhatsApp</a>
      <button class="btn light" id="another">Report another</button>
    </div>
  </div>`;
  $("#another").onclick = () => renderReport();
}

// ---------- job lists
function jobCard(j) {
  const me = state.user;
  const mine = me.role === "handyman" && j.assignee === me.team;
  const mgr = me.role === "manager";
  const canWork = mine || mgr;
  const actions = [];
  if (j.status !== "done") {
    if (me.role === "handyman" && !j.assignee) actions.push(`<button class="btn gold small" data-act="take">Take this job</button>`);
    if (canWork && j.status !== "in_progress") actions.push(`<button class="btn small" data-act="start">Start</button>`);
    if (canWork) actions.push(`<button class="btn green small" data-act="done">Mark fixed</button>`);
    if (canWork && j.status !== "waiting") actions.push(`<button class="btn light small" data-act="wait">Waiting for…</button>`);
  }
  if (mgr) actions.push(`<button class="btn light small" data-act="manage">Manage</button>`);
  actions.push(`<button class="btn light small" data-act="note">Add note</button>`);

  return `<div class="card job ${j.blocking && j.status !== "done" ? "blocking" : ""} ${j.status === "done" ? "done" : ""}" data-id="${j.id}">
    <div class="head">
      <div>
        <div class="where">${esc(j.building)} · ${esc(j.room)}</div>
        <div class="what">${esc(catLabel(j.category))}</div>
      </div>
      <div class="muted" style="font-size:13px;white-space:nowrap">${ago(j.createdAt)}</div>
    </div>
    <div class="badges">
      ${j.blocking && j.status !== "done" ? `<span class="badge b-out">Room out of order</span>` : ""}
      ${j.recurringId ? `<span class="badge b-plan">Planned · due ${esc(j.dueDate || "")}</span>` : ""}
      <span class="badge b-${j.status}">${STATUS_LABEL[j.status]}</span>
      ${j.assignee ? `<span class="badge b-who">${esc(teamName(j.assignee) || j.assignee)}</span>` : `<span class="badge b-none">Not assigned</span>`}
      ${j.status !== "done" ? `<span class="badge b-time">~${fmtH(jobMins(j))}</span>` : ""}
      ${isActive(j) && state.plan && state.plan.jobDay[j.id] !== undefined ? `<span class="badge b-day">Planned: ${dayLabel(state.plan.jobDay[j.id])}</span>` : ""}
    </div>
    ${j.description ? `<div class="desc">${esc(j.description)}</div>` : ""}
    ${j.photo || j.afterPhoto ? `<div class="thumbs">
      ${j.photo ? `<img src="${photoUrl(j.photo)}" data-full="${photoUrl(j.photo)}" alt="Problem photo" loading="lazy">` : ""}
      ${j.afterPhoto ? `<img src="${photoUrl(j.afterPhoto)}" data-full="${photoUrl(j.afterPhoto)}" alt="After photo" loading="lazy">` : ""}
    </div>` : ""}
    <div class="meta">Reported by ${esc(j.createdBy)}${j.status === "done" ? ` · fixed by ${esc(j.doneBy)} ${ago(j.doneAt)}` : ""}</div>
    <details class="hist"><summary>History (${j.history.length})</summary><ul>
      ${j.history.map((h) => `<li>${new Date(h.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} — <b>${esc(h.by)}</b>: ${esc(h.text)}</li>`).join("")}
    </ul></details>
    <div class="actions row">${actions.join("")}</div>
  </div>`;
}

function wireCards() {
  document.querySelectorAll(".job").forEach((card) => {
    const job = state.jobs.find((j) => j.id === card.dataset.id);
    card.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => onAction(job, b.dataset.act)));
    card.querySelectorAll("img[data-full]").forEach((img) => (img.onclick = () => openSheet(`<img class="full" src="${img.dataset.full}" alt=""><p></p><button class="btn block light" data-close>Close</button>`)));
  });
}

async function doUpdate(job, body) {
  const { job: updated } = await api(`jobs/${job.id}/update`, { method: "POST", body });
  state.jobs = state.jobs.map((j) => (j.id === updated.id ? updated : j));
  render();
}

function openSheet(html, wire) {
  const s = $("#sheet");
  s.innerHTML = `<div class="panel">${html}</div>`;
  s.classList.remove("hidden");
  s.onclick = (e) => { if (e.target === s || e.target.hasAttribute("data-close")) s.classList.add("hidden"); };
  wire && wire(s);
}

async function onAction(job, act) {
  try {
    if (act === "take") return await doUpdate(job, { action: "take" });
    if (act === "start") return await doUpdate(job, { action: "start" });
    if (act === "note" || act === "wait") {
      const title = act === "wait" ? "What are you waiting for?" : "Add a note";
      const ph = act === "wait" ? "e.g. new lock from the supplier, guest in the room" : "";
      return openSheet(`<h2>${title}</h2><p class="muted">${esc(job.building)} · ${esc(job.room)}</p>
        <textarea id="noteTxt" class="t" placeholder="${ph}"></textarea><p></p>
        <div class="row"><button class="btn light" data-close>Cancel</button><button class="btn gold" id="noteSave">Save</button></div>`, () => {
        $("#noteTxt").focus();
        $("#noteSave").onclick = async () => {
          const note = $("#noteTxt").value.trim();
          if (!note) return;
          try { await doUpdate(job, { action: act, note }); } catch (e) { toast(e.message); }
        };
      });
    }
    if (act === "done") {
      let after = null;
      const needPhoto = state.user.role !== "manager";
      return openSheet(`<h2>Mark as fixed</h2><p class="muted">${esc(job.building)} · ${esc(job.room)} — ${esc(catLabel(job.category))}</p>
        <label class="f" for="doneNote">What did you do? (optional)</label>
        <textarea id="doneNote" class="t" placeholder="e.g. replaced the tap washer"></textarea>
        <label class="f">Photo of the fix${needPhoto ? ` <span style="color:var(--red)">(required)</span>` : " (optional)"}</label>
        <div class="photo-pick"><span id="afterPrev"></span>
          <label class="btn light small" for="afterPhoto">Take or add photo</label>
          <input id="afterPhoto" type="file" accept="image/*" capture="environment" class="hidden"><span id="afterMsg" class="muted">${needPhoto ? "You can't mark it fixed without a photo." : ""}</span></div>
        ${job.blocking ? `<p class="goes-to">Once saved, this room is no longer marked out of order.</p>` : ""}<p></p>
        <div class="row"><button class="btn light" data-close>Cancel</button><button class="btn green" id="doneSave" ${needPhoto ? "disabled" : ""}>Save — it's fixed</button></div>`, () => {
        $("#afterPhoto").onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          $("#afterMsg").textContent = "Uploading…";
          $("#doneSave").disabled = true;
          try {
            const r = await uploadPhoto(file);
            after = r.key;
            $("#afterPrev").innerHTML = `<img src="${r.dataUrl}" alt="">`;
            $("#afterMsg").textContent = "";
          } catch (err) { $("#afterMsg").textContent = err.message; }
          $("#doneSave").disabled = needPhoto && !after;
        };
        $("#doneSave").onclick = async () => {
          try { await doUpdate(job, { action: "done", note: $("#doneNote").value, afterPhoto: after }); toast("Marked as fixed"); } catch (e) { toast(e.message); }
        };
      });
    }
    if (act === "manage") {
      const team = state.config.team;
      return openSheet(`<h2>Manage job</h2><p class="muted">${esc(job.building)} · ${esc(job.room)} — ${esc(catLabel(job.category))}</p>
        <label class="f" for="mAssign">Who should fix it?</label>
        <select id="mAssign" class="t"><option value="">Not assigned</option>
          ${team.map((t) => `<option value="${t.id}" ${job.assignee === t.id ? "selected" : ""}>${esc(t.name)} — ${esc(t.skills)}</option>`).join("")}</select>
        <label class="f" for="mTime">How long will it take?</label>
        <select id="mTime" class="t">${[15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 960, 1440]
          .concat([jobMins(job)]).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b)
          .map((m) => `<option value="${m}" ${m === jobMins(job) ? "selected" : ""}>${m >= 480 ? fmtH(m) + " (" + Math.round(m / 48) / 10 + " day" + (m > 480 ? "s" : "") + ")" : fmtH(m)}</option>`).join("")}</select>
        <label class="f">Room status</label>
        <div class="yn">
          <button type="button" class="opt good ${!job.blocking ? "on" : ""}" data-blk="0">Can be sold</button>
          <button type="button" class="opt bad ${job.blocking ? "on" : ""}" data-blk="1">Out of order</button>
        </div><p></p>
        <div class="row">
          ${job.status === "done" ? `<button class="btn light" id="mReopen">Reopen job</button>` : ""}
          <button class="btn light" data-close>Close</button>
          <button class="btn gold" id="mSave">Save</button>
        </div>`, () => {
        let blk = job.blocking;
        document.querySelectorAll("[data-blk]").forEach((b) => (b.onclick = () => {
          blk = b.dataset.blk === "1";
          document.querySelectorAll("[data-blk]").forEach((x) => x.classList.toggle("on", x === b));
        }));
        if ($("#mReopen")) $("#mReopen").onclick = async () => { try { await doUpdate(job, { action: "reopen" }); } catch (e) { toast(e.message); } };
        $("#mSave").onclick = async () => {
          try {
            const a = $("#mAssign").value || null;
            const t = +$("#mTime").value;
            if (a !== (job.assignee || null)) await doUpdate(job, { action: "assign", assignee: a || "" });
            const fresh = state.jobs.find((j) => j.id === job.id);
            if (blk !== fresh.blocking) await doUpdate(fresh, { action: "blocking", blocking: blk });
            if (t !== jobMins(job)) await doUpdate(state.jobs.find((j) => j.id === job.id), { action: "estimate", minutes: t });
            render();
          } catch (e) { toast(e.message); }
        };
      });
    }
  } catch (e) {
    toast(e.message);
  }
}

function list(jobs, emptyMsg) {
  return jobs.length ? jobs.map(jobCard).join("") : `<div class="empty">${emptyMsg}</div>`;
}

// Handyman's job card: one big button that changes as the job moves on; the rest under "More".
function startTimeOf(j) {
  const segs = (state.plan.person[state.user.team] || {}).segs || [];
  const d = state.plan.jobDay[j.id];
  const sg = d !== undefined && (segs[d] || []).find((x) => x.job.id === j.id);
  return sg ? hhmm(sg.start) : null;
}
function handyCard(j, opts = {}) {
  const me = state.user.team;
  const at = j.assignee === me && j.status !== "waiting" && j.status !== "in_progress" ? startTimeOf(j) : null;
  const mine = j.assignee === me;
  let primary = "";
  if (!j.assignee) primary = `<button class="btn gold big" data-act="take">Take this job</button>`;
  else if (mine && j.status === "in_progress") primary = `<button class="btn green big" data-act="done">✓ Fixed — take photo</button>`;
  else if (mine && j.status === "waiting") primary = `<button class="btn big" data-act="start">▶ Start again</button>`;
  else if (mine) primary = `<button class="btn big" data-act="start">▶ Start</button>`;
  const waitText = j.status === "waiting" ? (j.history.filter((h) => h.text.startsWith("Waiting:")).pop() || { text: "" }).text.replace("Waiting: ", "") : "";
  const more = mine ? `<details class="more"><summary>More</summary><div class="row">
      ${j.status !== "in_progress" ? `<button class="btn light small" data-act="done">Mark fixed</button>` : ""}
      ${j.status !== "waiting" ? `<button class="btn light small" data-act="wait">Waiting for…</button>` : ""}
      <button class="btn light small" data-act="note">Add note</button></div></details>` : "";
  return `<div class="card job hcard ${j.blocking ? "blocking" : ""} ${opts.next ? "next" : ""}" data-id="${j.id}">
    ${opts.next ? `<div class="nextlbl">${j.status === "in_progress" ? "You're working on" : "Next job"}</div>` : ""}
    <div class="hhead"><div><div class="where">${esc(j.building)} · ${esc(j.room)}</div>
    <div class="what">${esc(catLabel(j.category))}</div></div>${at ? `<div class="at">${at}</div>` : ""}</div>
    <div class="badges">
      ${j.blocking ? `<span class="badge b-out">Room out of order</span>` : ""}
      ${j.status === "in_progress" ? `<span class="badge b-in_progress">Busy</span>` : ""}
      ${j.status === "waiting" ? `<span class="badge b-waiting">Waiting: ${esc(waitText)}</span>` : ""}
      ${j.recurringId ? `<span class="badge b-plan">Planned job</span>` : ""}
      <span class="badge b-time">~${fmtH(jobMins(j))}</span>
    </div>
    ${j.description ? `<div class="desc">${esc(j.description)}</div>` : ""}
    ${j.photo ? `<div class="thumbs"><img src="${photoUrl(j.photo)}" data-full="${photoUrl(j.photo)}" alt="Problem photo" loading="lazy"></div>` : ""}
    ${primary}
    ${more}
  </div>`;
}

// Out-of-order rooms first, then the rest grouped by building so he finishes one building before the next.
function routeOrder(list) {
  const urgent = list.slice().sort(planOrder);
  const order = [];
  urgent.forEach((j) => { if (!order.includes(j.building)) order.push(j.building); });
  return urgent.sort((a, b) => ((b.status === "in_progress") - (a.status === "in_progress")) || (b.blocking - a.blocking)
    || (order.indexOf(a.building) - order.indexOf(b.building)) || (a.createdAt - b.createdAt));
}
function withBuildingHeads(list) {
  let last = null;
  return list.map((j) => {
    const key = j.blocking ? "!out" : j.building;
    const head = key !== last ? `<div class="bhead">${j.blocking ? "🔴 Rooms out of order — do these first" : "📍 " + esc(j.building)}</div>` : "";
    last = key;
    return head + handyCard(j);
  }).join("");
}

function renderMine() {
  const me = state.user.team;
  const myBuildings = (state.config.team.find((t) => t.id === me) || { buildings: [] }).buildings;
  const plan = state.plan;
  const planned = state.jobs.filter((j) => isActive(j) && j.assignee === me && j.status !== "waiting");
  const waiting = state.jobs.filter((j) => j.status === "waiting" && j.assignee === me);
  const unassigned = state.jobs.filter((j) => isActive(j) && !j.assignee).sort((a, b) => (myBuildings.includes(b.building) - myBuildings.includes(a.building)) || byPriority(a, b));
  const now = new Date();
  const doneToday = state.jobs.filter((j) => j.status === "done" && j.assignee === me && j.doneAt && sameDay(j.doneAt, now));
  const off = dayOffOf(me) === now.getDay();
  const groups = {};
  for (const j of planned) (groups[plan.jobDay[j.id] ?? 0] = groups[plan.jobDay[j.id] ?? 0] || []).push(j);
  const days = Object.keys(groups).map(Number).sort((a, b) => a - b);
  for (const d of days) groups[d] = routeOrder(groups[d]);
  const next = days.length ? groups[days[0]][0] : null;
  if (next) groups[days[0]] = groups[days[0]].slice(1);
  const todayLeft = (groups[0] || []).length + (next && days[0] === 0 ? 1 : 0);
  const total = doneToday.length + todayLeft;
  const pct = total ? Math.round((doneToday.length / total) * 100) : 0;
  const used = plan.person[me] ? plan.person[me].used : [];

  $("#app").innerHTML = `
    ${off ? `<div class="goes-to" style="margin-bottom:10px">Today is your day off. These jobs are for your next working days.</div>` : ""}
    ${total ? `<div class="progress-wrap"><div class="progress"><div style="width:${pct}%"></div></div>
      <div class="progress-text"><b>${doneToday.length} of ${total}</b> done today${todayLeft ? ` · about ${fmtH(used[0] || 0)} of work left` : " · all done 👍"}</div></div>` : ""}
    ${next ? handyCard(next, { next: true }) : `<div class="empty">No jobs for you right now. 👍</div>`}
    ${days.map((d) => groups[d].length ? `<h3>${d === 0 ? "Rest of today" : dayLabel(d)}</h3>${withBuildingHeads(groups[d])}` : "").join("")}
    ${waiting.length ? `<h3>Waiting for something</h3>${waiting.map((j) => handyCard(j)).join("")}` : ""}
    ${unassigned.length ? `<h3>Nobody has these yet</h3>${unassigned.map((j) => handyCard(j)).join("")}` : ""}
    ${doneToday.length ? `<h3>Fixed today</h3><div class="card">${doneToday.sort((a, b) => b.doneAt - a.doneAt).map((j) => `<div class="doneline">✓ ${esc(j.building)} ${esc(j.room)} — ${esc(catLabel(j.category))} <span class="muted">${shortTime(j.doneAt)}</span></div>`).join("")}</div>` : ""}`;
  wireCards();
}

function renderPlanner() {
  const plan = state.plan;
  const { moves, warnings } = state.advice;
  const ws = workers();
  const NDAYS = 7;
  const full = (state.config.work.end - state.config.work.start) * 60;
  const cell = (w, d) => {
    const cap = d === 0 ? capacity(w.id, 0, plan.now) : capacity(w.id, d, plan.now);
    if (dayOffOf(w.id) === dateAt(d).getDay()) return `<td class="off">Off</td>`;
    const u = plan.person[w.id].used[d] || 0;
    const pct = cap ? u / cap : u ? 1 : 0;
    const cls = !cap ? "gone" : pct >= 0.99 ? "full" : pct >= 0.5 ? "mid" : d === 0 ? "low" : "free";
    return `<td class="${cls}" data-w="${w.id}" data-d="${d}"><b>${u ? fmtH(u) : "–"}</b><small>${d === 0 ? "of " + fmtH(cap) + " left" : "of " + fmtH(full)}</small></td>`;
  };
  $("#app").innerHTML = `
    <h2>Planner</h2>
    ${warnings.length ? warnings.map((w) => `<div class="warnline ${w.level}">${esc(w.text)}</div>`).join("") : `<div class="warnline ok">Everyone has a full day and nobody is over-booked.</div>`}

    <h3>Suggested moves</h3>
    ${moves.length ? moves.map((m, i) => `<div class="card move">
        <div class="where">${esc(m.job.building)} · ${esc(m.job.room)} <span class="muted" style="font-weight:400">— ${esc(catLabel(m.job.category))}, ~${fmtH(jobMins(m.job))}</span></div>
        <div style="margin:4px 0 8px">${m.from ? `Move from <b>${esc(teamName(m.from))}</b> to <b>${esc(teamName(m.to))}</b>` : `Give to <b>${esc(teamName(m.to))}</b>`}${m.job.blocking ? ` <span class="badge b-out">Room out of order</span>` : ""}</div>
        <div class="muted" style="font-size:14px">${esc(m.why)}</div>
        <div class="row" style="margin-top:10px"><button class="btn gold small" data-move="${i}">${m.from ? "Move" : "Assign"} to ${esc(teamName(m.to))}</button><button class="btn light small" data-skip="${i}">Not now</button></div>
      </div>`).join("") : `<div class="empty" style="padding:14px">No moves to suggest.</div>`}

    <h3>This week</h3>
    <div class="weekwrap"><table class="week">
      <tr><th></th>${Array.from({ length: NDAYS }, (_, d) => `<th>${dayLabel(d, true)}</th>`).join("")}</tr>
      ${ws.map((w) => `<tr><th>${esc(w.name)}</th>${Array.from({ length: NDAYS }, (_, d) => cell(w, d)).join("")}</tr>`).join("")}
    </table></div>
    <p class="muted" style="font-size:13px;margin:6px 4px">Hours of work booked each day (${state.config.work.start}:00–${state.config.work.end}:00). Tap a day to see the jobs. Jobs marked "Waiting" are not counted.</p>

    <h3>Days off</h3>
    <div class="card">
      ${ws.map((w) => `<div class="dayoff"><span>${esc(w.name)}</span><select data-off="${w.id}">
        <option value="">Not set</option>${DAYS.map((n, i) => `<option value="${i}" ${dayOffOf(w.id) === i ? "selected" : ""}>${n}</option>`).join("")}</select></div>`).join("")}
      <button class="btn gold block" id="saveOff" style="margin-top:12px">Save days off</button>
    </div>
    <h3>Staff logins</h3>
    <div class="card" id="staffLogins"><p class="muted">Loading…</p></div>`;

  document.querySelectorAll("[data-move]").forEach((b) => (b.onclick = async () => {
    const m = moves[+b.dataset.move];
    try { await doUpdate(m.job, { action: "assign", assignee: m.to }); toast(`${m.job.building} ${m.job.room} given to ${teamName(m.to)}`); } catch (e) { toast(e.message); }
  }));
  document.querySelectorAll("[data-skip]").forEach((b) => (b.onclick = () => {
    const m = moves[+b.dataset.skip];
    state.dismissed.add(m.job.id + ">" + m.to);
    render();
  }));
  document.querySelectorAll("td[data-w]").forEach((td) => (td.onclick = () => {
    const w = td.dataset.w, d = +td.dataset.d;
    const js = (plan.person[w].jobsByDay[d] || []);
    openSheet(`<h2>${esc(teamName(w))} — ${dayLabel(d)}</h2>${js.length ? js.map(jobCard).join("") : `<div class="empty">Nothing booked.</div>`}
      <button class="btn light block" data-close>Close</button>`, (s) => {
      s.querySelectorAll(".job").forEach((card) => {
        const job = state.jobs.find((j) => j.id === card.dataset.id);
        card.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => onAction(job, b.dataset.act)));
      });
    });
  }));
  renderStaffLogins();
  $("#saveOff").onclick = async () => {
    const daysOff = {};
    document.querySelectorAll("[data-off]").forEach((s) => (daysOff[s.dataset.off] = s.value === "" ? null : +s.value));
    try {
      const r = await api("settings", { method: "POST", body: { daysOff } });
      state.config.settings = r.settings;
      toast("Days off saved");
      render();
    } catch (e) { toast(e.message); }
  };
}

function renderStatus() {
  const active = state.jobs.filter(isActive).sort(byPriority);
  const done = state.jobs.filter((j) => !isActive(j)).sort((a, b) => b.doneAt - a.doneAt).slice(0, 15);
  $("#app").innerHTML = `<h2>Job status</h2>${list(active, "No open jobs.")}${done.length ? `<h3>Recently fixed</h3>${list(done, "")}` : ""}`;
  wireCards();
}

function renderAll() {
  const cfg = state.config;
  const fl = state.filters;
  const active = state.jobs.filter(isActive);
  const outRooms = new Set(active.filter((j) => j.blocking).map((j) => j.building + "|" + j.room)).size;
  const weekAgo = Date.now() - 7 * 864e5;
  const doneWeek = state.jobs.filter((j) => j.status === "done" && j.doneAt > weekAgo).length;
  const unassigned = active.filter((j) => !j.assignee).length;

  let shown = state.jobs.filter((j) => (fl.status === "active" ? isActive(j) : fl.status === "done" ? !isActive(j) : j.status === fl.status));
  if (fl.building) shown = shown.filter((j) => j.building === fl.building);
  if (fl.person) shown = shown.filter((j) => (fl.person === "none" ? !j.assignee : j.assignee === fl.person));
  shown.sort(fl.status === "done" ? (a, b) => b.doneAt - a.doneAt : (a, b) => (!a.assignee === !b.assignee ? 0 : a.assignee ? 1 : -1) || byPriority(a, b));

  const perPerson = cfg.team.map((t) => `${esc(t.name)}: <b>${active.filter((j) => j.assignee === t.id).length}</b>`).join(" · ");

  $("#app").innerHTML = `
    <div class="stats">
      <div class="stat red"><b>${outRooms}</b><span>Rooms out of order</span></div>
      <div class="stat"><b>${active.length}</b><span>Open jobs</span></div>
      <div class="stat ${unassigned ? "red" : ""}"><b>${unassigned}</b><span>Not assigned</span></div>
      <div class="stat"><b>${doneWeek}</b><span>Fixed this week</span></div>
    </div>
    <p class="muted" style="font-size:14px;margin:4px">Open jobs per person — ${perPerson}</p>
    <div class="filters">
      <select id="fStatus">
        ${[["active", "Open jobs"], ["open", "Not started"], ["in_progress", "Busy"], ["waiting", "Waiting"], ["done", "Fixed (last 14 days)"]]
          .map(([v, l]) => `<option value="${v}" ${fl.status === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
      <select id="fBuilding"><option value="">All buildings</option>${cfg.buildings.map((b) => `<option ${fl.building === b ? "selected" : ""}>${esc(b)}</option>`).join("")}</select>
      <select id="fPerson"><option value="">Everyone</option><option value="none" ${fl.person === "none" ? "selected" : ""}>Not assigned</option>
        ${cfg.team.map((t) => `<option value="${t.id}" ${fl.person === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
    </div>
    ${list(shown, "Nothing here.")}`;
  $("#fStatus").onchange = (e) => { fl.status = e.target.value; renderAll(); };
  $("#fBuilding").onchange = (e) => { fl.building = e.target.value; renderAll(); };
  $("#fPerson").onchange = (e) => { fl.person = e.target.value; renderAll(); };
  wireCards();
}

// ---------- daily report
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const sameDay = (ts, d) => { const x = new Date(ts); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate(); };
const signedH = (m) => (m > 0 ? "+" : m < 0 ? "−" : "") + fmtH(Math.abs(m)).replace("0 min", "0 h");
const varCls = (m) => (m > 0 ? "over" : m < 0 ? "under" : "");
// Budget counts from the first day the app was used, and only the hours already worked today.
function trackingStart() {
  const all = state.allJobs || state.jobs;
  if (!all.length) return null;
  const d = new Date(Math.min(...all.map((j) => j.createdAt))); d.setHours(0, 0, 0, 0);
  return d;
}
function budgetFor(id, d) {
  const { start, end } = state.config.work;
  const ts = trackingStart();
  if (dayOffOf(id) === d.getDay() || !ts || d < ts) return 0;
  const now = new Date();
  if (sameDay(now.getTime(), d)) {
    const n = now.getHours() * 60 + now.getMinutes();
    return Math.max(0, Math.min(end * 60, n) - start * 60);
  }
  return d > now ? 0 : (end - start) * 60;
}
function fixedOn(id, d) { return (state.allJobs || state.jobs).filter((j) => j.status === "done" && j.assignee === id && j.doneAt && sameDay(j.doneAt, d)); }
function perfRange(id, from, to) {
  let budget = 0, done = 0, jobs = 0;
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    budget += budgetFor(id, d);
    const f = fixedOn(id, d);
    jobs += f.length;
    done += f.reduce((s, j) => s + jobMins(j), 0);
  }
  return { budget, done, jobs, diff: done - budget };
}

// When he tapped Start on this job (last time before it was fixed), if he did.
function startedAt(j) {
  if (j.startedAt && j.startedAt <= (j.doneAt || Infinity)) return j.startedAt;
  const h = (j.history || []).filter((x) => x.text === "Started work" && x.at <= (j.doneAt || Infinity)).pop();
  return h ? h.at : null;
}
function takenText(j) {
  const s = startedAt(j);
  if (!s || !j.doneAt || !sameDay(s, new Date(j.doneAt))) return `<span class="muted">not timed</span>`;
  return fmtH(Math.max(1, Math.round((j.doneAt - s) / 60000)));
}
const shortDate = (ts) => new Date(ts).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const shortTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function ageText(from, to) {
  const m = Math.round((to - from) / 60000);
  if (m < 60) return m + " min";
  if (m < 48 * 60) return Math.round(m / 60) + " h";
  return Math.round(m / 1440) + " days";
}

function detailSection(w, from, to, periodLabel) {
  const days = [];
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const dayRows = days.map((d) => {
    const f = fixedOn(w.id, d);
    const b = budgetFor(w.id, d), dn = f.reduce((s, j) => s + jobMins(j), 0);
    return { d, b, dn, n: f.length, off: dayOffOf(w.id) === d.getDay() };
  });
  const B = dayRows.reduce((s, r) => s + r.b, 0), DN = dayRows.reduce((s, r) => s + r.dn, 0);
  const workDays = dayRows.filter((r) => r.b > 0).length;
  const offDays = dayRows.filter((r) => r.off);
  const fixed = days.flatMap((d) => fixedOn(w.id, d)).sort((a, b) => a.doneAt - b.doneAt);
  const open = state.jobs.filter((j) => isActive(j) && j.assignee === w.id).sort(planOrder);
  const now = Date.now();
  const diff = DN - B;
  return `<section class="detail">
    <h3 class="pagebreak">${esc(w.name)} — job detail, ${esc(periodLabel)}</h3>
    <div class="explain">
      <div><span class="muted">Budget</span><b>${fmtH(B)}</b><small>${workDays} working day${workDays === 1 ? "" : "s"} × up to ${fmtH((state.config.work.end - state.config.work.start) * 60)}${offDays.length ? `, ${offDays.length} day off` : ""}</small></div>
      <div class="op">−</div>
      <div><span class="muted">Done</span><b>${fmtH(DN)}</b><small>${fixed.length} job${fixed.length === 1 ? "" : "s"} fixed, at their set times</small></div>
      <div class="op">=</div>
      <div><span class="muted">Over / under</span><b class="${varCls(diff)}">${signedH(diff)}</b><small>${diff < 0 ? `${fmtH(-diff)} of paid time not covered by fixed jobs` : diff > 0 ? `${fmtH(diff)} more work than his hours` : "exactly on budget"}</small></div>
    </div>

    <table class="rep detail-days">
      <tr><th>Day</th>${dayRows.map((r) => `<th class="num">${r.d.toLocaleDateString([], { weekday: "short", day: "numeric" })}</th>`).join("")}<th class="num">Total</th></tr>
      <tr><th>Budget</th>${dayRows.map((r) => `<td class="num">${r.off ? `<span class="muted">off</span>` : fmtH(r.b)}</td>`).join("")}<td class="num"><b>${fmtH(B)}</b></td></tr>
      <tr><th>Done</th>${dayRows.map((r) => `<td class="num">${fmtH(r.dn)}${r.n ? ` <span class="muted">(${r.n})</span>` : ""}</td>`).join("")}<td class="num"><b>${fmtH(DN)}</b></td></tr>
      <tr><th>Over / under</th>${dayRows.map((r) => `<td class="num ${varCls(r.dn - r.b)}">${signedH(r.dn - r.b)}</td>`).join("")}<td class="num ${varCls(diff)}"><b>${signedH(diff)}</b></td></tr>
    </table>

    <h4>Jobs fixed (${fixed.length})</h4>
    ${fixed.length ? `<table class="rep jobs">
      <thead><tr><th>Fixed</th><th>Room</th><th>Problem</th><th>Reported</th><th class="num">Waited</th><th class="num">Set time</th><th class="num">Time taken</th><th>His note</th><th>Photo</th></tr></thead>
      ${fixed.map((j) => `<tr>
        <td class="nw">${shortDate(j.doneAt)} ${shortTime(j.doneAt)}</td>
        <td class="nw"><b>${esc(j.building)} ${esc(j.room)}</b>${j.blocking ? `<div class="muted">was out of order</div>` : ""}</td>
        <td>${esc(catLabel(j.category))}${j.description ? `<div class="muted">${esc(j.description)}</div>` : ""}</td>
        <td class="nw">${shortDate(j.createdAt)} ${shortTime(j.createdAt)}<div class="muted">by ${esc(j.createdBy)}</div></td>
        <td class="num">${ageText(j.createdAt, j.doneAt)}</td>
        <td class="num"><b>${fmtH(jobMins(j))}</b></td>
        <td class="num">${takenText(j)}</td>
        <td>${j.doneNote ? esc(j.doneNote) : `<span class="muted">–</span>`}</td>
        <td>${j.afterPhoto ? "✓" : `<span class="under">none</span>`}</td></tr>`).join("")}
      <tr class="total"><td colspan="5">Total counted as done</td><td class="num">${fmtH(DN)}</td><td colspan="3"></td></tr>
    </table>` : `<p class="muted">No jobs fixed in this period.</p>`}

    <h4>Still open (${open.length})</h4>
    ${open.length ? `<table class="rep jobs">
      <thead><tr><th>Room</th><th>Problem</th><th>Reported</th><th class="num">Open for</th><th>Status</th><th class="num">Set time</th><th>Planned</th></tr></thead>
      ${open.map((j) => `<tr>
        <td class="nw"><b>${esc(j.building)} ${esc(j.room)}</b>${j.blocking ? ` <span class="badge b-out">out of order</span>` : ""}</td>
        <td>${esc(catLabel(j.category))}${j.description ? `<div class="muted">${esc(j.description)}</div>` : ""}</td>
        <td class="nw">${shortDate(j.createdAt)}</td>
        <td class="num ${now - j.createdAt > 2 * 864e5 ? "under" : ""}">${ageText(j.createdAt, now)}</td>
        <td>${STATUS_LABEL[j.status]}${j.status === "waiting" ? `<div class="muted">${esc((j.history.filter((h) => h.text.startsWith("Waiting:")).pop() || { text: "" }).text.replace("Waiting: ", ""))}</div>` : ""}</td>
        <td class="num">${fmtH(jobMins(j))}</td>
        <td class="nw">${state.plan.jobDay[j.id] !== undefined ? dayLabel(state.plan.jobDay[j.id]) : `<span class="muted">–</span>`}</td></tr>`).join("")}
    </table>` : `<p class="muted">Nothing open.</p>`}
  </section>`;
}

async function renderDaily() {
  if (!state.reportDate) state.reportDate = ymd(new Date());
  if (!state.allJobs) {
    $("#app").innerHTML = `<p class="muted center pad">Loading report…</p>`;
    try { state.allJobs = (await api("jobs?all=1")).jobs; } catch (e) { $("#app").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (state.tab !== "daily") return;
  }
  const [y, mo, da] = state.reportDate.split("-").map(Number);
  const D = new Date(y, mo - 1, da, 12);
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const isToday = ymd(D) === ymd(today);
  const weekStart = new Date(D); weekStart.setDate(D.getDate() - ((D.getDay() + 6) % 7)); // Monday
  const monthStart = new Date(D.getFullYear(), D.getMonth(), 1, 12);
  const ws = workers();
  const rows = ws.map((w) => ({ w, day: perfRange(w.id, D, D), wtd: perfRange(w.id, weekStart, D), mtd: perfRange(w.id, monthStart, D),
    open: state.jobs.filter((j) => isActive(j) && j.assignee === w.id) }));
  const tot = (k) => rows.reduce((a, r) => ({ budget: a.budget + r[k].budget, done: a.done + r[k].done, jobs: a.jobs + r[k].jobs, diff: a.diff + r[k].diff }), { budget: 0, done: 0, jobs: 0, diff: 0 });
  const T = { day: tot("day"), wtd: tot("wtd"), mtd: tot("mtd") };
  const vcell = (p) => `<td class="num ${varCls(p.diff)}"><b>${signedH(p.diff)}</b></td>`;
  const longDate = D.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const plan = state.plan;
  const NDAYS = 7;
  const unsetOff = ws.filter((w) => dayOffOf(w.id) === null);

  $("#app").innerHTML = `
  <div class="report">
    <div class="rep-head">
      <div><h2 style="margin:0">Daily maintenance report</h2><div class="muted">${esc(longDate)}${isToday ? " · so far today" : ""}</div></div>
      <div class="row noprint"><input type="date" id="repDate" value="${state.reportDate}" max="${ymd(today)}" class="t" style="width:auto">
        <button class="btn light small" id="repPrint">Print / save PDF</button></div>
    </div>
    ${unsetOff.length ? `<div class="warnline info noprint">Days off are not set for ${unsetOff.map((w) => w.name).join(", ")}, so every day counts as a working day in their budget. Set them in Planner.</div>` : ""}

    <h3>Performance against budget</h3>
    <div class="weekwrap"><table class="rep">
      <tr><th rowspan="2">Maintenance</th><th colspan="4" class="grp">${isToday ? "Today" : "This day"}</th><th colspan="3" class="grp">Week to date</th><th colspan="3" class="grp">Month to date</th><th rowspan="2" class="num">Still open</th></tr>
      <tr><th class="num">Budget</th><th class="num">Done</th><th class="num">Jobs</th><th class="num">Over / under</th>
        <th class="num">Budget</th><th class="num">Done</th><th class="num">Over / under</th>
        <th class="num">Budget</th><th class="num">Done</th><th class="num">Over / under</th></tr>
      ${rows.map((r) => `<tr><th>${esc(r.w.name)}${dayOffOf(r.w.id) === D.getDay() ? ` <span class="muted" style="font-weight:400">(off)</span>` : ""}</th>
        <td class="num">${fmtH(r.day.budget)}</td><td class="num">${fmtH(r.day.done)}</td><td class="num">${r.day.jobs}</td>${vcell(r.day)}
        <td class="num">${fmtH(r.wtd.budget)}</td><td class="num">${fmtH(r.wtd.done)}</td>${vcell(r.wtd)}
        <td class="num">${fmtH(r.mtd.budget)}</td><td class="num">${fmtH(r.mtd.done)}</td>${vcell(r.mtd)}
        <td class="num">${r.open.length} · ${fmtH(r.open.reduce((s, j) => s + jobMins(j), 0))}</td></tr>`).join("")}
      <tr class="total"><th>Total</th>
        <td class="num">${fmtH(T.day.budget)}</td><td class="num">${fmtH(T.day.done)}</td><td class="num">${T.day.jobs}</td>${vcell(T.day)}
        <td class="num">${fmtH(T.wtd.budget)}</td><td class="num">${fmtH(T.wtd.done)}</td>${vcell(T.wtd)}
        <td class="num">${fmtH(T.mtd.budget)}</td><td class="num">${fmtH(T.mtd.done)}</td>${vcell(T.mtd)}
        <td class="num">${rows.reduce((s, r) => s + r.open.length, 0)}</td></tr>
    </table></div>
    <p class="muted small-note">Budget = working hours (${state.config.work.start}:00–${state.config.work.end}:00, nothing on a day off${isToday ? "; today only counts the hours worked so far" : ""}${trackingStart() ? `; counted from ${trackingStart().toLocaleDateString([], { day: "numeric", month: "short" })}, when the app was first used` : ""}). Done = the set time of each job they marked fixed. <span class="over">+ over</span> means more work done than budgeted, <span class="under">− under</span> means less.</p>

    <h3>Jobs fixed — ${esc(D.toLocaleDateString([], { day: "numeric", month: "short" }))}</h3>
    <div class="weekwrap"><table class="rep list">
      ${ws.map((w) => {
        const f = fixedOn(w.id, D).sort((a, b) => a.doneAt - b.doneAt);
        return `<tr><th>${esc(w.name)}</th><td>${f.length ? f.map((j) => `<div>${new Date(j.doneAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · <b>${esc(j.building)} ${esc(j.room)}</b> — ${esc(catLabel(j.category))} (${fmtH(jobMins(j))})${j.afterPhoto ? ' <span class="muted">📷</span>' : ""}${j.doneNote ? ` <span class="muted">“${esc(j.doneNote)}”</span>` : ""}</div>`).join("") : `<span class="muted">Nothing fixed</span>`}</td></tr>`;
      }).join("")}
    </table></div>

    <h3 class="pagebreak">Next 7 days — planned work</h3>
    <div class="weekwrap"><table class="rep plan7">
      <thead><tr><th></th>${Array.from({ length: NDAYS }, (_, d) => `<th>${dayLabel(d, true)}</th>`).join("")}</tr></thead>
      ${ws.map((w) => `<tr><th>${esc(w.name)}</th>${Array.from({ length: NDAYS }, (_, d) => {
        if (dayOffOf(w.id) === dateAt(d).getDay()) return `<td class="offc">Off</td>`;
        const js = plan.person[w.id].jobsByDay[d] || [];
        const used = plan.person[w.id].used[d] || 0;
        const cap = capacity(w.id, d, plan.now);
        return `<td><div class="cellh ${used >= cap && cap ? "fullh" : ""}">${used ? fmtH(used) : "0 h"} / ${fmtH(d === 0 ? cap : (state.config.work.end - state.config.work.start) * 60)}</div>
          ${js.map((j) => `<div class="pj ${j.blocking ? "blk" : ""}">${esc(j.building)} ${esc(j.room)}<br><span>${esc(catLabel(j.category).split(" (")[0])} · ${fmtH(jobMins(j))}</span></div>`).join("")}</td>`;
      }).join("")}</tr>`).join("")}
    </table></div>
    <p class="muted small-note">Planned from now, most urgent first. Red = room out of order. Jobs that are waiting or not assigned are not shown${state.jobs.filter((j) => isActive(j) && !j.assignee).length ? ` — <b>${state.jobs.filter((j) => isActive(j) && !j.assignee).length} job(s) not assigned yet</b>` : ""}.</p>

    <div class="rep-head noprint" style="margin-top:28px">
      <h3 style="margin:0">Job detail per person</h3>
      <select id="detailPeriod" class="t" style="width:auto">
        ${[["day", "This day"], ["wtd", "Week to date"], ["mtd", "Month to date"]].map(([v, l]) => `<option value="${v}" ${state.detailPeriod === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
    </div>
    <p class="muted small-note noprint">Each person's over/under figure broken down job by job, for performance meetings. When printed, each person starts on a new page.</p>
    ${(() => {
      const from = state.detailPeriod === "day" ? D : state.detailPeriod === "mtd" ? monthStart : weekStart;
      const label = state.detailPeriod === "day" ? D.toLocaleDateString([], { day: "numeric", month: "short" })
        : `${from.toLocaleDateString([], { day: "numeric", month: "short" })} – ${D.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`;
      return ws.map((w) => detailSection(w, from, D, label)).join("");
    })()}
    <p class="muted small-note">Set time = the standard time for that kind of job, used for the budget. Time taken = from when he tapped Start to when he marked it fixed (only if he tapped Start, the same day). Waited = from when it was reported to when it was fixed.</p>
  </div>`;
  $("#repDate").onchange = (e) => { if (e.target.value) { state.reportDate = e.target.value; renderDaily(); } };
  $("#repPrint").onclick = () => window.print();
  $("#detailPeriod").onchange = (e) => { state.detailPeriod = e.target.value; renderDaily(); };
}

// ---------- planned (recurring) jobs — managers
const fmtDate = (s) => { if (!s) return "–"; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" }); };
const everyText = (it) => it.every === 1 ? (it.unit === "weeks" ? "Every week" : "Every month") : it.unit === "months" && it.every % 12 === 0 ? `Every ${it.every / 12 === 1 ? "year" : it.every / 12 + " years"}` : `Every ${it.every} ${it.unit}`;

async function loadRecurring() {
  const r = await api("recurring");
  state.recurring = r.items;
  state.recToday = r.today;
}

async function renderPlanned() {
  if (!state.recurring) {
    $("#app").innerHTML = `<p class="muted center pad">Loading planned jobs…</p>`;
    try { await loadRecurring(); await loadJobs(); } catch (e) { $("#app").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (state.tab !== "planned") return;
    state.plan = buildPlan();
  }
  const cfg = state.config;
  const today = state.recToday;
  const soon = (() => { const [y, m, d] = today.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d + 14)); return x.toISOString().slice(0, 10); })();
  let items = state.recurring.slice();
  if (state.recBuilding) items = items.filter((it) => it.building === state.recBuilding);
  items.sort((a, b) => (b.active - a.active) || a.nextDue.localeCompare(b.nextDue) || a.building.localeCompare(b.building));
  const openJob = (it) => it.openJobId && state.jobs.find((j) => j.id === it.openJobId && j.status !== "done");
  const who = (it) => it.assignee ? teamName(it.assignee) : (teamName(suggest(it.building, it.category)) ? teamName(suggest(it.building, it.category)) + " (auto)" : "Manager picks");
  const dueSoon = state.recurring.filter((it) => it.active && it.nextDue <= soon).length;

  $("#app").innerHTML = `
    <h2>Planned jobs</h2>
    <p class="muted" style="margin:0 4px 10px">Jobs that come round again — geyser services, monthly baiting. On the due date each one becomes a normal job for the right person. When it is marked fixed, the next due date is set from that day.</p>
    <div class="filters">
      <select id="recB"><option value="">All buildings</option>${cfg.buildings.map((b) => `<option ${state.recBuilding === b ? "selected" : ""}>${esc(b)}</option>`).join("")}</select>
      <button class="btn gold small" id="recAdd">+ Add planned job</button>
    </div>
    <p class="muted" style="font-size:14px;margin:4px">${dueSoon} due in the next 14 days.</p>
    ${items.length ? items.map((it) => {
      const oj = openJob(it);
      const overdue = it.active && !oj && it.nextDue < today;
      return `<div class="card rec ${it.active ? "" : "done"}" data-rid="${it.id}">
        <div class="head"><div>
          <div class="where">${esc(it.building)} · ${esc(it.location || "—")}</div>
          <div class="what">${esc(it.title)}</div></div>
          <div class="muted" style="font-size:13px;white-space:nowrap">${esc(everyText(it))}</div></div>
        <div class="badges">
          ${!it.active ? `<span class="badge b-none">Paused</span>` : oj ? `<span class="badge b-${oj.status}">Job open · ${STATUS_LABEL[oj.status]}</span>` : `<span class="badge ${overdue ? "b-out" : it.nextDue <= soon ? "b-day" : "b-time"}">Next: ${esc(fmtDate(it.nextDue))}</span>`}
          <span class="badge b-who">${esc(who(it))}</span>
          <span class="badge b-time">~${fmtH(it.minutes)}</span>
          ${it.lastDone ? `<span class="badge b-done">Last done ${esc(fmtDate(it.lastDone))}</span>` : ""}
        </div>
        ${it.notes ? `<div class="desc">${esc(it.notes)}</div>` : ""}
        <div class="actions row"><button class="btn light small" data-redit="${it.id}">Edit</button>${it.active && !oj ? `<button class="btn small" data-rnow="${it.id}">Make the job now</button>` : ""}</div>
      </div>`;
    }).join("") : `<div class="empty">No planned jobs${state.recBuilding ? " for " + esc(state.recBuilding) : ""} yet.</div>`}
    <p class="muted small-note">Hot water: add each geyser as its own planned job (building + where it is, e.g. "Room 12" or "Roof"), or one job for a building's central hot water system. Buildings with no geysers need nothing.</p>`;

  $("#recB").onchange = (e) => { state.recBuilding = e.target.value; renderPlanned(); };
  $("#recAdd").onclick = () => editPlanned(null);
  document.querySelectorAll("[data-redit]").forEach((b) => (b.onclick = () => editPlanned(state.recurring.find((x) => x.id === b.dataset.redit))));
  document.querySelectorAll("[data-rnow]").forEach((b) => (b.onclick = async () => {
    try {
      await api(`recurring/${b.dataset.rnow}/now`, { method: "POST" });
      state.recurring = null; toast("Job created"); renderPlanned();
    } catch (e) { toast(e.message); }
  }));
}

function editPlanned(it) {
  const cfg = state.config;
  const isNew = !it;
  const v = it || { title: "Geyser service", building: state.recBuilding || "", location: "", category: "geyser", every: 12, unit: "months", minutes: 60, nextDue: state.recToday, assignee: "", active: true, notes: "" };
  const presets = [["Geyser service", "geyser", 12, "months", 60], ["Central hot water service", "geyser", 6, "months", 120], ["Cockroach baiting", "pest", 1, "months", 60]];
  openSheet(`<h2>${isNew ? "Add planned job" : "Edit planned job"}</h2>
    ${isNew ? `<div class="chips">${presets.map((p, i) => `<button type="button" class="chip ${v.title === p[0] ? "on" : ""}" data-pre="${i}">${esc(p[0])}</button>`).join("")}</div>` : ""}
    <label class="f" for="pTitle">What is the job?</label>
    <input id="pTitle" class="t" maxlength="80" value="${esc(v.title)}">
    <label class="f" for="pB">Building</label>
    <select id="pB" class="t"><option value="">Choose…</option>${cfg.buildings.map((b) => `<option ${v.building === b ? "selected" : ""}>${esc(b)}</option>`).join("")}</select>
    <label class="f" for="pLoc">Where in the building?</label>
    <input id="pLoc" class="t" maxlength="40" placeholder="e.g. Room 12, Roof, Plant room, All rooms" value="${esc(v.location)}">
    <label class="f" for="pCat">Kind of job (decides who gets it)</label>
    <select id="pCat" class="t">${cfg.categories.map((c) => `<option value="${c.id}" ${v.category === c.id ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
    <label class="f">How often?</label>
    <div class="row"><input id="pEvery" class="t" type="number" min="1" max="120" value="${v.every}" style="max-width:90px">
      <select id="pUnit" class="t"><option value="months" ${v.unit === "months" ? "selected" : ""}>months</option><option value="weeks" ${v.unit === "weeks" ? "selected" : ""}>weeks</option></select></div>
    <label class="f" for="pDue">Next due</label>
    <input id="pDue" class="t" type="date" value="${esc(v.nextDue)}">
    <label class="f" for="pMin">How long does it take?</label>
    <select id="pMin" class="t">${[15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480].concat([v.minutes]).filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b).map((m) => `<option value="${m}" ${m === v.minutes ? "selected" : ""}>${fmtH(m)}</option>`).join("")}</select>
    <label class="f" for="pWho">Who does it?</label>
    <select id="pWho" class="t"><option value="">Automatic (by building and kind of job)</option>${cfg.team.map((t) => `<option value="${t.id}" ${v.assignee === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
    <label class="f" for="pNotes">Notes for the handyman (optional)</label>
    <textarea id="pNotes" class="t" maxlength="300" placeholder="e.g. 150 L geyser, isolator in the cupboard">${esc(v.notes || "")}</textarea>
    ${isNew ? "" : `<label class="f"><input type="checkbox" id="pActive" ${v.active ? "checked" : ""}> Active (untick to pause it)</label>`}
    <p id="pErr" style="color:var(--red);min-height:1.2em"></p>
    <div class="row">
      ${isNew ? "" : `<button class="btn light" id="pDel">Delete</button>`}
      <button class="btn light" data-close>Cancel</button>
      <button class="btn gold" id="pSave">Save</button>
    </div>`, () => {
    document.querySelectorAll("[data-pre]").forEach((b) => (b.onclick = () => {
      const p = presets[+b.dataset.pre];
      $("#pTitle").value = p[0]; $("#pCat").value = p[1]; $("#pEvery").value = p[2]; $("#pUnit").value = p[3]; $("#pMin").value = p[4];
      if (p[1] === "pest" && !$("#pLoc").value) $("#pLoc").value = "All rooms";
      document.querySelectorAll("[data-pre]").forEach((x) => x.classList.toggle("on", x === b));
    }));
    $("#pSave").onclick = async () => {
      const body = { id: it ? it.id : undefined, title: $("#pTitle").value, building: $("#pB").value, location: $("#pLoc").value, category: $("#pCat").value,
        every: +$("#pEvery").value, unit: $("#pUnit").value, nextDue: $("#pDue").value, minutes: +$("#pMin").value, assignee: $("#pWho").value,
        notes: $("#pNotes").value, active: $("#pActive") ? $("#pActive").checked : true };
      try {
        await api("recurring", { method: "POST", body });
        state.recurring = null; toast("Saved"); renderPlanned();
      } catch (e) { $("#pErr").textContent = e.message; }
    };
    if ($("#pDel")) $("#pDel").onclick = async () => {
      if (!$("#pDel").dataset.sure) { $("#pDel").dataset.sure = "1"; $("#pDel").textContent = "Tap again to delete"; return; }
      try { await api(`recurring/${it.id}/delete`, { method: "POST" }); state.recurring = null; toast("Deleted"); renderPlanned(); } catch (e) { $("#pErr").textContent = e.message; }
    };
  });
}

// ---------- calendar (managers): one column per handyman, jobs as blocks through the day
const PX = 1.2; // pixels per minute
const TEAM_IDS = () => workers().map((w) => w.id);
const SHORT = { lock: "Lock", window: "Window", toilet: "Toilet", water: "Leak", geyser: "Geyser", bed: "Bed", power: "Power", light: "Light", appliance: "Appliance", paint: "Paint", pest: "Baiting", other: "Other" };
const shortCat = (id) => SHORT[id] || catLabel(id);
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
function blockClass(j) {
  if (j.status === "done") return "c-done";
  if (j.status === "in_progress") return "c-busy";
  if (j.blocking) return "c-out";
  if (j.recurringId) return "c-plan";
  return "c-open";
}

function renderCalendar() {
  const plan = state.plan;
  const d = state.calDay;
  const { start, end } = state.config.work;
  const ws = workers();
  const day = dateAt(d, plan.now);
  const H = (end - start) * 60 * PX;
  const nowMin = plan.now.getHours() * 60 + plan.now.getMinutes();
  const unassigned = state.jobs.filter((j) => isActive(j) && !j.assignee).sort(planOrder);
  const waiting = state.jobs.filter((j) => j.status === "waiting");
  const title = d === 0 ? "Today" : d === 1 ? "Tomorrow" : d === -1 ? "Yesterday" : day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });

  const blocksFor = (w) => {
    const out = [];
    // fixed jobs on that day, ending when they were marked fixed
    for (const j of state.jobs.filter((x) => x.status === "done" && x.assignee === w.id && x.doneAt && sameDay(x.doneAt, day))) {
      const t = new Date(j.doneAt), e = t.getHours() * 60 + t.getMinutes();
      const m = Math.min(jobMins(j), 240);
      out.push({ job: j, start: Math.max(start * 60, e - m), mins: Math.max(20, Math.min(m, e - start * 60)) });
    }
    if (d >= 0) for (const sg of (plan.person[w.id].segs[d] || [])) out.push(sg);
    return out.filter((b) => b.start < end * 60).map((b) => {
      const top = (b.start - start * 60) * PX, h = Math.max(26, Math.min(b.mins, end * 60 - b.start) * PX - 3);
      const j = b.job;
      return `<div class="cblock ${blockClass(j)} ${j.status !== "done" ? "draggable" : ""}" data-cal="${j.id}" style="top:${top}px;height:${h}px">
        <b>${esc(j.building)} ${esc(j.room)}</b><span>${b.pinned ? "📌 " : ""}${hhmm(b.start)} · ${esc(shortCat(j.category))}</span></div>`;
    }).join("");
  };

  $("#app").innerHTML = `
    <div class="calhead">
      <button class="btn light small" id="calPrev" ${d <= -7 ? "disabled" : ""}>‹</button>
      <div class="caltitle"><b>${esc(title)}</b><small>${d === 0 || Math.abs(d) > 1 ? "" : day.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</small></div>
      <button class="btn light small" id="calNext" ${d >= 13 ? "disabled" : ""}>›</button>
      ${d !== 0 ? `<button class="btn light small" id="calToday">Today</button>` : ""}
    </div>
    ${unassigned.length ? `<div class="unstrip"><div class="unlabel">Not assigned (${unassigned.length}) — tap to give to someone</div>
      <div class="unrow">${unassigned.map((j) => `<button class="cchip draggable ${j.blocking ? "c-out" : "c-open"}" data-cal="${j.id}"><b>${esc(j.building)} ${esc(j.room)}</b><span>${esc(shortCat(j.category))} · ${fmtH(jobMins(j))}</span></button>`).join("")}</div></div>` : ""}
    <div class="calwrap"><div class="cal" style="--cols:${ws.length}">
      <div class="ccol gutter"><div class="chead"></div><div class="cbody" style="height:${H}px">
        ${Array.from({ length: end - start + 1 }, (_, i) => `<div class="hr" style="top:${i * 60 * PX}px">${start + i}:00</div>`).join("")}</div></div>
      ${ws.map((w) => {
        const off = dayOffOf(w.id) === day.getDay();
        const used = d >= 0 ? (plan.person[w.id].used[d] || 0) : 0;
        return `<div class="ccol"><div class="chead"><b>${esc(w.name)}</b><small>${off ? "Off" : d >= 0 ? fmtH(used) + " booked" : ""}</small></div>
          <div class="cbody ${off ? "off" : ""}" data-w="${w.id}" ${off ? "data-off=\"1\"" : ""} style="height:${H}px">
            ${Array.from({ length: end - start }, (_, i) => `<div class="line" style="top:${i * 60 * PX}px"></div>`).join("")}
            ${off ? `<div class="offtxt">Day off</div>` : blocksFor(w)}
            ${d === 0 && nowMin > start * 60 && nowMin < end * 60 ? `<div class="nowline" style="top:${(nowMin - start * 60) * PX}px"></div>` : ""}
          </div></div>`;
      }).join("")}
    </div></div>
    <div class="legend"><span class="c-out">Room out of order</span><span class="c-busy">Busy</span><span class="c-open">To do</span><span class="c-plan">Planned job</span><span class="c-done">Fixed</span></div>
    ${waiting.length ? `<p class="muted small-note">${waiting.length} job${waiting.length === 1 ? " is" : "s are"} waiting for something and not on the calendar — see All jobs.</p>` : ""}
    <p class="muted small-note">Drag a job to another person or time (on a phone: press and hold, then drag). 📌 = a time you booked; the rest are worked out from each job's set time, most urgent first. Tap a job to see it.</p>`;

  $("#calPrev").onclick = () => { state.calDay--; renderCalendar(); };
  $("#calNext").onclick = () => { state.calDay++; renderCalendar(); };
  if ($("#calToday")) $("#calToday").onclick = () => { state.calDay = 0; renderCalendar(); };
  document.querySelectorAll("[data-cal]").forEach((el) => {
    const job = state.jobs.find((j) => j.id === el.dataset.cal);
    if (job && job.status !== "done" && d >= 0) enableDrag(el, job, day);
    else el.onclick = () => calJob(job);
  });
}

// Drag a job on the calendar to another person and/or time. Mouse: just drag.
// Touch: press and hold for a moment, then drag (so normal scrolling still works).
function enableDrag(el, job, day) {
  const { start, end } = state.config.work;
  let sx = 0, sy = 0, dragging = false, timer = null, ghost = null, grabY = 0, pid = null, target = null, mins = null;
  const pickTarget = (x, y) => {
    const under = document.elementFromPoint(x, y);
    const col = under && under.closest(".cbody[data-w]");
    document.querySelectorAll(".cbody.droptarget").forEach((c) => c !== col && c.classList.remove("droptarget"));
    if (!col || col.dataset.off) { target = null; return; }
    col.classList.add("droptarget");
    const r = col.getBoundingClientRect();
    let m = start * 60 + Math.round((y - grabY - r.top) / PX / 15) * 15;
    m = Math.max(start * 60, Math.min(end * 60 - 15, m));
    target = col.dataset.w; mins = m;
  };
  const begin = (x, y) => {
    dragging = true;
    const r = el.getBoundingClientRect();
    grabY = el.classList.contains("cchip") ? 10 : y - r.top;
    ghost = el.cloneNode(true);
    ghost.classList.add("ghost");
    Object.assign(ghost.style, { position: "fixed", left: r.left + "px", top: r.top + "px", width: Math.max(r.width, 90) + "px", height: el.classList.contains("cchip") ? "auto" : r.height + "px" });
    document.body.appendChild(ghost);
    el.classList.add("dragging");
    document.addEventListener("touchmove", stopScroll, { passive: false });
    move(x, y);
  };
  const move = (x, y) => {
    ghost.style.transform = `translate(${x - sx}px, ${y - sy}px)`;
    pickTarget(x, y);
    const lab = ghost.querySelector("span");
    if (lab) lab.textContent = target ? `${teamName(target)} · ${hhmm(mins)}` : "Drop on a person's column";
  };
  const stopScroll = (e) => e.preventDefault();
  const finish = async () => {
    clearTimeout(timer);
    document.removeEventListener("touchmove", stopScroll);
    document.querySelectorAll(".cbody.droptarget").forEach((c) => c.classList.remove("droptarget"));
    if (ghost) ghost.remove();
    el.classList.remove("dragging");
    if (!dragging) return;
    dragging = false;
    if (!target) return;
    try {
      await doUpdate(job, { action: "schedule", assignee: target, date: ymd(day), start: mins });
      toast(`${job.building} ${job.room} → ${teamName(target)} at ${hhmm(mins)}`);
    } catch (e) { toast(e.message); }
  };
  el.onclick = (e) => { if (el.dataset.justDragged) { delete el.dataset.justDragged; return; } calJob(job); };
  el.addEventListener("pointerdown", (e) => {
    if (e.button && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; pid = e.pointerId; dragging = false;
    if (e.pointerType === "touch") timer = setTimeout(() => { begin(sx, sy); if (navigator.vibrate) navigator.vibrate(15); }, 350);
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pid) return;
    const far = Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 6;
    if (!dragging) {
      if (e.pointerType === "touch") { if (far) clearTimeout(timer); return; }
      if (far && e.buttons === 1) { el.setPointerCapture(e.pointerId); begin(e.clientX, e.clientY); }
      return;
    }
    e.preventDefault();
    move(e.clientX, e.clientY);
  });
  el.addEventListener("pointerup", (e) => { if (dragging) { el.dataset.justDragged = "1"; } finish(); pid = null; });
  el.addEventListener("pointercancel", () => { dragging = false; finish(); pid = null; });
  if (window.matchMedia("(pointer: coarse)").matches) el.addEventListener("contextmenu", (e) => e.preventDefault());
}

function calJob(job) {
  if (!job) return;
  const sug = suggest(job.building, job.category);
  const ws = workers();
  const canMove = job.status !== "done";
  openSheet(`${jobCard(job)}
    ${canMove ? `<label class="f">${job.assignee ? "Give to someone else" : "Give this job to"}</label>
    <div class="chips">${ws.map((w) => `<button type="button" class="chip ${job.assignee === w.id ? "on" : ""}" data-give="${w.id}">${esc(w.name)}${w.id === sug ? " ★" : ""}${w.can.includes(job.category) ? "" : " (not his skill)"}</button>`).join("")}
      <button type="button" class="chip" data-give="contractor">Outside contractor</button></div>
    <p class="muted" style="font-size:13px;margin:4px">★ = usual person for this building and job.</p>
    ${job.assignee && TEAM_IDS().includes(job.assignee) ? `<label class="f">Book a set time</label>
    <div class="row"><select id="bkDay" class="t">${Array.from({ length: 14 }, (_, i) => `<option value="${ymd(dateAt(i))}" ${job.slot && job.slot.date === ymd(dateAt(i)) ? "selected" : ""}>${dayLabel(i, true)}</option>`).join("")}</select>
      <select id="bkTime" class="t">${Array.from({ length: (state.config.work.end - state.config.work.start) * 4 }, (_, i) => state.config.work.start * 60 + i * 15).map((m) => `<option value="${m}" ${job.slot && job.slot.start === m ? "selected" : ""}>${hhmm(m)}</option>`).join("")}</select>
      <button class="btn small" id="bkSave">Book</button></div>
    ${job.slot ? `<button class="btn light small" id="bkClear" style="margin-top:6px">📌 Booked ${esc(job.slot.date)} ${hhmm(job.slot.start)} — back to automatic</button>` : ""}` : ""}` : ""}
    <button class="btn light block" data-close style="margin-top:10px">Close</button>`, (s) => {
    s.querySelectorAll(".job [data-act]").forEach((b) => (b.onclick = () => onAction(job, b.dataset.act)));
    s.querySelectorAll("img[data-full]").forEach((img) => (img.onclick = () => window.open(img.dataset.full, "_blank")));
    if (s.querySelector("#bkSave")) s.querySelector("#bkSave").onclick = async () => {
      try { await doUpdate(job, { action: "schedule", assignee: job.assignee, date: s.querySelector("#bkDay").value, start: +s.querySelector("#bkTime").value }); toast("Time booked"); } catch (e) { toast(e.message); }
    };
    if (s.querySelector("#bkClear")) s.querySelector("#bkClear").onclick = async () => {
      try { await doUpdate(job, { action: "unschedule" }); toast("Back to automatic time"); } catch (e) { toast(e.message); }
    };
    s.querySelectorAll("[data-give]").forEach((b) => (b.onclick = async () => {
      if (b.dataset.give === job.assignee) return;
      try { await doUpdate(job, { action: "assign", assignee: b.dataset.give }); toast(`${job.building} ${job.room} given to ${teamName(b.dataset.give)}`); } catch (e) { toast(e.message); }
    }));
  });
}

// ---------- choose your own PIN
function setPinView(first) {
  return `<form id="pinForm" class="login">
    <h2>${first ? "Choose your own PIN" : "Change my PIN"}</h2>
    <p class="muted">${first ? `Welcome, ${esc(state.user.name)}. Please choose your own PIN so only you know it. You will use it from now on.` : "Choose a new PIN. Your old one will stop working."}</p>
    <label class="f" for="np1">New PIN (4 to 8 numbers)</label>
    <input id="np1" class="pin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" required>
    <label class="f" for="np2">Type it again</label>
    <input id="np2" class="pin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" required>
    <button id="pinSave" class="btn gold block">Save my PIN</button>
    ${first ? "" : `<button type="button" class="btn light block" data-close style="margin-top:8px">Cancel</button>`}
    <p id="pinErr" style="color:var(--red);min-height:1.4em"></p>
    <p class="muted" style="font-size:13px">Don't use 1234, 0000 or your birthday. If you forget it, a manager can reset it.</p>
  </form>`;
}
function wireSetPin(first, root = document) {
  const f = root.querySelector("#pinForm");
  root.querySelector("#np1").focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const a = root.querySelector("#np1").value.trim(), b = root.querySelector("#np2").value.trim(), errEl = root.querySelector("#pinErr");
    if (!/^\d{4,8}$/.test(a)) { errEl.textContent = "Use 4 to 8 numbers"; return; }
    if (a !== b) { errEl.textContent = "The two PINs are not the same"; return; }
    root.querySelector("#pinSave").disabled = true;
    try {
      await api("mypin", { method: "POST", body: { pin: a } });
      state.config.mustSetPin = false;
      toast("Your PIN is saved. Use it next time you log in.");
      if (!first) $("#sheet").classList.add("hidden");
      if (!state.tab) state.tab = defaultTab();
      render();
    } catch (er) { errEl.textContent = er.message; root.querySelector("#pinSave").disabled = false; }
  };
}
function pinSheet() {
  openSheet(setPinView(false), (s) => wireSetPin(false, s));
}

async function renderStaffLogins() {
  const box = $("#staffLogins");
  if (!box) return;
  try {
    const r = await api("pins");
    if (r.demo) { box.innerHTML = `<p class="muted">Available once the staff PIN list is in Netlify.</p>`; return; }
    const done = r.people.filter((x) => x.ownSet).length;
    box.innerHTML = `<p class="muted" style="margin:0 0 8px">${done} of ${r.people.length} have chosen their own PIN. Someone who forgot theirs: tap Reset, and they log in again with their starting PIN from the list.</p>
      ${r.people.map((x) => `<div class="dayoff"><span>${esc(x.name)} <small class="muted">· ${esc(x.role)}</small></span>
        ${x.ownSet ? `<span class="row"><span class="badge b-done">Own PIN set</span><button class="btn light small" data-reset="${esc(x.name)}">Reset</button></span>` : `<span class="badge b-time">Starting PIN</span>`}</div>`).join("")}`;
    box.querySelectorAll("[data-reset]").forEach((b) => (b.onclick = async () => {
      if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again to reset"; return; }
      try { await api("pins/reset", { method: "POST", body: { name: b.dataset.reset } }); toast(`${b.dataset.reset} can log in with their starting PIN again`); renderStaffLogins(); } catch (e) { toast(e.message); }
    }));
  } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

// refresh every minute while the app is open (not while typing a report or using a pop-up)
setInterval(async () => {
  if (!state.user || document.hidden || state.tab === "report" || !$("#sheet").classList.contains("hidden")) return;
  try { await loadJobs(); state.allJobs = null; state.recurring = null; render(); } catch {}
}, 60000);

start();
