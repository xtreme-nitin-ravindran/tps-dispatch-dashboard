import { writeFile, mkdir } from 'node:fs/promises';
import { frontendFixture } from '../test/fixtures/ttc-diversions/frontend.js';
await mkdir('test/fixtures/ttc-diversions',{recursive:true});
await writeFile('test/fixtures/ttc-diversions/frontend.json',JSON.stringify(await frontendFixture(),null,2)+'\n');
