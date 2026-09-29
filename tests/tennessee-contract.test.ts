import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {TENNESSEE,SOURCE,sourceForSponsor,initial} from '../src/lib/contract-extraction/core';
import {sourceHighlights} from '../src/lib/contract-extraction/highlights';
import {visibleExtraction} from '../src/lib/operational-assurance/catalog';
it('binds Tennessee to the original public PDF, excluding the unsigned amendment',()=>{
 expect(sourceForSponsor('tennessee')).toEqual(TENNESSEE);
 expect(sourceForSponsor('unknown')).toBeUndefined();
 expect(TENNESSEE.pages.every(p=>p.page>10)).toBe(true);
 expect(createHash('sha256').update(readFileSync('public'+TENNESSEE.localUrl)).digest('hex')).toBe(TENNESSEE.sha256);
 expect(TENNESSEE.scope).toContain('redacted');expect(TENNESSEE.scope).toContain('OCR');
});
it('locates every supplied OCR line on its source image without using another document geometry',()=>{
 for(const p of TENNESSEE.pages){
  const quote=p.text.split('\n').find(l=>l.includes('Contractor')&&l.length>30)??p.text.split('\n')[0];
  const result=sourceHighlights(p.page,TENNESSEE.sha256,[{page:p.page,quote,matched:true}]);
  expect(result?.missing).toBe(0);expect(result?.boxes.length).toBeGreaterThan(0);
  for(const b of result!.boxes){expect(b.x).toBeGreaterThanOrEqual(0);expect(b.y).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(result!.width+.01);expect(b.y+b.height).toBeLessThanOrEqual(result!.height+.01);}
 }
 expect(sourceHighlights(13,SOURCE.sha256,[])).toBeNull();
 expect(sourceHighlights(13,'altered',[])).toBeNull();
 expect(sourceHighlights(13,TENNESSEE.sha256,[{page:13,quote:'invented passage',matched:false}])?.boxes).toEqual([]);
});
it('keeps sponsor and cutoff boundaries for model output',()=>{
 const state=initial(TENNESSEE);state.status='Complete';state.execution='model';state.finishedAt='2026-09-29T12:00:00Z';
 expect(visibleExtraction(state,'tennessee',new Date('2026-09-30'))).toBe(true);
 expect(visibleExtraction(state,'wisconsin',new Date('2026-09-30'))).toBe(false);
 expect(visibleExtraction(state,'tennessee',new Date('2026-09-28'))).toBe(false);
 state.source.sha256='changed';expect(visibleExtraction(state,'tennessee',new Date('2026-09-30'))).toBe(false);
});
