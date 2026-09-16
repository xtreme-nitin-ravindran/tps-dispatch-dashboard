import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchTfsSource, parseTfsXml } from "../src/tfs/source.js";
import { buildTfsSnapshot } from "../src/pipeline/tfs-snapshot.js";

// Explicit history inputs must exist: a missing Concourse artifact must not erase history.
export async function runTfsEtl({
    outputPath = "data/current.json", previousPath, xmlPath,
    fetchSource = fetchTfsSource, now = new Date()
} = {}) {
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
        previousPath: process.env.TFS_PREVIOUS || undefined,
        xmlPath: process.env.TFS_XML || undefined
    });
    console.log(`Wrote ${snapshot.incidents.length} TFS incidents to ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await main();
}
