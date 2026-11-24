# City Club Maintenance

Report maintenance problems, send them to the right handyman, and track which rooms are out of order. This replaces the WhatsApp group.

## Who sees what

| Login | Can do |
|---|---|
| **Staff** (reception, housekeeping) | Report a problem, see the status of all jobs |
| **Handyman** (Paul, Kabos, Dadou, Pathy) | Report, see *My jobs*, take unassigned jobs, start / mark waiting / mark fixed (**a photo of the fix is required**) |
| **Manager** | Everything: dashboard, assign or reassign, mark a room out of order or sellable, reopen jobs |

Jobs where the room **can't be sold** are shown in red and always listed first.

## Putting the app on a phone

The app can sit on the phone's home screen with its own "CC" icon and opens full-screen like a normal app.

- **iPhone (Safari):** open the app's address, tap the **Share** button (square with an arrow), then **Add to Home Screen → Add**.
- **Android (Chrome):** open the app's address, tap **⋮** (top right), then **Add to Home screen** or **Install app**.

## Getting around

A menu bar along the bottom, like a phone app, with a big gold **+** in the middle to report a problem from anywhere.

- Managers: Calendar · Jobs · **+** · Planner · Planned · Reports
- Handymen: My jobs · **+**
- Other staff: Job status · **+**

## Calendar (managers)

The first tab for managers. One column per handyman, the working day down the side, and each job as a coloured block sized by its set time: red = room out of order, blue = busy, grey = to do, purple = planned job, green = fixed. A red line shows the time now.

- Arrows move between days (up to a week back and two weeks ahead).
- Jobs nobody has yet are listed at the top. Tap one, or any block, to see the job and give it to someone (★ marks the usual person).
- Times are worked out from each job's set time, most urgent first.

## What a handyman sees

- A progress bar: how many of today's jobs are done.
- Each job shows roughly what time he should get to it (worked out from the set times), like an appointment list.
- **Next job** at the top, with one big button that changes as he goes: **▶ Start**, then **✓ Fixed — take photo** (the camera opens straight away). *Waiting for…*, *Add note* and *Mark fixed* are under **More**.
- The rest of today: out-of-order rooms first, then grouped by building, so he finishes one building before moving to the next. Later days follow.
- Jobs nobody has yet (**Take this job**) and what he fixed today.

## Planning the days

- Each type of job has a rough time (for example a toilet 1 h, painting 4 h). Managers can change the time on any job under **Manage**.
- The maintenance team work 9:00–17:00, six days a week. Managers set each person's day off in **Planner → Days off**.
- Each person's jobs are filled into their working days, with out-of-order rooms first. Handymen see them under **Today**, **Tomorrow** and later days.
- The **Planner** tab (managers only) shows:
  - a week grid of hours booked per person per day
  - **suggested moves**: unassigned jobs, or jobs that would wait for one person while someone else who can do that kind of job has free time today or tomorrow. Tap **Move** or **Not now**.
  - **warnings**: someone not fully allocated today, or booked two or more days ahead.

## Planned jobs (managers)

Jobs that come round again: geyser services, central hot water systems, monthly cockroach baiting.

- **Planned jobs** tab: add, edit, pause or delete them. Each has a building, where it is (a room, "Roof", "All rooms"), how often (weeks or months), the next due date, a set time and who does it (automatic, or a chosen person).
- On the due date it becomes a normal job on that person's list (marked *Planned*), and the planner fits it into their days.
- When it is marked fixed, the next due date is set from the day it was done.
- Geysers are not one per room and some buildings have a central system, so add each geyser, or the building's central system, as its own planned job. Buildings with no geysers need nothing.
- The first time it runs, the app adds monthly cockroach baiting for every building (5 minutes a room), spread from the 1st of next month so they don't all fall on one day. Change the dates and times to suit.

## Daily report (managers)

The **Daily report** tab shows all maintenance staff on one page, for any date:

- **Performance against budget** for the day, week to date and month to date. Budget = working hours (none on a day off, and only hours already worked for today). Done = the set time of each job they marked fixed. The over/under column is Done minus Budget, with a total row.
- **Jobs fixed** that day by each person.
- **Next 7 days**: each person's planned jobs per day.

- **Job detail per person** (for performance meetings): for the day, week or month to date, each person's budget − done = over/under, a day-by-day breakdown, every job fixed (when, room, problem, when reported, how long it waited, set time, time taken from Start to Fixed, his note, photo) and every job still open.

**Print / save PDF** gives an A4 landscape copy: performance on page 1, the 7-day plan next, then each person's job detail on their own page(s).

Who can be given which kind of job is set in `lib/config.mjs` (`can:`); the working hours are set there too (`WORK`).

## Who a new job goes to

The manager can change the assignment at any time.

- Albert, Wex → **Paul**
- Hotel Bruxelles, Port View, Braemar → **Kabos**
- City Club, Milner, York, Plein → **Dadou**
- Paint, silicone or walls (any building) → **Pathy**
- No power / electrical fault (any building) → **Kabos**
- Leaks and burst pipes at Albert or Wex → **Dadou** (Paul only does minor plumbing)
- City Club Signature, City Club Reserve, Tall Tree → **not assigned**: the manager picks someone

To change these rules, or add a building or a person, edit `lib/config.mjs`.

## Putting it online (Netlify)

1. Log in to Netlify and choose **Add new site → Import an existing project → GitHub**.
2. Pick **cityclubmaintence**. Leave the build settings as Netlify fills them in, then click **Deploy**.
3. The app is now live at an address like `something.netlify.app`. Storage (Netlify Blobs) switches on by itself.

### Staff PINs (do this before real use)

Until you do this, the app runs in **test mode** with these demo PINs: Manager 1111, Reception 2222, Paul 3001, Kabos 3002, Dadou 3003, Pathy 3004. This repository is public, so anyone could read those PINs.

In Netlify go to **Site configuration → Environment variables → Add a variable**:

- Key: `STAFF_PINS`
- Value (use your own 6-digit PINs):

```json
[
  {"pin":"482913","name":"John","role":"manager"},
  {"pin":"551820","name":"Reception","role":"staff"},
  {"pin":"730114","name":"Paul","role":"handyman","team":"paul"},
  {"pin":"691245","name":"Kabos","role":"handyman","team":"kabos"},
  {"pin":"318806","name":"Dadou","role":"handyman","team":"dadou"},
  {"pin":"264097","name":"Pathy","role":"handyman","team":"pathy"}
]
```

Then go to **Deploys → Trigger deploy**. The yellow test-mode banner disappears.

Use 4-digit PINs (or longer). After 5 wrong PINs in a row, that phone is locked out of logging in for 15 minutes, so PINs can't be guessed.

### The Maintenance tab on cityclubhotels.co.za

To add the tab, point it at this app's address. To use `maintenance.cityclubhotels.co.za` instead, add it under **Domain management** in Netlify.

## Running it on a computer (for testing)

```
npm install
npm run dev
```

Then open http://localhost:8888. Data is kept in the `.data` folder.

## Files

- `public/`: the screens staff see (`index.html`, `app.js`, `styles.css`)
- `lib/api.mjs`: logins, jobs and photos
- `lib/config.mjs`: buildings, team, categories and who gets which job
- `netlify/functions/api.mjs`: connects the app to Netlify storage
