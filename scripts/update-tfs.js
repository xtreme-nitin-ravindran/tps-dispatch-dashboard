import { mkdir, writeFile } from "node:fs/promises";
import { fetchTfsSource } from "../src/tfs/source.js";
import { buildTfsSnapshot } from "../src/pipeline/tfs-snapshot.js";

const outputPath = process.env.TFS_OUTPUT || "data/tfs-current.json";
const source = await fetchTfsSource();
const snapshot = buildTfsSnapshot(source);

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Wrote ${snapshot.incidents.length} TFS incidents to ${outputPath}`);
