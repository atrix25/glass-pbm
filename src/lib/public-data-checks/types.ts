export type SourceRow={id:string;area:string;source:string;line:number;values:Record<string,string>};
export type Dataset={snapshots:Record<string,SourceRow[]>;prices:SourceRow[]};
export type DraftRow={id:string;area:string;values:Record<string,string>};
export type Change={id:string;area:string;kind:'Added'|'Removed'|'Changed';fields:string[]};
export type Check={name:string;status:'Passed'|'Failed'|'Missing evidence';count:number;detail:string};
export type State={version:1;engine:string;verifier:string;inputHash:string;createdAt:string;stage:'Compared'|'Draft built'|'Verified';changes:Change[];draft:DraftRow[]|null;priceLookups:PriceLookup[];checks:Check[];events:{at:string;action:string}[];commands:Record<string,string>};
export type PriceLookup={ndc:string;unit:string;asOf:string;effectiveOn:string;sourceId:string|null;rate:string|null};
