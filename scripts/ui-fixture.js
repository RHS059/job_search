import { writeFile } from 'node:fs/promises';
import { mergeCandidates } from '../src/domain.js';
const data={version:1,jobs:[],lastRun:null};
mergeCandidates(data.jobs,[{title:'Product Designer — TEST FIXTURE',company:'Example Studio',location:'Remote · US',remote:true,url:'https://jobs.lever.co/example/test-only',postedAt:new Date().toISOString()}],{Lever:['jobs.lever.co']});
await writeFile(process.argv[2],JSON.stringify(data));
