import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchTfsSource, parseTfsXml } from "../src/tfs/source.js";
import { buildTfsSnapshot } from "../src/pipeline/tfs-snapshot.js";

import { enrichLocations } from "../src/pipeline/location-enrichment.js";
import { createOpenLocationResolver } from "../src/pipeline/open-locations.js";

// Explicit history inputs must exist: a missing Concourse artifact must not erase history.
export async function runTfsEtl({
    outputPath = "data/current.json", previousPath, xmlPath,
    fetchSource = fetchTfsSource, now = new Date(), updatedBy = "manual"
} = {}) {
    if (!["manual", "concourse", "github-actions"].includes(updatedBy)) throw new Error("Invalid updater identity");
    let previous = null;
    try {
        previous = JSON.parse(await readFile(previousPath || outputPath, "utf8"));
    } catch (error) {
        if (error.code !== "ENOENT" || previousPath) throw error;
    }
    const source = xmlPath
        ? parseTfsXml(await readFile(xmlPath, "utf8"))
        : await fetchSource({ signal: AbortSignal.timeout(30_000) });
    const snapshot = buildTfsSnapshot(source, now, previous);
    snapshot.updatedBy = updatedBy;
    const [index, boundaries] = await Promise.all([
        readFile(new URL("../data/geography/toronto-locations.json", import.meta.url), "utf8").then(JSON.parse),
        readFile(new URL("../data/police-divisions.geojson", import.meta.url), "utf8").then(JSON.parse)
    ]);
    await enrichLocations(snapshot, previous, {
        resolveLocation: createOpenLocationResolver(index, boundaries), now,
        maxLookups: Infinity, source: "toronto-centreline-geonames-2026-09-19"
    });
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
        updatedBy: process.env.TFS_UPDATED_BY || "manual",
        previousPath: process.env.TFS_PREVIOUS || undefined,
        xmlPath: process.env.TFS_XML || undefined
    });
    console.log(`Wrote ${snapshot.incidents.length} TFS incidents to ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await main();
}
