import { spawn } from 'node:child_process';
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
const host=option('--host',option('--hostname','127.0.0.1'));
const port=option('--port','3000');
if(!/^\d{1,5}$/.test(port)||Number(port)>65535||Number(port)<1)throw new Error('Invalid preview port');
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname',host,'--port',port],{stdio:'inherit',env:process.env});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code??1;});
