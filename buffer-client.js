(function () {
 'use strict';
 const $=id=>document.getElementById(id);
 // Separate session from the legacy PIN UI. No secret keys in this client.
 const authStorage=window.createPublisherStorage(localStorage,sessionStorage);
 const client=supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{storage:authStorage,storageKey:'teamflow-publisher',persistSession:true,detectSessionInUrl:false}});
 $('pub-remember').checked=authStorage.remembered();
 $('pub-remember').onchange=()=>{
  try{authStorage.setRemember($('pub-remember').checked);
   $('pub-auth-message').textContent=$('pub-remember').checked?'จะจำการเข้าสู่ระบบบนเครื่องนี้แล้ว':'เปลี่ยนเป็นจำเฉพาะแท็บนี้แล้ว';
  }catch{$('pub-remember').checked=authStorage.remembered();$('pub-auth-message').textContent='บันทึกการตั้งค่าไม่ได้ กรุณาตรวจพื้นที่จัดเก็บของเบราว์เซอร์';}
 };
 let channels=[],user=null;
 const errors={LOGIN_REQUIRED:'กรุณาเข้าสู่ระบบผู้โพสต์อีกครั้ง',PUBLISHER_REQUIRED:'บัญชีนี้ยังไม่ได้รับสิทธิ์โพสต์',MANUAL_REQUIRED:'ไฟล์นี้ต้องลงเองในช่องทางที่เลือก',INVALID_MEDIA:'ไฟล์ไม่ถูกต้องหรือเกิน 50 MB',MEDIA_MISMATCH:'ข้อมูลไฟล์บนเซิร์ฟเวอร์ไม่ตรง กรุณาตรวจไฟล์',MEDIA_NOT_FOUND:'ยังไม่พบไฟล์ที่อัปโหลด',METADATA_REQUIRED:'กรุณาระบุข้อมูลเนื้อหาวิดีโอ',SERVER_CONFIG_MISSING:'ระบบหลังบ้านยังตั้งค่าไม่ครบ',SERVICE_UNAVAILABLE:'ติดต่อระบบไม่ได้ กรุณาตรวจสถานะก่อนส่งซ้ำ'};
 async function call(body){
  const {data:{session}}=await client.auth.getSession();
  if(!session)throw new Error(errors.LOGIN_REQUIRED);
  let response;try{response=await fetch(SUPABASE_URL+'/functions/v1/smooth-responder',{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});}catch{throw new Error('ติดต่อระบบส่งโพสต์ไม่ได้ กรุณาตรวจสถานะก่อนส่งซ้ำ');}
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(errors[result.code]||'ระบบยังไม่พร้อมใช้งาน ('+(result.code||response.status)+')');
  return result;
 }
 async function refresh(){
  channels=[];user=null;
  const {data:{session}}=await client.auth.getSession();
  if(session){try{const result=await call({action:'channels'});channels=result.channels;user=session.user;$('pub-auth-message').textContent='พร้อมส่ง: '+channels.map(c=>c.name).join(' · ');}catch(e){$('pub-auth-message').textContent=e.message;}}
  else $('pub-auth-message').textContent='เข้าสู่ระบบด้วยบัญชีผู้โพสต์ที่ผู้ดูแลเพิ่มใน Supabase';
  $('pub-connections').textContent=user?'บัญชีผู้โพสต์ · '+channels.length+' ช่องทาง':'เข้าสู่ระบบผู้โพสต์';
  $('pub-auth-form').hidden=!!user;$('pub-signout').hidden=!session;
  window.dispatchEvent(new Event('publisherchange'));
 }
 $('pub-auth-form').onsubmit=async e=>{
  e.preventDefault();$('pub-auth-form').inert=true;
  try{const {error}=await client.auth.signInWithPassword({email:$('pub-auth-email').value.trim(),password:$('pub-auth-password').value});
   $('pub-auth-password').value='';if(error)throw new Error('เข้าสู่ระบบไม่ได้ กรุณาตรวจอีเมลและรหัสผ่าน');await refresh();
  }catch(e){$('pub-auth-message').textContent=e.message;}finally{$('pub-auth-form').inert=false;}
 };
 $('pub-signout').onclick=async()=>{await client.auth.signOut({scope:'local'});await refresh();};
 window.PublishBuffer={
  ready:()=>!!user,
  channel:p=>channels.find(c=>c.platform===p),
  async upload(item){
   if(!user)throw new Error(errors.LOGIN_REQUIRED);
   if(item.publisherId && item.publisherId!==user.id)throw new Error('รายการนี้ผูกกับบัญชีผู้โพสต์อื่น กรุณาเข้าสู่ระบบบัญชีเดิม');
   if(item.meta.size>52428800)throw new Error('ไฟล์เกิน 50 MB สำหรับพื้นที่อัปโหลดนี้ กรุณาลงเองหรือลดขนาดไฟล์');
   item.publisherId=user.id;
   const ext=item.meta.name.split('.').pop().toLowerCase(),folder=user.id+'/'+item.id;
   const mime={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',m4v:'video/x-m4v',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png'}[ext];
   const {data:files,error:listError}=await client.storage.from('publishing-media').list(folder);
   if(listError)throw new Error('เปิดพื้นที่อัปโหลดไม่ได้ กรุณาตรวจการตั้งค่าและสิทธิ์');
   if(files.some(f=>f.name==='media.'+ext))return;
   const {error}=await client.storage.from('publishing-media').upload(folder+'/media.'+ext,item.file,{contentType:mime,upsert:false});
   if(error)throw new Error('อัปโหลดไม่สำเร็จ กรุณาตรวจเครือข่ายและพื้นที่จัดเก็บ แล้วลองใหม่');
  },
  async status(item,platform){
   if(item.publisherId && item.publisherId!==user?.id)throw new Error('กรุณาเข้าสู่ระบบบัญชีผู้โพสต์เดิม');
   return call({action:'status',id:item.id,platform});
  },
  send:(item,platform,options)=>call({action:'send',id:item.id,platform,title:item.title,caption:item.caption,meta:item.meta,...options}),
  refresh
 };
 refresh();
})();
