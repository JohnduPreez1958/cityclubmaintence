// City Club Maintenance — API logic (shared by Netlify and the local test server).
import crypto from "node:crypto";
import { BUILDINGS, CATEGORIES, TEAM, WORK, TIME_ZONE, ROOMS, suggestAssignee } from "./config.mjs";

// Used ONLY until STAFF_PINS is set in Netlify. The app shows a warning while these are active.
const DEMO_USERS = [
  { pin: "1111", name: "Manager", role: "manager" },
  { pin: "2222", name: "Reception", role: "staff" },
  { pin: "3001", name: "Paul", role: "handyman", team: "paul" },
  { pin: "3002", name: "Kabos", role: "handyman", team: "kabos" },
  { pin: "3003", name: "Dadou", role: "handyman", team: "dadou" },
  { pin: "3004", name: "Pathy", role: "handyman", team: "pathy" },
];

const ROLES = ["staff", "handyman", "manager"];
const MAX_TRIES = 5; // wrong PINs in a row before a phone is locked out
const LOCK_MINUTES = 15;
const STATUSES = ["open", "in_progress", "waiting", "done"];
const DONE_VISIBLE_DAYS = 14;
const MAX_PHOTO_BYTES = 2.5 * 1024 * 1024;

// Staff PINs come from the STAFF_PINS setting in Netlify. Accepts the JSON list, and forgives
// what pasting often adds: code fences, curly quotes, stray text before "[" or after "]".
function parseStaffPins(raw) {
  let t = String(raw).replace(/[\u201C\u201D\u2033]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/\u00A0/g, " ").trim();
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a >= 0 && b > a) {
    const list = JSON.parse(t.slice(a, b + 1));
    if (Array.isArray(list)) return list;
  }
  // the staff PIN list as a spreadsheet (CSV) with a header row: Name,Role,PIN
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cells = (l) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map((c) => c.replace(/,$/, "").trim().replace(/^"|"$/g, "").replace(/""/g, '"')).filter((c, i, a) => i < a.length - 1 || c !== "");
  const head = lines.length ? cells(lines[0]).map((h) => h.toLowerCase()) : [];
  if (head.includes("name") && head.includes("pin")) {
    const iN = head.indexOf("name"), iP = head.indexOf("pin"), iR = head.indexOf("role"), iT = head.indexOf("team");
    const out = lines.slice(1).map(cells).filter((c) => c[iP] && c[iN]).map((c) => {
      const r = (c[iR] || "staff").toLowerCase();
      const role = r.startsWith("manager") ? "manager" : r.startsWith("handyman") ? "handyman" : "staff";
      const u = { pin: c[iP], name: c[iN], role };
      if (role === "handyman") u.team = (iT >= 0 && c[iT] ? c[iT] : c[iN]).toLowerCase();
      return u;
    });
    if (out.length) return out;
  }
  // the same list after a one-line box has squashed the line breaks (spaces or nothing between rows):
  // find every  Name,Role,PIN  group in the text
  const flat = t.replace(/^\s*name\s*,\s*role\s*,\s*pin\s*/i, "");
  const re = /([A-Za-z][A-Za-z' .-]*?)\s*,\s*("[^"]*"|[A-Za-z][^,"]*?)\s*,\s*(\d{4,8})(?!\d)/g;
  const found = [];
  for (let m; (m = re.exec(flat)); ) {
    const name = m[1].trim(), r = m[2].replace(/"/g, "").trim().toLowerCase();
    const role = r.startsWith("manager") ? "manager" : r.startsWith("handyman") ? "handyman" : "staff";
    found.push({ pin: m[3], name, role, ...(role === "handyman" ? { team: name.toLowerCase() } : {}) });
  }
  if (found.length) return found;
  // also allow one person per line: PIN, Name, role[, team]   e.g.  8793, John, manager
  const rows = t.split(/[\n;]+/).map((l) => l.split(/[,:|\t]/).map((x) => x.trim())).filter((r) => r.length >= 3 && /^\d{4,8}$/.test(r[0]));
  if (rows.length) return rows.map(([pin, name, role, team]) => ({ pin, name, role: role.toLowerCase(), ...(team ? { team: team.toLowerCase() } : {}) }));
  throw new Error("bad");
}

function loadUsers(env) {
  if (!env.STAFF_PINS) return { list: DEMO_USERS, demo: true };
  try {
    const list = parseStaffPins(env.STAFF_PINS);
    const ok = list.filter((u) => u && u.pin && u.name && ROLES.includes(u.role)).map((u) => ({ ...u, pin: String(u.pin).trim() }));
    if (!ok.length) throw new Error("empty");
    return { list: ok, demo: false };
  } catch {
    return { list: [], demo: false, error: "STAFF_PINS setting is not valid — in Netlify, check it starts with [ and ends with ]" };
  }
}

// ---------- each person's own PIN (set by them after logging in with the starting PIN from the list)
const pinHash = (pin) => crypto.createHash("sha256").update("ccm-pin:" + String(pin)).digest("hex");
const personKey = (name) => String(name).trim().toLowerCase();
async function loadOwnPins(settings) { return (await settings.getJSON("ownpins")) || {}; }
function weakPin(p) {
  return /^(\d)\1+$/.test(p) || "0123456789".includes(p) || "9876543210".includes(p);
}

function secret(env) {
  return env.SESSION_SECRET || crypto.createHash("sha256").update("ccm:" + (env.STAFF_PINS || "demo")).digest("hex");
}

const b64u = (s) => Buffer.from(s).toString("base64url");
function sign(payload, env) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", secret(env)).update(body).digest("base64url");
  return body + "." + mac;
}
function verify(token, env) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", secret(env)).update(body).digest("base64url");
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const err = (msg, status = 400) => json({ error: msg }, status);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newId = () => Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
const clean = (s, max) => String(s ?? "").trim().slice(0, max);
const teamIds = TEAM.map((t) => t.id);

function canWork(user, job) {
  return user.role === "manager" || (user.role === "handyman" && user.team && user.team === job.assignee);
}

async function loadSettings(settings) {
  return (await settings.getJSON("settings")) || { daysOff: {} };
}


// ---------- recurring jobs (geyser services, monthly baiting, …)
const UNITS = ["weeks", "months"];
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
function localDate(ts = Date.now()) {
  // YYYY-MM-DD in the business's time zone
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}
function addInterval(dateStr, every, unit) {
  const [y, m, d] = dateStr.split("-").map(Number);
  let r;
  if (unit === "weeks") r = new Date(Date.UTC(y, m - 1, d + 7 * every));
  else {
    const last = new Date(Date.UTC(y, m - 1 + every + 1, 0)).getUTCDate(); // days in target month
    r = new Date(Date.UTC(y, m - 1 + every, Math.min(d, last)));
  }
  return r.toISOString().slice(0, 10);
}

// First list: monthly cockroach baiting in every building, spread over three weeks
// so they don't all fall on the same day. Geysers are added by a manager.
async function seedRecurring(recurring, settings) {
  const s = await loadSettings(settings);
  if (s.recurringSeeded) return;
  const [y, m] = localDate().split("-").map(Number);
  const first = new Date(Date.UTC(y, m, 1)); // 1st of next month
  let i = 0;
  for (const b of BUILDINGS) {
    const due = new Date(first.getTime() + i * 2 * 864e5).toISOString().slice(0, 10);
    const id = "rbait" + b.toLowerCase().replace(/[^a-z0-9]/g, ""); // fixed id: seeding twice can't duplicate
    await recurring.setJSON(id, {
      id, title: "Cockroach baiting", building: b, location: "All rooms", category: "pest",
      every: 1, unit: "months", minutes: Math.max(30, Math.round(((ROOMS[b] || 10) * 5) / 15) * 15),
      nextDue: due, assignee: "", active: true, createdAt: Date.now(),
    });
    i++;
  }
  s.recurringSeeded = true;
  await settings.setJSON("settings", s);
}

async function loadRecurring(recurring) {
  const keys = await recurring.listKeys();
  return (await Promise.all(keys.map((k) => recurring.getJSON(k)))).filter(Boolean);
}

// Turns every recurring item that is due into a normal job (once).
async function createDueJobs({ jobs, recurring }) {
  const today = localDate();
  for (const it of await loadRecurring(recurring)) {
    if (!it.active || !isDate(it.nextDue) || it.nextDue > today) continue;
    if (it.openJobId) {
      const open = await jobs.getJSON(it.openJobId);
      if (open && open.status !== "done") continue;
    }
    const jobId = "j" + it.id + it.nextDue.replace(/-/g, "");
    let job = await jobs.getJSON(jobId);
    if (!job) {
      const assignee = it.assignee && teamIds.includes(it.assignee) ? it.assignee : suggestAssignee(it.building, it.category);
      const now = Date.now();
      job = {
        id: jobId, createdAt: now, createdBy: "Planned job", building: it.building, room: it.location || "—",
        category: it.category, description: it.title + (it.notes ? " — " + it.notes : ""), blocking: false, photo: null,
        minutes: it.minutes, assignee, status: "open", recurringId: it.id, dueDate: it.nextDue,
        history: [{ at: now, by: "Planned job", text: `Due ${it.nextDue}` + (assignee ? ` · sent to ${TEAM.find((t) => t.id === assignee).name}` : " · waiting for manager to assign") }],
      };
      await jobs.setJSON(jobId, job);
    }
    if (job.status !== "done") {
      it.openJobId = jobId;
      await recurring.setJSON(it.id, it);
    }
  }
}

function readRecurring(b, old) {
  const it = { ...(old || {}) };
  it.title = clean(b.title, 80);
  it.building = clean(b.building, 60);
  it.location = clean(b.location, 40);
  it.category = clean(b.category, 30);
  it.notes = clean(b.notes, 300);
  it.every = Math.round(+b.every);
  it.unit = UNITS.includes(b.unit) ? b.unit : "months";
  it.minutes = Math.round(+b.minutes);
  it.nextDue = clean(b.nextDue, 10);
  it.assignee = teamIds.includes(b.assignee) ? b.assignee : "";
  it.active = b.active !== false;
  if (!it.title) return "Say what the job is";
  if (!BUILDINGS.includes(it.building)) return "Choose a building";
  if (!CATEGORIES.some((c) => c.id === it.category)) return "Choose the kind of job";
  if (!(it.every >= 1 && it.every <= 120)) return "How often must be between 1 and 120";
  if (!(it.minutes >= 10 && it.minutes <= 60 * 40)) return "Time must be between 10 minutes and 40 hours";
  if (!isDate(it.nextDue)) return "Choose the next due date";
  return it;
}

export async function handle(req, { jobs, photos, settings, recurring, env }) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;

  try {
    // ---- login (no token needed)
    if (parts[0] === "login" && method === "POST") {
      const { pin } = await req.json().catch(() => ({}));
      const users = loadUsers(env);
      if (users.error) return err(users.error, 500);
      // lock a phone out after too many wrong PINs, so PINs can't be guessed
      const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
      const failKey = "fail" + crypto.createHash("sha256").update(ip).digest("hex").slice(0, 24);
      const now = Date.now();
      let fails = (await settings.getJSON(failKey)) || { count: 0, last: 0, until: 0 };
      if (fails.until > now) {
        const mins = Math.ceil((fails.until - now) / 60000);
        return err(`Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, 429);
      }
      if (now - fails.last > LOCK_MINUTES * 60000) fails = { count: 0, last: 0, until: 0 };
      const own = users.demo ? {} : await loadOwnPins(settings);
      const h = pinHash(String(pin || ""));
      // someone's own PIN first; a starting PIN only works until that person has set their own
      let u = users.list.find((x) => own[personKey(x.name)]?.hash === h);
      let starting = false;
      if (!u) { u = users.list.find((x) => !own[personKey(x.name)] && String(x.pin) === String(pin || "")); starting = !!u; }
      if (!u) {
        fails.count++;
        fails.last = now;
        if (fails.count >= MAX_TRIES) fails.until = now + LOCK_MINUTES * 60000;
        await settings.setJSON(failKey, fails);
        await sleep(800); // slow down guessing
        const left = MAX_TRIES - fails.count;
        return err(left > 0 ? `Wrong PIN — ${left} tr${left === 1 ? "y" : "ies"} left` : `Wrong PIN. Locked for ${LOCK_MINUTES} minutes.`, 401);
      }
      if (fails.count) await settings.setJSON(failKey, { count: 0, last: 0, until: 0 });
      const user = { name: u.name, role: u.role, team: u.team || null };
      const token = sign({ ...user, exp: Date.now() + 30 * 24 * 3600 * 1000 }, env);
      return json({ token, user, demo: users.demo, mustSetPin: starting && !users.demo });
    }

    // ---- photos can be loaded by <img> tags, so the token may come in the URL
    if (parts[0] === "photos" && method === "GET" && parts[1]) {
      if (!verify(url.searchParams.get("t"), env)) return err("Not logged in", 401);
      const item = await photos.getBinary(parts[1]);
      if (!item) return err("Not found", 404);
      return new Response(item.data, {
        headers: { "content-type": item.contentType || "image/jpeg", "cache-control": "private, max-age=86400" },
      });
    }

    const auth = req.headers.get("authorization") || "";
    const user = verify(auth.replace(/^Bearer\s+/i, ""), env);
    if (!user) return err("Not logged in", 401);

    if (parts[0] === "config" && method === "GET") {
      const us = loadUsers(env);
      const own = us.demo ? {} : await loadOwnPins(settings);
      return json({ buildings: BUILDINGS, categories: CATEGORIES, team: TEAM, work: WORK, settings: await loadSettings(settings), demo: us.demo, user,
        mustSetPin: !us.demo && !own[personKey(user.name)] });
    }


    // ---- set your own PIN
    if (parts[0] === "mypin" && method === "POST") {
      const us = loadUsers(env);
      if (us.demo) return err("Own PINs can be set once the staff PIN list is in Netlify");
      const me = us.list.find((x) => personKey(x.name) === personKey(user.name));
      if (!me) return err("You are not on the staff list any more", 403);
      const b = await req.json().catch(() => ({}));
      const pin = String(b.pin || "").trim();
      if (!/^\d{4,8}$/.test(pin)) return err("Your PIN must be 4 to 8 numbers");
      if (weakPin(pin)) return err("That PIN is too easy to guess — choose another");
      const own = await loadOwnPins(settings);
      const h = pinHash(pin);
      const clash = us.list.some((x) => String(x.pin) === pin) ||
        Object.entries(own).some(([k, v]) => k !== personKey(me.name) && v.hash === h);
      if (clash) return err("That PIN can't be used — choose another");
      own[personKey(me.name)] = { hash: h, at: Date.now() };
      await settings.setJSON("ownpins", own);
      return json({ ok: true });
    }

    // ---- managers: who has set their own PIN, and reset someone who forgot theirs
    if (parts[0] === "pins") {
      if (user.role !== "manager") return err("Only a manager can see this", 403);
      const us = loadUsers(env);
      const own = us.demo ? {} : await loadOwnPins(settings);
      if (method === "GET") {
        return json({ demo: us.demo, people: us.list.map((x) => ({ name: x.name, role: x.role, ownSet: !!own[personKey(x.name)], at: own[personKey(x.name)]?.at || null })) });
      }
      if (method === "POST" && parts[1] === "reset") {
        const b = await req.json().catch(() => ({}));
        const k = personKey(b.name || "");
        if (!own[k]) return err("That person is already on their starting PIN");
        delete own[k];
        await settings.setJSON("ownpins", own);
        return json({ ok: true });
      }
      return err("Not found", 404);
    }

    if (parts[0] === "settings" && method === "POST") {
      if (user.role !== "manager") return err("Only a manager can change this", 403);
      const b = await req.json().catch(() => ({}));
      const s = await loadSettings(settings);
      if (b.daysOff && typeof b.daysOff === "object") {
        for (const [id, d] of Object.entries(b.daysOff)) {
          if (!teamIds.includes(id)) continue;
          if (d === null || d === "") delete s.daysOff[id];
          else if (Number.isInteger(+d) && +d >= 0 && +d <= 6) s.daysOff[id] = +d;
        }
      }
      await settings.setJSON("settings", s);
      return json({ settings: s });
    }


    // ---- recurring jobs (managers)
    if (parts[0] === "recurring") {
      if (user.role !== "manager") return err("Only a manager can change planned jobs", 403);
      await seedRecurring(recurring, settings);
      if (method === "GET" && !parts[1]) {
        await createDueJobs({ jobs, recurring });
        return json({ items: await loadRecurring(recurring), today: localDate() });
      }
      if (method === "POST" && !parts[1]) {
        const b = await req.json().catch(() => ({}));
        const old = b.id ? await recurring.getJSON(String(b.id)) : null;
        if (b.id && !old) return err("Not found", 404);
        const it = readRecurring(b, old);
        if (typeof it === "string") return err(it);
        if (!it.id) { it.id = "r" + newId(); it.createdAt = Date.now(); }
        await recurring.setJSON(it.id, it);
        await createDueJobs({ jobs, recurring });
        return json({ item: await recurring.getJSON(it.id) });
      }
      if (method === "POST" && parts[1] && parts[2] === "delete") {
        const it = await recurring.getJSON(parts[1]);
        if (!it) return err("Not found", 404);
        await recurring.delete(parts[1]);
        return json({ ok: true });
      }
      if (method === "POST" && parts[1] && parts[2] === "now") {
        const it = await recurring.getJSON(parts[1]);
        if (!it) return err("Not found", 404);
        it.nextDue = localDate();
        it.active = true;
        await recurring.setJSON(it.id, it);
        await createDueJobs({ jobs, recurring });
        return json({ item: await recurring.getJSON(it.id) });
      }
      return err("Not found", 404);
    }

    if (parts[0] === "photos" && method === "POST") {
      const { dataUrl } = await req.json().catch(() => ({}));
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || "");
      if (!m) return err("Photo not readable");
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > MAX_PHOTO_BYTES) return err("Photo too large");
      const key = "p" + newId();
      await photos.setBinary(key, buf, m[1]);
      return json({ key });
    }

    if (parts[0] === "jobs" && method === "GET" && !parts[1]) {
      await seedRecurring(recurring, settings);
      await createDueJobs({ jobs, recurring });
      const keys = await jobs.listKeys();
      const all = (await Promise.all(keys.map((k) => jobs.getJSON(k)))).filter(Boolean);
      const cutoff = Date.now() - DONE_VISIBLE_DAYS * 24 * 3600 * 1000;
      const list = url.searchParams.get("all") ? all : all.filter((j) => j.status !== "done" || j.doneAt > cutoff);
      list.sort((a, b) => b.createdAt - a.createdAt);
      return json({ jobs: list });
    }

    if (parts[0] === "jobs" && method === "POST" && !parts[1]) {
      const b = await req.json().catch(() => ({}));
      const building = clean(b.building, 60);
      const category = clean(b.category, 30);
      const room = clean(b.room, 30);
      const description = clean(b.description, 1000);
      if (!BUILDINGS.includes(building)) return err("Choose a building");
      if (!CATEGORIES.some((c) => c.id === category)) return err("Choose what is broken");
      if (!room) return err("Enter the room number or area");
      const photo = typeof b.photo === "string" && /^p[a-z0-9]+$/.test(b.photo) ? b.photo : null;
      let assignee = suggestAssignee(building, category);
      if (user.role === "manager" && b.assignee !== undefined) {
        assignee = teamIds.includes(b.assignee) ? b.assignee : null;
      }
      const now = Date.now();
      const job = {
        id: newId(),
        createdAt: now,
        createdBy: user.name,
        building,
        room,
        category,
        description,
        blocking: !!b.blocking,
        photo,
        minutes: CATEGORIES.find((c) => c.id === category).minutes,
        assignee,
        status: "open",
        history: [{ at: now, by: user.name, text: "Reported" + (assignee ? ` · sent to ${TEAM.find((t) => t.id === assignee).name}` : " · waiting for manager to assign") }],
      };
      await jobs.setJSON(job.id, job);
      return json({ job });
    }

    if (parts[0] === "jobs" && parts[1] && parts[2] === "update" && method === "POST") {
      const job = await jobs.getJSON(parts[1]);
      if (!job) return err("Job not found", 404);
      const b = await req.json().catch(() => ({}));
      const note = clean(b.note, 500);
      const now = Date.now();
      const log = (text) => job.history.push({ at: now, by: user.name, text });
      const tname = (id) => (TEAM.find((t) => t.id === id) || {}).name || "nobody";

      switch (b.action) {
        case "take":
          if (user.role !== "handyman" || !user.team) return err("Not allowed", 403);
          if (job.assignee && job.assignee !== user.team) return err("Already assigned to " + tname(job.assignee));
          job.assignee = user.team;
          log("Took the job");
          break;
        case "assign":
          if (user.role !== "manager") return err("Only a manager can assign", 403);
          job.assignee = teamIds.includes(b.assignee) ? b.assignee : null;
          delete job.slot; // a new person fits it into their own day
          log("Assigned to " + tname(job.assignee));
          break;
        case "schedule": {
          // a manager books the job for a person at a set day and time (dragged on the calendar)
          if (user.role !== "manager") return err("Only a manager can book times", 403);
          if (!teamIds.includes(b.assignee)) return err("Choose who does it");
          const st = Math.round(+b.start);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ""))) return err("Choose a day");
          if (!(st >= WORK.start * 60 && st < WORK.end * 60)) return err("Choose a time in working hours");
          const changedPerson = job.assignee !== b.assignee;
          job.assignee = b.assignee;
          job.slot = { date: b.date, start: st };
          const hm = `${String(Math.floor(st / 60)).padStart(2, "0")}:${String(st % 60).padStart(2, "0")}`;
          log(`Booked for ${tname(job.assignee)} on ${b.date} at ${hm}` + (changedPerson ? "" : ""));
          break;
        }
        case "unschedule":
          if (user.role !== "manager") return err("Not allowed", 403);
          delete job.slot;
          log("Back to automatic time");
          break;
        case "start":
          if (!canWork(user, job)) return err("Not allowed", 403);
          job.status = "in_progress";
          job.startedAt = now;
          log("Started work");
          break;
        case "wait":
          if (!canWork(user, job)) return err("Not allowed", 403);
          if (!note) return err("Say what you are waiting for");
          job.status = "waiting";
          log("Waiting: " + note);
          break;
        case "done": {
          if (!canWork(user, job)) return err("Not allowed", 403);
          const afterPhoto = typeof b.afterPhoto === "string" && /^p[a-z0-9]+$/.test(b.afterPhoto) ? b.afterPhoto : null;
          // maintenance staff must show the fix; managers may close without one (e.g. outside contractor jobs)
          if (!afterPhoto && user.role !== "manager") return err("Take a photo of the fix before marking it fixed");
          job.status = "done";
          job.doneAt = now;
          job.doneBy = user.name;
          job.doneNote = note;
          if (afterPhoto) job.afterPhoto = afterPhoto;
          log("Fixed" + (note ? ": " + note : ""));
          break;
        }
        case "reopen":
          if (user.role !== "manager") return err("Only a manager can reopen", 403);
          job.status = "open";
          delete job.doneAt;
          log("Reopened" + (note ? ": " + note : ""));
          break;
        case "blocking":
          if (user.role !== "manager") return err("Not allowed", 403);
          job.blocking = !!b.blocking;
          log(job.blocking ? "Marked room out of order" : "Marked room sellable");
          break;
        case "estimate": {
          if (user.role !== "manager") return err("Only a manager can change the time", 403);
          const m = Math.round(+b.minutes);
          if (!(m >= 10 && m <= 60 * 40)) return err("Time must be between 10 minutes and 40 hours");
          job.minutes = m;
          log(`Time set to ${m >= 60 ? +(m / 60).toFixed(1) + " h" : m + " min"}`);
          break;
        }
        case "note":
          if (!note) return err("Write a note");
          log(note);
          break;
        default:
          return err("Unknown action");
      }
      if (!STATUSES.includes(job.status)) job.status = "open";
      await jobs.setJSON(job.id, job);
      // a planned job that is fixed sets the next due date, counted from the day it was done
      if (b.action === "done" && job.recurringId) {
        const it = await recurring.getJSON(job.recurringId);
        if (it) {
          it.lastDone = localDate(job.doneAt);
          it.nextDue = addInterval(it.lastDone, it.every, it.unit);
          it.openJobId = null;
          await recurring.setJSON(it.id, it);
        }
      }
      return json({ job });
    }

    return err("Not found", 404);
  } catch (e) {
    console.error(e);
    return err("Something went wrong on the server", 500);
  }
}
