import type {OnboardingData} from './domain';
export type SetupGap = {stage:number;message:string};
const requirements=['Contract authority','Clinical review','Member protections','Effective date'];
/** Shared, readable prerequisites; server-side validation still governs every action. */
export function evidenceGaps(d:OnboardingData):SetupGap[]{
 const gaps:SetupGap[]=[];
 if(!d.validated?.passed)gaps.push({stage:1,message:d.validated?.errors.length?`Census: ${d.validated.errors.join(' ')}`:'Validate the census in Members.'});
 if(!d.impact||d.impact.claims!==d.census.length*3)gaps.push({stage:2,message:'Run the digital twin in Design for the complete census.'});
 if(!d.checks?.length)gaps.push({stage:3,message:'Run Check requirements in Review.'});
 else for(const name of requirements){
  const check=d.checks.find(c=>c.name===name);
  if(!check)gaps.push({stage:3,message:`${name}: evidence is missing. Run Check requirements in Review.`});
  else if(check.status==='Failed'||check.status==='Missing evidence'||!['Passed','Needs review'].includes(check.status))gaps.push({stage:name==='Effective date'?0:name==='Contract authority'&&d.setup.kind==='blocked'?2:3,message:name==='Effective date'?'The effective date is before the frozen evidence date. Update it in Employer, then repeat validation and review.':name==='Contract authority'&&d.setup.kind==='blocked'?'The unsupported restriction has no contract authority. Choose a supported change in Design, then repeat validation and review.':`${name}: ${check.status}. Review the requirement and supporting evidence.`});
 }
 return gaps;
}
export function actionGaps(d:OnboardingData,command:string):SetupGap[]{
 const gaps=evidenceGaps(d);
 if(command==='analyze')return gaps.filter(g=>g.stage===1);
 if(command==='check')return gaps.filter(g=>g.stage===1||g.stage===2&&g.message.startsWith('Run the digital twin'));
 if(!['decide','test','launch'].includes(command))return [];
 if(command==='decide')return gaps;
 const roles=['pa','specialty'].includes(d.setup.kind)?['Employer','Clinical']:['Employer'];
 for(const role of roles)if(!d.decisions.some(x=>x.role===role&&x.approved))gaps.push({stage:3,message:`${role} approval is required in Review.`});
 if(command==='launch'&&(!d.version||!d.tests?.length||d.tests.some(t=>!t.passed)))gaps.push({stage:4,message:'Generate the reviewed version and pass claim tests in Test.'});
 return gaps;
}
