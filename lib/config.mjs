// City Club Maintenance — business settings.
// Edit this file to add a building, a category or a team member.

export const BUILDINGS = [
  "Albert",
  "Wex",
  "City Club",
  "City Club Signature",
  "City Club Reserve",
  "Port View",
  "Hotel Bruxelles",
  "Plein",
  "Braemar",
  "Milner",
  "York",
  "Tall Tree",
  "Laundry",
];

// Working hours for the maintenance team (24h clock). Each person works 6 days;
// their day off is set by a manager in the app (Planner → Days off).
export const WORK = { start: 9, end: 17 };

// Dates for recurring jobs are worked out in this time zone.
export const TIME_ZONE = "Africa/Johannesburg";

// Approximate rooms per building, used only to set the first monthly baiting
// time (5 minutes a room). Managers can change each time in the app.
export const ROOMS = {
  "Albert": 65, "Wex": 50, "City Club": 30, "City Club Signature": 17, "City Club Reserve": 28,
  "Port View": 28, "Hotel Bruxelles": 21, "Plein": 10, "Braemar": 11, "Milner": 6, "York": 13, "Tall Tree": 50,
};

// buildings: where this person normally works (new jobs there go to them first)
// can: the kinds of job this person can be given when the planner suggests a move
export const TEAM = [
  { id: "paul", name: "Paul", skills: "Senior maintenance · general, minor plumbing & electrical", buildings: ["Albert", "Wex"],
    can: ["lock", "window", "toilet", "bed", "light", "appliance", "pest", "other"] },
  { id: "kabos", name: "Kabos", skills: "Driver · most jobs incl. electrical", buildings: ["Hotel Bruxelles", "Port View", "Braemar"],
    can: ["lock", "window", "toilet", "water", "geyser", "bed", "power", "light", "appliance", "pest", "other"] },
  { id: "dadou", name: "Dadou", skills: "Plumbing & general handyman", buildings: ["City Club", "Milner", "York", "Plein"],
    can: ["lock", "window", "toilet", "water", "geyser", "bed", "light", "appliance", "pest", "other"] },
  { id: "pathy", name: "Pathy", skills: "Painting, silicone sealing, skimming, general", buildings: [],
    can: ["paint", "lock", "window", "bed", "pest", "other"] },
  { id: "contractor", name: "Outside contractor", skills: "Outsourced job", buildings: [], external: true, can: [] },
];

// blocking: true means "this usually stops the room being sold" (pre-ticked on the form)
// minutes: rough time the job takes (a manager can change it on each job)
export const CATEGORIES = [
  { id: "lock", label: "Door, lock or key", blocking: true, minutes: 30 },
  { id: "window", label: "Window", blocking: true, minutes: 60 },
  { id: "toilet", label: "Toilet, shower or basin", blocking: true, minutes: 60 },
  { id: "water", label: "Leak, burst pipe or no hot water", blocking: true, minutes: 120 },
  { id: "bed", label: "Bed or furniture", blocking: true, minutes: 60 },
  { id: "power", label: "No power / electrical fault", blocking: true, minutes: 90 },
  { id: "light", label: "Light or plug point", blocking: false, minutes: 30 },
  { id: "appliance", label: "Appliance (TV, fridge, aircon, kettle)", blocking: false, minutes: 45 },
  { id: "paint", label: "Paint, silicone or walls", blocking: false, minutes: 240 },
  { id: "geyser", label: "Geyser / hot water service", blocking: false, minutes: 60 },
  { id: "pest", label: "Pest control (cockroach baiting)", blocking: false, minutes: 30 },
  { id: "other", label: "Something else", blocking: false, minutes: 60 },
];

// Who a new job goes to. The manager can always change it.
export function suggestAssignee(building, categoryId) {
  if (categoryId === "paint") return "pathy";
  if (categoryId === "power") return "kabos"; // bigger electrical work
  const local = TEAM.find((t) => t.buildings.includes(building));
  if ((categoryId === "water" || categoryId === "geyser") && local && local.id === "paul") return "dadou"; // Paul only does minor plumbing
  return local ? local.id : null; // null = manager assigns
}
