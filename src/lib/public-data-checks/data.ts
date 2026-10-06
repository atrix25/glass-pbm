import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import manifest from '../../../data/public-data-checks/manifest.json';
import type {Dataset} from './types';
export {manifest};
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
let cached:Dataset|undefined;
export function dataset():Dataset{
 if(cached)return cached;
 const packed=readFileSync(process.cwd()+'/public/reference/public-data/records.json.gz');
 const bytes=gunzipSync(packed);
 if(createHash('sha256').update(bytes).digest('hex')!==manifest.payloadHash)throw Error('Source integrity check failed');
 cached=JSON.parse(bytes.toString()) as Dataset;return cached;
}
export function assertCutoff(cutoff:Date){if(cutoff<new Date(manifest.retrievedAt))throw Error('Sources unavailable at this cutoff');}
