import {newProcess} from './source';
import {run,decide,external,repair} from './processor';
import {compare} from './verifier';
import {STAGES,type ProcessState} from './types';
export function playback(state:ProcessState){
 for(let pass=0;pass<12;pass++){
  run(state);
  for(const s of STAGES){const step=state.steps[s.id];if(step.status==='Awaiting review')decide(state,s.id,'Approved','Automated test harness · simulated decision');
   if(step.status==='Awaiting evidence'){if(s.id==='manufacturer'){if(!step.external.acceptance)external(state,s.id,'acceptance','Test harness');if(state.steps[s.id].status==='Awaiting evidence'&&!step.external.settlement)external(state,s.id,'settlement','Test harness');}else if(s.id==='notices')external(state,s.id,'delivery','Test harness');}
  }
 }
 return state;
}
export function testFlow(state:ProcessState){
 const cases:NonNullable<ProcessState['tests']>['cases']=[];
 const clean=playback(newProcess(state.sponsor));
 for(const stage of STAGES){
  cases.push({name:'Independent clean benchmark',area:stage.id,passed:compare(stage.id,clean.steps[stage.id].output)&&clean.steps[stage.id].status==='Released',detail:'Separate expected values; synthetic approvals and external responses occur only in this test copy.'});
  const bad=newProcess(state.sponsor);bad.overrides[stage.id]={unexpectedChargeCents:100};playback(bad);
  cases.push({name:'Incorrect output blocked',area:stage.id,passed:bad.steps[stage.id].status==='Failed',detail:'Unsupported output field cannot pass the release gate.'});
  repair(bad,stage.id,'Test harness');playback(bad);
  cases.push({name:'Correction and downstream retest',area:stage.id,passed:compare(stage.id,bad.steps[stage.id].output)&&STAGES.every(s=>bad.steps[s.id].status==='Released'),detail:'Working correction regenerates outputs; affected approvals and external evidence are recreated in the test copy.'});
  for(const missing of [true,false]){const book=newProcess(state.sponsor);book.source.terms[stage.id]=missing?[]:[...book.source.terms[stage.id],{...book.source.terms[stage.id][0],id:'conflicting'}];playback(book);cases.push({name:missing?'Missing source blocks release':'Conflicting source blocks release',area:stage.id,passed:book.steps[stage.id].status==='Missing evidence',detail:'Unknown evidence never counts as a pass.'});}
  const current=state.steps[stage.id];cases.push({name:'Selected run release',area:stage.id,passed:current.status==='Released'&&current.checks.every(c=>c.status==='Passed'),detail:current.status==='Released'?'Recorded gates passed.':`Not complete: ${current.status}.`});
 }
 state.tests={at:new Date().toISOString(),cases};
 state.events.push({at:state.tests.at,step:null,kind:'Tests recorded',actor:'Independent benchmark harness · scripted',detail:`${cases.filter(c=>c.passed).length}/${cases.length} checks passed. Test-copy approvals do not approve this run.`});
}
