import {createHandler,validate} from '../supabase/functions/buffer-publish/index.ts';
const assert=(v:unknown)=>{if(!v)throw new Error('Assertion failed');};
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const input={action:'send',id,platform:'youtube',title:'Test',caption:'Caption',aiGenerated:false,madeForKids:false,
 meta:{name:'a.mp4',kind:'video',size:1024,width:1080,height:1920,duration:60}};
function harness(options:{denyAuth?:boolean;denyRole?:boolean;missingFile?:boolean;timeout?:boolean;badStore?:boolean;reject?:boolean}={}){
 let entry:any=null,mutations=0;
 const handler=createHandler({env:n=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-secret',BUFFER_API_KEY:'buffer-secret'}[n]),
  fetch:async(url,init)=>{
   const path=String(url),body=init?.body?JSON.parse(String(init.body)):null;
   if(path.endsWith('/auth/v1/user'))return Response.json({id:uid},{status:options.denyAuth?401:200});
   if(path.includes('/rest/v1/publishers?'))return Response.json(options.denyRole?[]:[{user_id:uid}]);
   if(path.includes('/storage/v1/object/list/'))return Response.json(options.missingFile?[]:[{name:'media.mp4',metadata:{size:1024,mimetype:'video/mp4'}}]);
   if(path.includes('/rest/v1/publishing_channels?'))return Response.json([{channel_id:'server-selected-channel'}]);
   if(path.includes('/rest/v1/publishing_deliveries')){
    if(init?.method==='POST'){if(entry)return Response.json({},{status:409});entry={state:'sending',post_id:null};return Response.json({},{status:201});}
    if(init?.method==='PATCH'){if(options.badStore)return Response.json({},{status:500});entry=body;return Response.json({});}
    return Response.json(entry?[entry]:[]);
   }
   if(path==='https://api.buffer.com'){
    if(body.query.startsWith('query Status'))return Response.json({data:{post:{id:'post-1',status:'sent',externalLink:'https://youtube.com/shorts/test'}}});
    mutations++;
    assert(body.variables.input.channelId==='server-selected-channel');
    assert(body.variables.input.needsApproval===false);
    assert(body.variables.input.metadata.youtube.title==='Test');
    assert(body.variables.input.assets[0].video.url===`https://test.supabase.co/storage/v1/object/public/publishing-media/${uid}/${id}/media.mp4`);
    if(options.timeout)throw new Error('Timed out');
    return Response.json({data:{createPost:options.reject?{__typename:'InvalidInputError',message:'secret-upstream-detail'}:{__typename:'PostActionSuccess',post:{id:'post-1'}}}});
   }
   throw new Error('Unexpected URL '+path);
  }});
 const send=(body:any=input,headers:any={Authorization:'Bearer user-token'})=>handler(new Request('https://test/publish',{method:'POST',headers,body:JSON.stringify(body)}));
 return {send,handler,count:()=>mutations};
}
Deno.test('requires authenticated and allowlisted publishers before Buffer calls',async()=>{
 for(const opts of [{denyAuth:true},{denyRole:true}]){const h=harness(opts);assert((await h.send()).status===(opts.denyAuth?401:403));assert(h.count()===0);}
 const h=harness();assert((await h.send(input,{})).status===401);assert(h.count()===0);
});
Deno.test('rejects invalid media, oversized files and wrong origins without upstream mutation',async()=>{
 const h=harness({missingFile:true});assert((await h.send()).status===400);assert(h.count()===0);
 assert(validate({...input,meta:{...input.meta,size:52428801}})==='INVALID_MEDIA');
 assert(validate({...input,meta:{...input.meta,duration:181}})==='MANUAL_REQUIRED');
 assert(validate({...input,platform:'facebook',meta:{...input.meta,duration:91}})==='MANUAL_REQUIRED');
 assert(validate({...input,platform:'tiktok',meta:{...input.meta,duration:361}})==='MANUAL_REQUIRED');
 assert((await h.send(input,{Authorization:'Bearer user-token',Origin:'https://other.example'})).status===403);
});
Deno.test('concurrent submissions and later reloads create exactly one Buffer post',async()=>{
 const h=harness();await Promise.all([h.send(),h.send()]);await h.send();assert(h.count()===1);
 const r=await h.send({...input,action:'status'});const data=await r.json();assert(data.providerStatus==='sent'&&data.post_id==='post-1');
});
Deno.test('timeouts and persistence failures never automatically retry a potentially created post',async()=>{
 for(const options of [{timeout:true},{badStore:true}]){
  const h=harness(options);const result=await(await h.send()).json();assert(result.state==='unknown');
  await h.send();assert(h.count()===1);
 }
});
Deno.test('explicit rejection is recorded without exposing upstream details or keys',async()=>{
 const h=harness({reject:true});const r=await h.send();const body=await r.text();assert(body.includes('rejected')&&!body.includes('secret'));
 await h.send();assert(h.count()===1);
});
