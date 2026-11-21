(function(root){
 'use strict';
 const localValue=timestamp=>new Date(timestamp+7*3600000).toISOString().slice(0,16);
 function parse(value,now=Date.now()){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value||''))throw new Error('กรุณาเลือกวันและเวลาโพสต์');
  const timestamp=Date.parse(value+':00+07:00');
  if(!Number.isFinite(timestamp)||localValue(timestamp)!==value)throw new Error('วันหรือเวลาไม่ถูกต้อง');
  if(timestamp<now+5*60000)throw new Error('กรุณาตั้งเวลาล่วงหน้าอย่างน้อย 5 นาที และเผื่อเวลาอัปโหลดไฟล์');
  return new Date(timestamp).toISOString();
 }
 function format(value){return new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}).format(new Date(value))+' น. (เวลาไทย)';}
 const api={localValue,parse,format};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PublishSchedule=api;
})(typeof globalThis!=='undefined'?globalThis:this);
