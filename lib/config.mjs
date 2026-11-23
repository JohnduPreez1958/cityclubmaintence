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
];

// buildings: where this person normally works (jobs there go to them first)
export const TEAM = [
  { id: "paul", name: "Paul", skills: "General handyman · minor plumbing & electrical", buildings: ["Albert", "Wex"] },
  { id: "kabos", name: "Kabos", skills: "Most jobs incl. electrical · has a vehicle", buildings: ["Hotel Bruxelles", "Port View", "Braemar"] },
  { id: "dadou", name: "Dadou", skills: "Plumbing & general handyman", buildings: ["City Club", "Milner", "York", "Plein"] },
  { id: "pathy", name: "Pathy", skills: "Painting, silicone sealing, skimming", buildings: [] },
  { id: "contractor", name: "Outside contractor", skills: "Outsourced job", buildings: [], external: true },
];

// blocking: true means "this usually stops the room being sold" (pre-ticked on the form)
export const CATEGORIES = [
  { id: "lock", label: "Door, lock or key", blocking: true },
  { id: "window", label: "Window", blocking: true },
  { id: "toilet", label: "Toilet, shower or basin", blocking: true },
  { id: "water", label: "Leak, burst pipe or no hot water", blocking: true },
  { id: "bed", label: "Bed or furniture", blocking: true },
  { id: "power", label: "No power / electrical fault", blocking: true },
  { id: "light", label: "Light or plug point", blocking: false },
  { id: "appliance", label: "Appliance (TV, fridge, aircon, kettle)", blocking: false },
  { id: "paint", label: "Paint, silicone or walls", blocking: false },
  { id: "other", label: "Something else", blocking: false },
];

// Who a new job goes to. The manager can always change it.
export function suggestAssignee(building, categoryId) {
  if (categoryId === "paint") return "pathy";
  if (categoryId === "power") return "kabos"; // bigger electrical work
  const local = TEAM.find((t) => t.buildings.includes(building));
  if (categoryId === "water" && local && local.id === "paul") return "dadou"; // Paul only does minor plumbing
  return local ? local.id : null; // null = manager assigns
}
