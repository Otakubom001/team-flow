(function(root){
    'use strict';
    function create({active,items,owns,check,onError}){
        let running=false;
        return async function tick(){
            if(running||!active())return;
            running=true;
            try{
                for(const item of items()){
                    for(const [platform,target] of Object.entries(item.targets)){
                        if(!active())return;
                        if(!owns(item)||!['queued','scheduled','sending','unknown'].includes(target.status))continue;
                        // Once Buffer confirms a future time, wait until it is due.
                        if(target.lastCheckedAt&&Date.parse(target.dueAt)>Date.now())continue;
                        try{await check(item,platform);}
                        catch(error){onError(error);return;}
                    }
                }
            }finally{running=false;}
        };
    }
    if(typeof module==='object'&&module.exports)module.exports={create};
    else root.PublishPoll={create};
})(typeof window==='object'?window:globalThis);
