import {spawn} from 'node:child_process';
const child=spawn('npx',['tsx','scripts/gemma-worker.ts'],{stdio:'inherit',env:process.env});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
