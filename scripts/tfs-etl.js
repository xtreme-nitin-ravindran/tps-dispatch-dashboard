import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchTfsSource, parseTfsXml } from "../src/tfs/source.js";
import { buildTfsSnapshot } from "../src/pipeline/tfs-snapshot.js";

import { fetchTpsSource, mergePolice } from "../src/tps/source.js";
import { enrichLocations } from "../src/pipeline/location-enrichment.js";
import { createOpenLocationResolver } from "../src/pipeline/open-locations.js";

// Explicit history inputs must exist: a missing Concourse artifact must not erase history.
export async function runTfsEtl({
    outputPath = "data/current.json", previousPath, xmlPath,
    fetchSource = fetchTfsSource, fetchPolice = null, now = new Date(), updatedBy = "manual"
} = {}) {
    if (!["manual", "concourse", "github-actions"].includes(updatedBy)) throw new Error("Invalid updater identity");
    let previous = null;
    try {
        previous = JSON.parse(await readFile(previousPath || outputPath, "utf8"));
    } catch (error) {
        if (error.code !== "ENOENT" || previousPath) throw error;
    }
    const tfsPrevious = previous ? {...previous, incidents:previous.incidents.filter(row=>row.source!=="TPS")} : null;
    let snapshot;
    let tfsError = false;
    try {
        const source = xmlPath
            ? parseTfsXml(await readFile(xmlPath, "utf8"))
            : await fetchSource({ signal: AbortSignal.timeout(30_000) });
        snapshot = buildTfsSnapshot(source, now, tfsPrevious);
    } catch (error) {
        if (!fetchPolice) throw error;
        tfsError = true;
        snapshot = {...(tfsPrevious || {schemaVersion:1,source:"TFS",incidents:[]}),
            incidents:(tfsPrevious?.incidents || []).filter(row=>Date.parse(row.timestamp)>=now.getTime()-168*3600000)};
    }
    let police = [];
    let tpsError = false;
    if (fetchPolice) {
        try { police = await fetchPolice(); }
        catch { tpsError = true; }
        if (tfsError && tpsError) throw new Error("Both incident feeds failed; preserving published snapshot");
        snapshot.feeds = {
            TFS: {fetchedAt:tfsError ? previous?.feeds?.TFS?.fetchedAt || previous?.fetchedAt || null : now.toISOString(),
                sourceUpdatedAt:snapshot.sourceUpdatedAt || null, status:tfsError ? "unavailable" : "ok"},
            TPS: {fetchedAt:tpsError ? previous?.feeds?.TPS?.fetchedAt || null : now.toISOString(),
                status:tpsError ? "unavailable" : "ok"}
        };
        snapshot.fetchedAt = now.toISOString();
    }
    snapshot.updatedBy = updatedBy;
    const [index, boundaries] = await Promise.all([
        readFile(new URL("../data/geography/toronto-locations.json", import.meta.url), "utf8").then(JSON.parse),
        readFile(new URL("../data/police-divisions.geojson", import.meta.url), "utf8").then(JSON.parse)
    ]);
    await enrichLocations(snapshot, previous, {
        resolveLocation: createOpenLocationResolver(index, boundaries), now,
        maxLookups: Infinity, source: "toronto-centreline-geonames-2026-09-19"
    });
    if (fetchPolice) snapshot.incidents.push(...mergePolice(police, previous?.incidents || [], now));
    snapshot.incidents.sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp));
    await mkdir(dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(temporaryPath, outputPath);
    return snapshot;
}

export async function main() {
    const outputPath = process.env.TFS_OUTPUT || "data/current.json";
    const snapshot = await runTfsEtl({
        outputPath,
        fetchPolice: fetchTpsSource,
        updatedBy: process.env.TFS_UPDATED_BY || "manual",
        previousPath: process.env.TFS_PREVIOUS || undefined,
        xmlPath: process.env.TFS_XML || undefined
    });
    console.log(`Wrote ${snapshot.incidents.length} incidents to ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await main();
}
