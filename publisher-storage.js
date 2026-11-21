/* Publisher sessions only; never stores the user's password. */
(function(root) {
 'use strict';
 function createPublisherStorage(persistent, temporary) {
  const prefix='teamflow-publisher', preference=prefix+'-remember';
  const remembered=()=>persistent.getItem(preference)==='true';
  const destination=()=>remembered()?persistent:temporary;
  function setRemember(value) {
   const target=value?persistent:temporary, source=value?temporary:persistent;
   const keys=[];
   for(let i=0;i<source.length;i++){
    const key=source.key(i);
    if(key!==preference&&(key===prefix||key?.startsWith(prefix+'-')))keys.push(key);
   }
   // Write copies before removing originals so a quota error preserves the session.
   for(const key of keys)target.setItem(key,source.getItem(key));
   persistent.setItem(preference,value?'true':'false');
   for(const key of keys)source.removeItem(key);
  }
  return {remembered,setRemember,
   getItem:key=>destination().getItem(key),
   setItem(key,value){destination().setItem(key,value);(remembered()?temporary:persistent).removeItem(key);},
   removeItem(key){persistent.removeItem(key);temporary.removeItem(key);}
  };
 }
 if(typeof module!=='undefined'&&module.exports)module.exports=createPublisherStorage;
 else root.createPublisherStorage=createPublisherStorage;
})(typeof globalThis!=='undefined'?globalThis:this);
