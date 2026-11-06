import { readFile } from 'node:fs/promises'
import { createDecipheriv, createHash, randomUUID } from 'node:crypto'
const SALT_A = Uint8Array.from([82,9,106,213,48,54,165,56,191,64,163,158,129,243,215,251,124,227,57,130,155,47,255,135,52,142,67,68,196,222,233,203,84,123,148,50,166,194,35,61,238,76,149,11,66,250,195,78,8,46,161,102,40,217,36,178,118,91,162,73,109,139,209,37])
const SALT_B = Uint8Array.from([31,221,168,51,136,7,199,49,177,18,16,89,39,128,236,95,96,81,127,169,25,181,74,13,45,229,122,159,147,201,156,239,160,224,59,77,174,42,245,176,200,235,187,60,131,83,153,97,23,43,4,126,186,119,214,38,225,105,20,99,85,33,12,125])
const SALT_C = Uint8Array.from([191,192,216,250,122,246,220,97,31,254,98,27,8,72,71,176,135,99,96,18,127,101,203,104,211,102,191,125,37,72,150,156,51,229,121,35,17,153,141,177,110,131,150,128,172,255,254,6,18,140,55,62,236,249,135,64,135,12,117,4,89,149,168,209])
const SALT_D = Uint8Array.from([246,204,26,232,232,70,129,109,223,146,169,242,23,241,105,145,50,196,165,42,254,120,3,54,244,207,209,85,53,6,138,106,175,148,31,204,186,186,165,182,87,142,49,10,39,110,26,154,86,56,173,125,18,64,198,225,99,99,83,82,191,134,76,170])
const xor=(a,b)=>Buffer.from(a.map((v,i)=>v^(b[i]??0)))
function decrypt(encoded){const b=Buffer.from(encoded,'base64');const h=b.subarray(0,6);const type=h.equals(Buffer.from([0x74,0x63,0x05,0x10,0x00,0x00]))?'aes':'aes-private';const salt=type==='aes-private'?xor(SALT_C,SALT_D):xor(SALT_A,SALT_B);const first=createHash('sha512').update(b.subarray(6,38)).digest();const derived=createHash('sha512').update(Buffer.concat([first,salt])).digest();const d=createDecipheriv('aes-128-cbc',derived.subarray(0,16),derived.subarray(16,32));return Buffer.concat([d.update(b.subarray(38)),d.final()]).subarray(64).toString('utf8')}
const storage=JSON.parse(await readFile('/Users/<user>/Library/Application Support/Trae CN/User/globalStorage/storage.json','utf8'))
const cred=JSON.parse(decrypt(storage['iCubeAuthInfo://icube.cloudide']))
const product=JSON.parse(await readFile('/Applications/Trae CN.app/Contents/Resources/app/product.json','utf8'))
const deviceId=Object.keys(storage).find(k=>k.startsWith('iCubeAuthInfo://icube-dc:')).slice('iCubeAuthInfo://icube-dc:'.length)
function H(accept='text/event-stream'){const rid=randomUUID();const tid=rid.replaceAll('-','');return{'Authorization':'Cloud-IDE-JWT '+cred.token,'X-Ide-Token':cred.token,'X-Cloudide-Token':cred.token,'x-plugin-channel':'icube-ai','User-Agent':'Trae/'+product.appVersion,'x-app-id':'6eefa01c-1036-4c7e-9ca5-d891f63bfcd8','x-machine-id':storage['telemetry.machineId'],'x-device-id':deviceId,'x-device-type':'mac','x-app-version':product.appVersion,'x-ide-version':product.appVersion,'x-app-version-code':'20260716','x-ide-version-code':'20260716','x-ide-version-type':'stable','x-uid':cred.userId,'x-request-id':rid,'x-trae-request-id':rid,'x-custom-trace-id':tid,'x-flow-traceparent':'04-'+tid+'-'+tid.slice(0,16)+'-01','request-traffic-type':'prod','Content-Type':'application/json','Accept':accept}}
const B='https://trae-api-cn.mchost.guru'
const MODEL=process.argv[2]??'deepseek-v4.1-flash'
const TEXT='Reply with exactly: OK'
// (1) full error text with a minimal body
let r=await fetch(B+'/api/ide/v1/agents/runs',{method:'POST',headers:H(),body:JSON.stringify({model:MODEL,config_name:MODEL,messages:[{role:'user',content:[{type:'text',text:TEXT}]}],stream:true}),signal:AbortSignal.timeout(45_000)})
console.log('[minimal body] HTTP '+r.status)
console.log('  '+JSON.stringify((await r.text()).slice(0,420)))
// (2) with the solved agent-task shaped body
const sid=randomUUID()
const rich={messages:[{role:'user',content:[{type:'text',text:TEXT}]}],model:MODEL,config_name:MODEL,model_name:MODEL,function:'inline_chat',stream:true,request_id:sid,conversation_id:randomUUID(),session_id:sid,user_id:cred.userId,device_id:deviceId,agent_type:'chat',mode_type:0,ide_version:product.appVersion,user_input:{id:randomUUID(),text:TEXT,content:TEXT,type:'text',role:'user'}}
r=await fetch(B+'/api/ide/v1/agents/runs',{method:'POST',headers:H(),body:JSON.stringify(rich),signal:AbortSignal.timeout(45_000)})
console.log('\n[agent-task shaped body] HTTP '+r.status)
console.log('  '+JSON.stringify((await r.text()).slice(0,420)))
// (3) discovery: GET variants of the agents API
for(const p of ['/api/ide/v1/agents','/api/ide/v1/agents/runs','/api/ide/v1/agents/config','/api/ide/v1/agent_config','/api/ide/v1/get_agents']){
  try{ const g=await fetch(B+p,{headers:H('application/json'),signal:AbortSignal.timeout(12_000)}); const t=(await g.text()).slice(0,150).replace(/\s+/g,' '); console.log('[GET '+p.padEnd(30)+'] HTTP '+g.status+'  '+JSON.stringify(t.slice(0,90))) }catch(e){ console.log('[GET '+p+'] FAILED') }
}
