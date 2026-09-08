import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../lib/scan/worker.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const drain = () => new Promise(resolve=>setImmediate(resolve));
async function fixture({allowed=true,permissionError=false}={}) {
  const platform=deferred(),claim=deferred(),recognition=deferred();
  const timers=[];const calls={permission:0,claim:0,recognition:0,complete:0};
  const noop=async()=>{};const exports={};
  const dependencies={
    '@/lib/store-runtime':{isManagedStore:()=>true,getStoreRuntime:async()=>{calls.permission++;await platform.promise;if(permissionError)throw new Error('offline');return {accessAllowed:allowed};}},
    '@/lib/ops':{logOp:noop},
    './detect':{ScanFailedError:class extends Error{}},'./intake':{SCAN_MODEL:'fixture',usageFromOutcomes:()=>({})},
    './cost':{sumCost:()=>0},'./transport':{callModelVertex:()=>assert.fail('No model calls allowed')},
    './transport-flex':{SCAN_SERVICE_TIER:'standard',callModelVertexFlex:()=>assert.fail('No model calls allowed')},
    './jobs':{ensureJobIndexes:noop,reclaimStale:noop,sweepOrphans:noop,heartbeat:noop,setJobStage:noop,deleteJobPhoto:noop,writeJobResult:noop,failJob:noop,readJobPhoto:async()=>Buffer.from('fixture'),
      claimNextJob:async()=>{calls.claim++;await claim.promise;return {_id:'fixture-id',hash:'fixture-photo'};},completeJob:async()=>{calls.complete++;}},
    './run':{runRowsHd:async()=>{calls.recognition++;await recognition.promise;return {entries:[],outcomes:[]};}},
  };
  vm.runInNewContext(compiled,{exports,Buffer,process:{env:{}},console:{log(){},warn(){},error(){}},
    setInterval(callback,ms){timers.push({callback,ms});return {unref(){}};},clearInterval(){},
    require(name){assert.ok(name in dependencies,`Unexpected dependency: ${name}`);return dependencies[name];},
  });
  exports.startScanWorker();await drain();
  const tick=timers.find(timer=>timer.ms===3000).callback;
  return {tick,calls,platform,claim,recognition};
}
test('overlapping timers cannot overclaim while the platform or Mongo claim is slow',async()=>{
  const f=await fixture();for(let i=0;i<8;i++)f.tick();await drain();assert.equal(f.calls.permission,1);
  f.platform.resolve();await drain();assert.equal(f.calls.claim,1);
  for(let i=0;i<8;i++)f.tick();await drain();assert.equal(f.calls.permission,1);assert.equal(f.calls.claim,1);
  f.claim.resolve();await drain();assert.equal(f.calls.recognition,1);
  for(let i=0;i<8;i++)f.tick();await drain();assert.equal(f.calls.claim,1,'standard tier reserves only one in-flight photo');
  f.recognition.resolve();await drain();assert.equal(f.calls.complete,1);
  f.tick();await drain();assert.equal(f.calls.claim,2,'scheduler resumes after the previous photo finishes');
});
test('permission denial or failure releases the tick lock without claiming a photo',async()=>{
  for(const options of [{allowed:false},{permissionError:true}]){
    const f=await fixture(options);f.platform.resolve();f.tick();await drain();f.tick();await drain();
    assert.equal(f.calls.permission,2);assert.equal(f.calls.claim,0);
  }
});
