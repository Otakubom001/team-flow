(function() {
    'use strict';
    const R=window.PublishRules, B=window.PublishBuffer, $=id=>document.getElementById(id);
    let sendSelection=null;
    const S=window.PublishSchedule;
    function updateComposeSchedule(){
        const custom=$('pub-compose-mode').value==='custom';
        $('pub-compose-at').disabled=!custom;$('pub-compose-at').required=custom;
        $('pub-compose-time-error').textContent='';
        if(!custom){$('pub-compose-time-summary').textContent='ใช้เวลาว่างถัดไปของแต่ละช่องใน Buffer';return;}
        try{$('pub-compose-time-summary').textContent='เวลาที่เลือก: '+S.format(S.parse($('pub-compose-at').value));}
        catch(error){$('pub-compose-time-summary').textContent='';$('pub-compose-time-error').textContent=error.message;}
    }
    $('pub-compose-mode').onchange=()=>{
        if(!$('pub-compose-at').value)$('pub-compose-at').value=S.localValue(Date.now()+30*60000);
        $('pub-compose-at').min=S.localValue(Date.now()+6*60000);updateComposeSchedule();
    };
    $('pub-compose-at').oninput=updateComposeSchedule;
    updateComposeSchedule();
    function updateSchedule(){
        const custom=$('pub-schedule-mode').value==='custom';
        $('pub-schedule-field').hidden=!custom;$('pub-schedule-at').required=custom;
        $('pub-send-submit').textContent=custom?'อัปโหลดและตั้งเวลาโพสต์':'อัปโหลดและส่งเข้าคิว';
        $('pub-schedule-error').textContent='';
        if(!custom){$('pub-schedule-preview').textContent='แต่ละช่องทางใช้เวลาว่างถัดไปตามคิวของตนเอง';return;}
        try{$('pub-schedule-preview').textContent='จะส่งให้ทุกช่องทางเผยแพร่: '+S.format(S.parse($('pub-schedule-at').value));}
        catch(e){$('pub-schedule-preview').textContent='';$('pub-schedule-error').textContent=e.message;}
    }
    $('pub-schedule-mode').onchange=updateSchedule;
    $('pub-schedule-at').oninput=updateSchedule;
    const deliveryLabels={sending:'กำลังส่ง / รอตรวจสอบผลใน Buffer',queued:'เข้าคิว Buffer แล้ว · ยังไม่ยืนยันว่าเผยแพร่',unknown:'ยังยืนยันผลไม่ได้ · ตรวจใน Buffer ก่อนลงเอง',rejected:'Buffer ไม่รับรายการ · ตรวจข้อกำหนดใน Buffer',sent:'เผยแพร่แล้ว · ยืนยันจาก Buffer',scheduled:'รอเผยแพร่ตามคิว Buffer',error:'เผยแพร่ไม่สำเร็จ · ตรวจใน Buffer',draft:'เป็นร่างใน Buffer',needs_approval:'รออนุมัติใน Buffer'};
    let current=null, previewUrl='', inspectVersion=0, busy=false, records=[], manual=null, dbPromise;
    const selected=new Set(['facebook','tiktok','youtube']);
    const text=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;};
    function message(value){$('pub-message').textContent=value;}
    const statusRequests=new Map();
    function checkStatus(item,platform){
        const key=item.id+':'+platform;
        if(statusRequests.has(key))return statusRequests.get(key);
        const request=(async()=>{
            const result=await B.status(item,platform);
            // A deleted/replaced record must never be resurrected by a late response.
            if(!records.includes(item))return;
            if(result.state==='not_sent')throw new Error('ไม่พบการส่งในบัญชีนี้ กรุณาตรวจบัญชีผู้โพสต์');
            const target=item.targets[platform];
            target.status=result.providerStatus||result.state;
            target.postId=result.post_id||target.postId;
            target.lastCheckedAt=new Date().toISOString();
            if(Object.hasOwn(result,'dueAt'))target.dueAt=result.dueAt;
            if(result.url&&R.validPostUrl(result.url,platform))target.url=result.url;
            await store('put',item);renderLibrary();
        })().finally(()=>statusRequests.delete(key));
        statusRequests.set(key,request);return request;
    }
    const pollStatus=window.PublishPoll.create({
        active:()=>!document.hidden&&!busy&&B.ready()&&$('page-publish').classList.contains('active'),
        items:()=>records.slice(),owns:item=>B.owns(item),check:checkStatus,
        onError:error=>message('ตรวจสถานะอัตโนมัติไม่สำเร็จ: '+error.message+' · จะลองใหม่ในรอบถัดไป')
    });
    setInterval(pollStatus,30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollStatus();});
    function database(){
        if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
            const request=indexedDB.open('teamflow-publishing',1);
            request.onupgradeneeded=()=>request.result.createObjectStore('posts',{keyPath:'id'});
            request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
            request.onerror=()=>reject(request.error);
            request.onblocked=()=>reject(new Error('Storage blocked'));
        }).catch(error=>{dbPromise=null;throw error;});
        return dbPromise;
    }
    async function store(action,value){
        const db=await database();
        return new Promise((resolve,reject)=>{
            const tx=db.transaction('posts',action==='getAll'?'readonly':'readwrite');
            const req=tx.objectStore('posts')[action](...(value===undefined?[]:[value]));
            tx.oncomplete=()=>resolve(req.result);
            tx.onabort=()=>reject(tx.error||new Error('Storage failed'));
            tx.onerror=()=>reject(tx.error||new Error('Storage failed'));
        });
    }
    function reset(){
        inspectVersion++;
        if(previewUrl)URL.revokeObjectURL(previewUrl);
        previewUrl='';current=null;
        $('pub-form').reset();updateComposeSchedule();$('pub-preview').replaceChildren();$('pub-preview').hidden=true;
        $('pub-file').value='';$('pub-file-info').textContent='';$('pub-file-error').textContent='';
        $('pub-drop').querySelector('strong').textContent='เลือกไฟล์ หรือลากมาวางที่นี่';
        selected.clear();['facebook','tiktok','youtube'].forEach(p=>selected.add(p));
        renderChecks();
    }
    function inspect(file,url){
        return new Promise((resolve,reject)=>{
            const kind=/\.(jpe?g|png)$/i.test(file.name)?'image':/\.(mp4|mov|webm|m4v)$/i.test(file.name)?'video':null;
            if(!kind||!file.size){reject(new Error('กรุณาเลือกคลิป MP4, MOV, WebM, M4V หรือภาพ JPG, PNG ที่มีข้อมูล'));return;}
            const media=document.createElement(kind==='video'?'video':'img');
            const cleanup=()=>{clearTimeout(timer);media.onload=null;media.onloadedmetadata=null;media.onerror=null;if(kind==='video'){media.removeAttribute('src');media.load();}};
            const fail=()=>{cleanup();reject(new Error('เบราว์เซอร์อ่านไฟล์นี้ไม่ได้ ลองส่งออกเป็น MP4 (H.264) หรือภาพ JPG/PNG แล้วเลือกใหม่'));};
            const timer=setTimeout(fail,20000);
            const done=()=>{
                const meta={name:file.name,size:file.size,type:file.type,kind,width:kind==='video'?media.videoWidth:media.naturalWidth,height:kind==='video'?media.videoHeight:media.naturalHeight,duration:kind==='video'?media.duration:0};
                if(!meta.width||!meta.height||(kind==='video'&&(!Number.isFinite(meta.duration)||meta.duration<=0))){fail();return;}
                cleanup();resolve(meta);
            };
            media.onerror=fail;
            if(kind==='video'){media.preload='metadata';media.onloadedmetadata=done;}else media.onload=done;
            media.src=url;
        });
    }
    async function choose(file){
        if(busy||!file)return;
        const version=++inspectVersion;
        current=null;renderChecks();
        if(previewUrl)URL.revokeObjectURL(previewUrl);
        const url=URL.createObjectURL(file);previewUrl=url;
        $('pub-preview').replaceChildren();$('pub-preview').hidden=true;
        $('pub-file-error').textContent='';$('pub-file-info').textContent='กำลังอ่านข้อมูลไฟล์…';
        try {
            const meta=await inspect(file,url);
            if(version!==inspectVersion)return;
            current={file,meta};
            if(meta.kind==='image'){selected.clear();selected.add('facebook');}
            const preview=document.createElement(meta.kind==='video'?'video':'img');
            if(meta.kind==='video'){preview.controls=true;preview.playsInline=true;preview.preload='metadata';}else preview.alt='ตัวอย่าง '+file.name;
            preview.src=url;$('pub-preview').append(preview);$('pub-preview').hidden=false;
            $('pub-title').value=file.name.replace(/\.[^.]+$/,'').slice(0,100);
            $('pub-file-info').textContent=file.name+' · '+(file.size/1e6).toFixed(1)+' MB · '+meta.width+' × '+meta.height+' px'+(meta.kind==='video'?' · '+R.duration(meta.duration)+' นาที':'');
            $('pub-drop').querySelector('strong').textContent='เปลี่ยนไฟล์ หรือลากไฟล์ใหม่มาวาง';
        }catch(error){
            if(version!==inspectVersion)return;
            $('pub-file-error').textContent=error.message;$('pub-file-info').textContent='';
            URL.revokeObjectURL(url);previewUrl='';
        }
        renderChecks();
    }
    function renderChecks(){
        const wrap=$('pub-platforms');wrap.replaceChildren();
        let manualCount=0;
        for(const [id,p]of Object.entries(R.platforms)){
            const result=R.checkUpload(current?.meta,id),box=document.createElement('div');
            box.className='pub-platform'+(selected.has(id)?'':' off');box.dataset.result=selected.has(id)?result.kind:'';
            const label=document.createElement('label'),checkbox=document.createElement('input');
            checkbox.type='checkbox';checkbox.checked=selected.has(id);checkbox.disabled=busy;
            checkbox.onchange=()=>{checkbox.checked?selected.add(id):selected.delete(id);renderChecks();};
            const icon=document.createElement('i');icon.className=p.icon+' pub-platform-icon';icon.setAttribute('aria-hidden','true');
            label.append(checkbox,icon,text('strong',p.name),text('span',p.label));box.append(label);
            if(selected.has(id)){
                if(result.kind==='manual')manualCount++;
                box.append(text('p',(result.kind==='manual'?'⛔ ส่งผ่านเว็บไม่ได้: ':result.kind==='preliminary'?'✓ ':'')+result.reasons.join(' • ')));
            }
            wrap.append(box);
        }
        $('pub-check-summary').classList.toggle('pub-blocked',manualCount>0);
        $('pub-save').disabled=busy||!current||!selected.size;
        $('pub-check-summary').textContent=!current?'เลือกไฟล์เพื่อดูผลตรวจแต่ละช่องทาง':!selected.size?'กรุณาเลือกอย่างน้อย 1 ช่องทาง':manualCount?'ต้องลงเอง '+manualCount+' จาก '+selected.size+' ช่องทาง'+(manualCount<selected.size?' • ช่องทางที่ผ่านยังส่งได้':' • กรุณาแก้ไฟล์หรือลงเอง'):'ผ่านเกณฑ์เบื้องต้น '+selected.size+' ช่องทาง • บันทึกรายการแล้วส่งเข้าคิว Buffer ได้หลังเข้าสู่ระบบ';
    }
    $('pub-drop').onclick=()=>$('pub-file').click();
    $('pub-file').onchange=()=>choose($('pub-file').files[0]);
    for(const name of ['dragenter','dragover'])$('pub-drop').addEventListener(name,e=>{e.preventDefault();$('pub-drop').classList.add('drag-over');});
    $('pub-drop').addEventListener('dragleave',()=>$('pub-drop').classList.remove('drag-over'));
    $('pub-drop').addEventListener('drop',e=>{
        e.preventDefault();$('pub-drop').classList.remove('drag-over');
        if(e.dataTransfer.files.length!==1){$('pub-file-error').textContent='กรุณาเลือกครั้งละ 1 ไฟล์ แต่ละตอนบันทึกเป็นคนละรายการ';return;}
        choose(e.dataTransfer.files[0]);
    });
    $('pub-reset').onclick=()=>{if(!busy&&(!current||confirm('เริ่มรายการใหม่? ไฟล์ที่ยังไม่ได้บันทึกจะถูกนำออกจากฟอร์ม'))){reset();}};
    $('pub-form').onsubmit=async e=>{
        e.preventDefault();if(busy||!current||!selected.size)return;
        const title=$('pub-title').value.trim();if(!title){$('pub-title').focus();return;}
        const scheduleMode=$('pub-compose-mode').value;
        let draftDueAt=null;
        if(scheduleMode==='custom'){
            try{draftDueAt=S.parse($('pub-compose-at').value);}catch(error){$('pub-compose-time-error').textContent=error.message;$('pub-compose-at').focus();return;}
        }
        busy=true;$('pub-form').inert=true;renderChecks();$('pub-save').textContent='กำลังบันทึกไฟล์ในเครื่อง…';
        const item={id:crypto.randomUUID(),title,caption:$('pub-caption').value,meta:current.meta,file:current.file,createdAt:new Date().toISOString(),scheduleMode,draftDueAt,targets:{}};
        for(const id of selected)item.targets[id]={status:R.checkUpload(item.meta,id).kind==='manual'?'manual':'connection',url:'',postedAt:null};
        try{
            await store('put',item);records.unshift(item);reset();renderLibrary();
            message('บันทึก “'+title+'” ในเบราว์เซอร์นี้แล้ว ยังไม่ได้เผยแพร่');
        }catch{
            $('pub-file-error').textContent='บันทึกไฟล์ไม่ได้ พื้นที่เบราว์เซอร์อาจไม่พอหรือถูกปิดใช้งาน ไฟล์ยังอยู่ในฟอร์ม กรุณาเก็บไฟล์ต้นฉบับไว้';
        }finally{busy=false;$('pub-form').inert=false;$('pub-save').innerHTML='<i class="fas fa-save"></i> บันทึกรายการเตรียมโพสต์';renderChecks();renderLibrary();}
    };
    function renderLibrary(){
        const list=$('pub-library');list.replaceChildren();$('pub-count').textContent=records.length;
        const filter=$('pub-filter').value;
        const visible=records.filter(item=>filter==='all'||(Object.values(item.targets).every(t=>t.status==='posted'||t.status==='sent')?filter==='posted':filter==='pending'));
        if(!visible.length){const empty=text('div',records.length?'ไม่มีรายการในหมวดนี้':'ยังไม่มีรายการ — เลือกไฟล์ด้านบนเพื่อเตรียมโพสต์แรก','pub-empty');list.append(empty);return;}
        for(const item of visible){
            const card=document.createElement('article');card.className='pub-record';
            const top=document.createElement('div');top.className='pub-record-top';
            const icon=document.createElement('i');icon.className=item.meta.kind==='video'?'fas fa-film':'fas fa-image';
            const info=document.createElement('div');info.append(text('h3',item.title),text('small',item.meta.name+' · '+(item.meta.kind==='video'?R.duration(item.meta.duration)+' นาที · ':'')+new Date(item.createdAt).toLocaleDateString('th-TH')));
            const remove=text('button','ลบ','btn btn-sm');remove.type='button';remove.disabled=busy;remove.setAttribute('aria-label','ลบรายการ '+item.title);
            remove.onclick=async()=>{
                if(!confirm('ลบรายการและสำเนาไฟล์ในเบราว์เซอร์นี้? โพสต์ที่ลงบนแพลตฟอร์มแล้วจะไม่ถูกลบ'))return;
                remove.disabled=true;
                try{await store('delete',item.id);records=records.filter(x=>x.id!==item.id);renderLibrary();message('ลบรายการในเครื่องแล้ว');}catch{message('ลบรายการไม่สำเร็จ กรุณาลองใหม่');remove.disabled=false;}
            };
            const targets=Object.values(item.targets),done=targets.filter(t=>['sent','posted'].includes(t.status)).length;
            info.append(text('span',done===targets.length?'✓ เผยแพร่ครบทุกช่องทาง':done?'✓ เผยแพร่แล้ว '+done+'/'+targets.length+' ช่องทาง':'ยังเผยแพร่ไม่ครบ',done===targets.length?'pub-status pub-status-success':'pub-status pub-status-pending'));
            if(item.draftDueAt&&Number.isFinite(Date.parse(item.draftDueAt)))info.append(text('p','เวลาที่เตรียมไว้: '+S.format(item.draftDueAt),'pub-help'));
            top.append(icon,info,remove);card.append(top);
            const eligible=Object.keys(item.targets).filter(id=>['connection','manual'].includes(item.targets[id].status)&&R.checkUpload(item.meta,id).kind==='preliminary');
            if(eligible.length){
                const send=text('button','ส่งเข้า Buffer ('+eligible.length+' ช่องทาง)','btn btn-primary');send.type='button';send.disabled=busy;
                send.onclick=()=>{
                    if(!B?.ready()){$('pub-connection-dialog').showModal();return;}
                    if(item.meta.size>52428800){message('ไฟล์เกิน 50 MB สำหรับอัปโหลด กรุณาลดขนาดไฟล์หรือลงเอง');return;}
                    if(eligible.some(id=>!B.channel(id))){message('บางช่องทางยังไม่ได้ตั้งค่า กรุณาตรวจบัญชีผู้โพสต์');return;}
                    sendSelection={item,platforms:eligible};$('pub-send-form').reset();
                    $('pub-custom-option').disabled=!B.canSchedule();
                    $('pub-schedule-availability').textContent=B.canSchedule()?'ตั้งล่วงหน้าอย่างน้อย 5 นาที และเผื่อเวลาอัปโหลดไฟล์':'การกำหนดเวลาเองรออัปเดตฟังก์ชัน Supabase • ยังส่งเข้าคิวเดิมได้';
                    $('pub-schedule-at').min=S.localValue(Date.now()+6*60000);
                    $('pub-schedule-at').value=item.draftDueAt?S.localValue(Date.parse(item.draftDueAt)):S.localValue(Date.now()+30*60000);
                    $('pub-schedule-mode').value=item.scheduleMode==='custom'?'custom':'queue';
                    updateSchedule();
                    const video=item.meta.kind==='video';
                    $('pub-ai').closest('label').hidden=!video;
                    $('pub-ai').required=video;
                    $('pub-kids').closest('label').hidden=!eligible.includes('youtube');
                    $('pub-kids').required=eligible.includes('youtube');
                    $('pub-send-targets').textContent=item.title+' → '+eligible.map(id=>R.platforms[id].name+': '+B.channel(id).name).join(' · ');
                    $('pub-send-dialog').showModal();
                };card.append(send);
            }
            for(const [id,target]of Object.entries(item.targets)){
                const row=document.createElement('div');row.className='pub-record-target';const detail=document.createElement('div');
                const checked=R.checkUpload(item.meta,id);
                detail.append(text('strong',R.platforms[id].name));
                if(target.sendError)detail.append(text('p',target.sendError,'pub-error'));
                const done=['sent','posted'].includes(target.status);
                const blocked=['manual','rejected','error'].includes(target.status)||(['connection'].includes(target.status)&&checked.kind==='manual');
                const pending=['queued','scheduled','sending','needs_approval'].includes(target.status);
                const statusLabel=target.status==='sent'?'✓ เผยแพร่แล้ว · ยืนยันจาก Buffer':target.status==='posted'?'✓ ลงเองแล้ว · ยืนยันโดยผู้ใช้':blocked?'⛔ '+(deliveryLabels[target.status]||'ส่งผ่านเว็บไม่ได้ · '+checked.reasons.join(' • ')):pending?'◷ '+deliveryLabels[target.status]:deliveryLabels[target.status]||'เตรียมโพสต์ · ยังไม่ได้ส่ง';
                detail.append(text('p',statusLabel,'pub-status '+(done?'pub-status-success':blocked?'pub-status-error':'pub-status-pending')));
                if(target.dueAt&&Number.isFinite(Date.parse(target.dueAt)))detail.append(text('p','เวลาใน Buffer: '+S.format(target.dueAt)));
                else if(target.requestedDueAt&&Number.isFinite(Date.parse(target.requestedDueAt)))detail.append(text('p','เวลาที่ขอ: '+S.format(target.requestedDueAt)+' · กดตรวจสถานะเพื่อยืนยัน'));
                if(target.url && R.validPostUrl(target.url,id)){const a=text('a','เปิดโพสต์ ↗');a.href=target.url;a.target='_blank';a.rel='noopener noreferrer';detail.append(a);}
                const action=text('button',target.status==='posted'?'ดูรายละเอียด':'ลงเอง','btn btn-sm');action.type='button';action.onclick=()=>openManual(item,id);
                action.disabled=busy;
                if(deliveryLabels[target.status]){
                    action.textContent='ตรวจสถานะ';action.onclick=async()=>{
                        action.disabled=true;
                        try{await checkStatus(item,id);}catch(e){message(e.message);}finally{action.disabled=false;}
                    };
                    const link=text('a','เปิด Buffer');link.href='https://publish.buffer.com/';link.target='_blank';link.rel='noopener noreferrer';detail.append(link);
                }
                row.append(detail,action);card.append(row);
            }
            list.append(card);
        }
    }
    $('pub-send-form').onsubmit=async e=>{
        e.preventDefault();if(busy||!sendSelection)return;
        const {item,platforms}=sendSelection;
        const options={aiGenerated:$('pub-ai').value==='yes',madeForKids:$('pub-kids').value==='yes'};
        options.scheduleMode=$('pub-schedule-mode').value;
        if(options.scheduleMode==='custom'){
            try{if(!B.canSchedule())throw new Error('ต้องอัปเดตฟังก์ชัน Supabase ก่อนใช้การกำหนดเวลา');options.dueAt=S.parse($('pub-schedule-at').value);}
            catch(error){$('pub-schedule-error').textContent=error.message;return;}
        }
        busy=true;$('pub-send-dialog').close();$('pub-form').inert=true;renderChecks();renderLibrary();
        try{
            message('กำลังอัปโหลดไฟล์…');
            // Bind the record to the sending account before network writes.
            await B.upload(item);await store('put',item);
            for(const id of platforms){
                message('กำลังส่ง '+R.platforms[id].name+'…');
                item.targets[id]={...item.targets[id],status:'sending',requestedDueAt:options.dueAt||null};
                await store('put',item);renderLibrary();
                try{
                    const result=await B.send(item,id,options);
                    item.targets[id]={...item.targets[id],status:result.state,postId:result.post_id,sendError:null};
                }catch(e){
                    item.targets[id].status=['INVALID_SCHEDULE','SCHEDULE_UNAVAILABLE'].includes(e.code)?'connection':'unknown';
                    item.targets[id].sendError=e.message;message(e.message);
                }
                await store('put',item);renderLibrary();
            }
            message('ส่งคำขอครบแล้ว ดูผลแยกแต่ละช่องด้านล่าง • เข้าคิวยังไม่เท่ากับเผยแพร่แล้ว');
        }catch(e){message(e.message);}finally{busy=false;$('pub-form').inert=false;renderChecks();renderLibrary();}
    };
    window.addEventListener('publisherchange',()=>{renderChecks();renderLibrary();});
    function openManual(item,platform){
        manual={item,platform};$('pub-manual-title').textContent='ลงเอง · '+R.platforms[platform].name;
        $('pub-manual-name').textContent=item.title;
        $('pub-post-url').value=item.targets[platform].url;$('pub-confirmed').checked=item.targets[platform].status==='posted';
        $('pub-manual-error').textContent='';$('pub-open-platform').href=R.platforms[platform].url;
        $('pub-manual').showModal();
    }
    $('pub-download').onclick=()=>{
        if(!manual)return;
        const url=URL.createObjectURL(manual.item.file),link=document.createElement('a');link.href=url;link.download=manual.item.meta.name;
        document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    };
    $('pub-copy').onclick=async()=>{
        if(!manual)return;
        try{await navigator.clipboard.writeText(manual.item.caption||manual.item.title);$('pub-manual-error').textContent='คัดลอกแล้ว';}
        catch{$('pub-manual-error').textContent='คัดลอกอัตโนมัติไม่ได้ เลือกข้อความด้านล่างเพื่อคัดลอก';const area=document.createElement('textarea');area.value=manual.item.caption||manual.item.title;$('pub-manual-error').append(area);area.select();}
    };
    $('pub-confirm-form').onsubmit=async e=>{
        e.preventDefault();if(!manual||!$('pub-confirmed').checked)return;
        const url=$('pub-post-url').value.trim();
        if(!R.validPostUrl(url,manual.platform)){$('pub-manual-error').textContent='กรุณาใช้ลิงก์ HTTPS ของ '+R.platforms[manual.platform].name+' หรือเว้นว่าง';return;}
        const {item,platform}=manual, updated={...item,targets:{...item.targets,[platform]:{status:'posted',url,postedAt:item.targets[platform].postedAt||new Date().toISOString()}}};
        $('pub-confirm-form').inert=true;
        try{await store('put',updated);records=records.map(x=>x.id===item.id?updated:x);$('pub-manual').close();renderLibrary();message('บันทึกการยืนยันว่าลง '+R.platforms[platform].name+' เองแล้ว');}
        catch{$('pub-manual-error').textContent='บันทึกการยืนยันไม่สำเร็จ กรุณาลองใหม่';}
        finally{$('pub-confirm-form').inert=false;}
    };
    $('pub-manual').addEventListener('close',()=>{manual=null;});
    $('pub-filter').onchange=renderLibrary;
    $('pub-connections').onclick=()=>$('pub-connection-dialog').showModal();
    window.addEventListener('beforeunload',e=>{if(current||busy){e.preventDefault();e.returnValue='';}});
    renderChecks();
    if(location.hash==='#publish' && typeof navigateTo==='function') navigateTo('publish');
    store('getAll').then(items=>{records=items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));renderLibrary();}).catch(()=>{
        $('pub-library').append(text('div','เปิดพื้นที่เก็บข้อมูลไม่ได้ กรุณาอนุญาตข้อมูลเว็บไซต์หรือใช้เบราว์เซอร์ปกติ','pub-empty'));
        message('ยังตรวจไฟล์ได้ แต่การเก็บรายการต้องใช้พื้นที่จัดเก็บของเบราว์เซอร์');
    });
})();
