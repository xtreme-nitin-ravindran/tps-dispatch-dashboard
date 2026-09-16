import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { fetchTfsSource } from "../src/tfs/source.js";
import { buildTfsSnapshot } from "../src/pipeline/tfs-snapshot.js";

const outputPath = process.env.TFS_OUTPUT || "data/current.json";
let previous = null;
try {
    previous = JSON.parse(await readFile(outputPath, "utf8"));
} catch (error) {
    if (error.code !== "ENOENT") throw error;
}
const source = await fetchTfsSource({ signal: AbortSignal.timeout(30_000) });
if (!source.updatedAt) throw new Error("TFS source is missing its update timestamp; keeping the previous snapshot");
const snapshot = buildTfsSnapshot(source, new Date(), previous);

await mkdir(dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
await rename(temporaryPath, outputPath);
console.log(`Wrote ${snapshot.incidents.length} TFS incidents to ${outputPath}`);
