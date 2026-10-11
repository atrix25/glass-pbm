const {chromium}=require(process.cwd()+'/node_modules/playwright');
const assert=require('node:assert/strict');
const base=process.env.GLASS_BASE_URL || 'http://127.0.0.1:3000';
require('node:fs').mkdirSync('/tmp/glass-caremark-qa',{recursive:true});
(async()=>{
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1050},...(process.env.DEMO_PASSWORD?{httpCredentials:{username:process.env.DEMO_USERNAME||'josh',password:process.env.DEMO_PASSWORD}}:{})});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(base+'/sponsor');await page.getByRole('heading',{name:'Plan outlook',exact:true}).waitFor();
await page.screenshot({path:'/tmp/glass-caremark-qa/sponsor.png',fullPage:true});
await page.getByRole('link',{name:'Adjust assumptions'}).click();await page.getByRole('heading',{name:'Build the offering',exact:true}).waitFor();
await page.getByLabel('Covered lives',{exact:true}).fill('100');await page.getByLabel('Pricing arrangement').selectOption('drug-rebate');await page.getByLabel('Client drug price · $ PMPM',{exact:true}).fill('200');await page.getByRole('button',{name:'Update estimate'}).click();await page.waitForURL(/members=100/);assert.match(await page.locator('body').innerText(),/\$127\.00/);
await page.getByRole('navigation',{name:'Offering views'}).getByRole('link',{name:'Plan outlook',exact:true}).click();assert.match(page.url(),/members=100/);assert.match(await page.locator('body').innerText(),/\$152,400/);
await page.getByRole('navigation',{name:'Offering views'}).getByRole('link',{name:'Caremark economics',exact:true}).click();await page.getByRole('heading',{name:'Business outlook'}).waitFor();assert.match(page.url(),/drug-rebate/);
await page.goto(base+'/offering');await page.getByRole('heading',{name:'Build the offering'}).waitFor();await page.screenshot({path:'/tmp/glass-caremark-qa/offering.png',fullPage:true});
await page.setViewportSize({width:390,height:844});await page.goto(base+'/sponsor');await page.getByRole('heading',{name:'Plan outlook',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'/tmp/glass-caremark-qa/mobile.png',fullPage:true});
await page.goto(base+'/offering');await page.getByRole('heading',{name:'Build the offering'}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.getByLabel('Covered lives',{exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.name),'budget');
await page.goto(base+'/agents');await page.getByText('Reference workflow',{exact:true}).waitFor();assert.equal(errors.length,0,errors.join('\n'));
console.log('PASS: model changes, URL continuity, annual totals, reference boundary, keyboard controls, mobile overflow, client errors');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
