# Toronto Dispatch

A responsive, independent web dashboard for Toronto Police Service public Calls for Service (C4S) dispatch information.

## What it does

- Shows public police dispatch calls for the last 1, 3, 6, 12, 18, or 24 hours.
- Filters by Toronto Police division.
- Searches by call type, location, division, or public call ID.
- Calculates the busiest division and most common call description in the current view.
- Refreshes when the underlying public-feed mirror updates.
- Clearly distinguishes a **call for service** from a confirmed crime.
- Includes TPS source, licensing, privacy, and non-affiliation language.

## Data source

The live browser view uses GTA Update's browser-friendly JSON snapshots of the public TPS dispatch feed:

- `https://gtaupdate.com/cache/gta_police_1.json`
- `https://gtaupdate.com/cache/gta_police_3.json`
- `https://gtaupdate.com/cache/gta_police_6.json`
- `https://gtaupdate.com/cache/gta_police_12.json`
- `https://gtaupdate.com/cache/gta_police_18.json`
- `https://gtaupdate.com/cache/gta_police_24.json`
- change marker: `https://gtaupdate.com/cache/last_ingest.txt`

This is a convenience transport layer, not an official TPS endpoint. The underlying records are from the publicly published TPS Calls for Service feed. The site also links directly to TPS Open Data and the TPS Public Safety Data Portal.

## Run locally

Because browsers impose restrictions on `file://` pages, serve the folder through a tiny local web server.

### Python

```bash
cd tps-dispatch-dashboard
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

### Node

```bash
npx serve .
```

## Deploy

This is a static site. You can deploy the entire folder to:

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel static hosting
- Any nginx/Apache web server

No build step is required.

## If the live feed is blocked

The JSON mirror currently advertises cross-origin access, but if a host/network later blocks browser requests, use a same-origin proxy.

Example Cloudflare Worker:

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const hours = ["1","3","6","12","18","24"].includes(url.searchParams.get("hours"))
      ? url.searchParams.get("hours")
      : "24";

    const upstream = await fetch(`https://gtaupdate.com/cache/gta_police_${hours}.json`, {
      cf: { cacheTtl: 30 }
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=30"
      }
    });
  }
};
```

Then change `CONFIG.snapshotBase` in `app.js` to your proxy's base URL and adapt `fetchSnapshot()` as needed.

## Important data caveats

A public dispatch record:

- is **not** proof that a crime occurred;
- may be delayed, revised, reclassified, or cancelled;
- may use an approximate/public location description;
- may omit sensitive calls for privacy or operational reasons.

Do not combine this feed with other datasets to try to identify an individual, household, business, victim, caller, or suspect.

## Attribution

Contains information licensed under the Open Government Licence – Ontario.

Toronto Police Service is credited as the public-data source. This project is independent and is not affiliated with or endorsed by Toronto Police Service. Do not add TPS crests, badges, logos, flags, or other official marks in a way that suggests endorsement.
