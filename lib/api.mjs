// City Club Maintenance — API logic (shared by Netlify and the local test server).
import crypto from "node:crypto";
import { BUILDINGS, CATEGORIES, TEAM, WORK, suggestAssignee } from "./config.mjs";

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
const STATUSES = ["open", "in_progress", "waiting", "done"];
const DONE_VISIBLE_DAYS = 14;
const MAX_PHOTO_BYTES = 2.5 * 1024 * 1024;

function loadUsers(env) {
  if (!env.STAFF_PINS) return { list: DEMO_USERS, demo: true };
  try {
    const list = JSON.parse(env.STAFF_PINS);
    if (!Array.isArray(list)) throw new Error();
    return { list: list.filter((u) => u && u.pin && u.name && ROLES.includes(u.role)), demo: false };
  } catch {
    return { list: [], demo: false, error: "STAFF_PINS setting is not valid" };
  }
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

export async function handle(req, { jobs, photos, settings, env }) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;

  try {
    // ---- login (no token needed)
    if (parts[0] === "login" && method === "POST") {
      const { pin } = await req.json().catch(() => ({}));
      const users = loadUsers(env);
      if (users.error) return err(users.error, 500);
      const u = users.list.find((x) => String(x.pin) === String(pin || ""));
      if (!u) {
        await sleep(800); // slow down guessing
        return err("Wrong PIN", 401);
      }
      const user = { name: u.name, role: u.role, team: u.team || null };
      const token = sign({ ...user, exp: Date.now() + 30 * 24 * 3600 * 1000 }, env);
      return json({ token, user, demo: users.demo });
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
      return json({ buildings: BUILDINGS, categories: CATEGORIES, team: TEAM, work: WORK, settings: await loadSettings(settings), demo: loadUsers(env).demo, user });
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
          log("Assigned to " + tname(job.assignee));
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
      return json({ job });
    }

    return err("Not found", 404);
  } catch (e) {
    console.error(e);
    return err("Something went wrong on the server", 500);
  }
}
