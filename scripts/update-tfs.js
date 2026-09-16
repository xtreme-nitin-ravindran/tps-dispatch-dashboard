import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fetchTfsSource } from "../src/tfs/source.js";
import { buildTfsSnapshot } from "../src/pipeline/tfs-snapshot.js";

const outputPath = process.env.TFS_OUTPUT || "data/current.json";
const source = await fetchTfsSource({ signal: AbortSignal.timeout(30_000) });
if (!source.updatedAt) throw new Error("TFS source is missing its update timestamp; keeping the previous snapshot");
const snapshot = buildTfsSnapshot(source);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Wrote ${snapshot.incidents.length} TFS incidents to ${outputPath}`);
