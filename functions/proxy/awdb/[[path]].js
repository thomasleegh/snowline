// Cloudflare Pages Function: /proxy/awdb/* -> NRCS SNOTEL API (server-side, so no CORS in the browser).
// Same job as the Netlify `_redirects` rule. Netlify ignores this folder.
const UPSTREAM = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/";

export async function onRequest({ request, params }) {
  if (request.method !== "GET") return new Response("GET only", { status: 405 });
  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  if (!/^(stations|data)$/.test(path)) return new Response("Not found", { status: 404 });
  const target = UPSTREAM + path + new URL(request.url).search;
  let r;
  try {
    r = await fetch(target, { headers: { Accept: "application/json", "User-Agent": "Snowline personal ski planner" },
                              cf: { cacheTtl: 900, cacheEverything: true } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "upstream unreachable" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
  return new Response(r.body, { status: r.status, headers: {
    "Content-Type": r.headers.get("Content-Type") || "application/json",
    "Cache-Control": "public, max-age=900" } });
}
