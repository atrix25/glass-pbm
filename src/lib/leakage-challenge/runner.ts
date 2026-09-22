import { detect, type Evidence } from '../contract-checks/detector';
/** Narrow boundary: neither the seed, clean baseline nor answer key is accepted. */
export function runDetector(input:Evidence,cutoff:string){return detect(input,cutoff);}
export const DETECTOR_VERSION='rebate-detector-v1';
