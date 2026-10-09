// Publish mock-test failure excerpts as check annotations when artifact access is unavailable.
import {readFileSync} from 'node:fs';
const log=readFileSync(process.argv[2],'utf8').replace(/\u001b\[[0-9;]*m/g,'');
const lines=log.split('\n');
const escape=value=>value.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
const level=process.argv[3]==='warning'?'warning':'error';
const failures=[...new Set(lines.filter(line=>/^✖ /u.test(line) && !line.includes('failing tests:')))];
if(!failures.length)failures.push(...lines.filter(line=>/^not ok \d+/.test(line)));
for(const failure of failures.slice(0,20)){
 const detailStart=lines.findIndex((line,index)=>line===failure && lines.slice(Math.max(0,index-3),index).some(x=>/^test at /.test(x)));
 const first=lines.indexOf(failure);
 const context=lines.slice(Math.max(0,first-8),first).filter(line=>/Error:|unhandledRejection|asynchronous activity/.test(line)).join('\n');
 const detail=detailStart<0?failure:lines.slice(detailStart,detailStart+30).join('\n');
 const excerpt=[context,detail].filter(Boolean).join('\n');
 process.stdout.write(`::${level} title=Regression failure::${escape(excerpt.slice(0,6000))}\n`);
}
