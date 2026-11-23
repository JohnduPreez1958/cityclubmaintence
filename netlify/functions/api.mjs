// Netlify Function: connects the API to Netlify Blobs storage.
import { getStore } from "@netlify/blobs";
import { handle } from "../../lib/api.mjs";

function store(name) {
  const s = getStore({ name, consistency: "strong" });
  return {
    getJSON: (k) => s.get(k, { type: "json" }),
    setJSON: (k, v) => s.setJSON(k, v),
    listKeys: async () => (await s.list()).blobs.map((b) => b.key),
    setBinary: (k, buf, contentType) => s.set(k, buf, { metadata: { contentType } }),
    getBinary: async (k) => {
      const r = await s.getWithMetadata(k, { type: "arrayBuffer" });
      return r ? { data: r.data, contentType: r.metadata?.contentType } : null;
    },
  };
}

export default async (req) =>
  handle(req, { jobs: store("maintenance-jobs"), photos: store("maintenance-photos"), env: process.env });

export const config = { path: "/api/*" };
