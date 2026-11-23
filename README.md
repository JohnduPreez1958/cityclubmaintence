# City Club Maintenance

Report maintenance problems, send them to the right handyman, and track which rooms are out of order. This replaces the WhatsApp group.

## Who sees what

| Login | Can do |
|---|---|
| **Staff** (reception, housekeeping) | Report a problem, see the status of all jobs |
| **Handyman** (Paul, Kabos, Dadou, Pathy) | Report, see *My jobs*, take unassigned jobs, start / mark waiting / mark fixed (with a photo) |
| **Manager** | Everything: dashboard, assign or reassign, mark a room out of order or sellable, reopen jobs |

Jobs where the room **can't be sold** are shown in red and always listed first.

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
