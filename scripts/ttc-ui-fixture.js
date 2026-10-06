import { writeFile, mkdir } from 'node:fs/promises';
import { frontendFixture } from '../test/fixtures/ttc-diversions/frontend.js';
import { officialAdvisoryFrontendFixture } from '../test/fixtures/ttc-official-advisory/frontend.js';
await mkdir('test/fixtures/ttc-diversions',{recursive:true});
await writeFile('test/fixtures/ttc-diversions/frontend.json',JSON.stringify(await frontendFixture(),null,2)+'\n');
await mkdir('test/fixtures/ttc-official-advisory',{recursive:true});
await writeFile('test/fixtures/ttc-official-advisory/frontend.json',JSON.stringify(officialAdvisoryFrontendFixture(),null,2)+'\n');
