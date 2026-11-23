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
  if (cat === "water" && local && local.id === "paul") return "dadou";
  return local ? local.id : null;
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
  return state.user.role === "manager" ? "all" : state.user.role === "handyman" ? "mine" : "report";
}
async function loadJobs() {
  const { jobs } = await api("jobs");
  state.jobs = jobs;
}

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

  $("#who").innerHTML = `${esc(state.user.name)}<button id="logout">Log out</button>`;
  $("#logout").onclick = logout;
  $("#banner").innerHTML = state.config.demo
    ? `<div class="warn"><b>Test mode:</b> demo PINs are switched on. Set your own staff PINs in Netlify before real use.</div>`
    : "";

  const tabs = [];
  if (state.user.role === "manager") tabs.push(["all", "All jobs", state.jobs.filter((j) => isActive(j) && !j.assignee).length]);
  if (state.user.role === "handyman") tabs.push(["mine", "My jobs", state.jobs.filter((j) => isActive(j) && j.assignee === state.user.team).length]);
  tabs.push(["report", "Report a problem"]);
  if (state.user.role === "staff") tabs.push(["status", "Job status"]);
  $("#tabs").innerHTML = tabs
    .map(([id, label, n]) => `<button data-tab="${id}" class="${state.tab === id ? "on" : ""}">${label}${n ? `<span class="count">${n}</span>` : ""}</button>`)
    .join("");
  document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; render(); }));

  if (state.tab === "report") return renderReport();
  if (state.tab === "mine") return renderMine();
  if (state.tab === "status") return renderStatus();
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
      <span class="badge b-${j.status}">${STATUS_LABEL[j.status]}</span>
      ${j.assignee ? `<span class="badge b-who">${esc(teamName(j.assignee) || j.assignee)}</span>` : `<span class="badge b-none">Not assigned</span>`}
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
      return openSheet(`<h2>Mark as fixed</h2><p class="muted">${esc(job.building)} · ${esc(job.room)} — ${esc(catLabel(job.category))}</p>
        <label class="f" for="doneNote">What did you do? (optional)</label>
        <textarea id="doneNote" class="t" placeholder="e.g. replaced the tap washer"></textarea>
        <label class="f">Photo of the fix (optional)</label>
        <div class="photo-pick"><span id="afterPrev"></span>
          <label class="btn light small" for="afterPhoto">Take or add photo</label>
          <input id="afterPhoto" type="file" accept="image/*" capture="environment" class="hidden"><span id="afterMsg" class="muted"></span></div>
        ${job.blocking ? `<p class="goes-to">Once saved, this room is no longer marked out of order.</p>` : ""}<p></p>
        <div class="row"><button class="btn light" data-close>Cancel</button><button class="btn green" id="doneSave">Save — it's fixed</button></div>`, () => {
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
          $("#doneSave").disabled = false;
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
            if (a !== (job.assignee || null)) await doUpdate(job, { action: "assign", assignee: a || "" });
            const fresh = state.jobs.find((j) => j.id === job.id);
            if (blk !== fresh.blocking) await doUpdate(fresh, { action: "blocking", blocking: blk });
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

function renderMine() {
  const me = state.user.team;
  const myBuildings = (state.config.team.find((t) => t.id === me) || { buildings: [] }).buildings;
  const mine = state.jobs.filter((j) => isActive(j) && j.assignee === me).sort(byPriority);
  const unassigned = state.jobs.filter((j) => isActive(j) && !j.assignee).sort((a, b) => (myBuildings.includes(b.building) - myBuildings.includes(a.building)) || byPriority(a, b));
  const doneRecent = state.jobs.filter((j) => j.status === "done" && j.assignee === me).sort((a, b) => b.doneAt - a.doneAt).slice(0, 5);
  $("#app").innerHTML = `
    <h2>My jobs</h2>
    ${list(mine, "No jobs for you right now. 👍")}
    ${unassigned.length ? `<h3>Not assigned yet</h3>${list(unassigned, "")}` : ""}
    ${doneRecent.length ? `<h3>Recently fixed</h3>${list(doneRecent, "")}` : ""}`;
  wireCards();
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

// refresh every minute while the app is open (not while typing a report or using a pop-up)
setInterval(async () => {
  if (!state.user || document.hidden || state.tab === "report" || !$("#sheet").classList.contains("hidden")) return;
  try { await loadJobs(); render(); } catch {}
}, 60000);

start();
