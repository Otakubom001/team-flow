/* Preliminary Buffer checks, verified 2026-11-15. No account/codec approval implied. */
(function(root) {
    'use strict';
    const platforms = {
        facebook: {name:'Facebook', label:'เพจ / Reels', icon:'fab fa-facebook-f', url:'https://business.facebook.com/latest/content_calendar'},
        tiktok: {name:'TikTok', label:'คลิปแยกตอน', icon:'fab fa-tiktok', url:'https://www.tiktok.com/tiktokstudio/upload'},
        youtube: {name:'YouTube', label:'Shorts / ลงคลิปรวมเอง', icon:'fab fa-youtube', url:'https://studio.youtube.com/'}
    };
    function check(meta, platform) {
        const reasons=[];
        if (!meta || !platforms[platform]) return {kind:'unknown', reasons:['ยังไม่ได้เลือกไฟล์']};
        if (!(meta.width>0 && meta.height>0 && meta.size>0)) return {kind:'unknown',reasons:['อ่านข้อมูลไฟล์ไม่สำเร็จ กรุณาเลือกไฟล์ใหม่']};
        const ext=meta.name.split('.').pop().toLowerCase();
        if (meta.kind==='image') {
            if (platform!=='facebook') reasons.push('หน้านี้รองรับภาพสำหรับ Facebook เท่านั้น กรุณาลงเองหากต้องการใช้ภาพบนช่องทางนี้');
            if (!['jpg','jpeg','png'].includes(ext)) reasons.push('รูปแบบภาพไม่รองรับ กรุณาใช้ JPG หรือ PNG');
            // Size-specific image constraints will be checked by the connected provider.
            return {kind:reasons.length?'manual':'preliminary', reasons:reasons.length?reasons:['ภาพสำหรับ Facebook — รอตรวจขนาดและข้อจำกัดบัญชีเมื่อเชื่อมต่อ']};
        }
        if (!(Number.isFinite(meta.duration) && meta.duration>0)) return {kind:'unknown',reasons:['อ่านความยาววิดีโอไม่ได้ ยังตรวจไม่ได้']};
        if (meta.duration>360) reasons.push('คลิปเกิน 6 นาที ตั้งไว้ให้ลงเองตามรูปแบบการทำงานของทีม');
        const formats={facebook:['mp4','mov','avi','m4v'],tiktok:['mov','mp4','webm','mv4'],youtube:['mov','mp4','mpg','mpeg','avi','webm','m4v']};
        if (!formats[platform].includes(ext)) reasons.push('รูปแบบไฟล์นี้ไม่อยู่ในรายการที่ Buffer รองรับสำหรับช่องทางนี้');
        const maxSize=platform==='youtube'?10e9:1e9;
        if(meta.size>maxSize) reasons.push('ไฟล์เกิน '+(platform==='youtube'?'10':'1')+' GB กรุณาลงเองหรือใช้ไฟล์ที่เล็กลง');
        if(platform==='facebook') {
            if(meta.duration>90) reasons.push('เกิน 90 วินาทีสำหรับ Facebook Reels ผ่าน Buffer กรุณาลงเอง');
            if(meta.duration<3) reasons.push('คลิปสั้นกว่า 3 วินาที');
            if(Math.abs(meta.width/meta.height-9/16)>.005) reasons.push('หน้านี้เตรียม Facebook Reels แบบ 9:16 รูปแบบอื่นให้ลงเอง');
            if(meta.width<540 || meta.height<960) reasons.push('ความละเอียดต่ำกว่า 540 × 960 px');
        }
        if(platform==='youtube') {
            if(meta.duration>180) reasons.push('เกิน 3 นาทีสำหรับ Shorts กรุณาลงเองเป็นวิดีโอปกติใน YouTube Studio');
            if(meta.width>meta.height) reasons.push('Shorts ต้องเป็นแนวตั้งหรือจัตุรัส กรุณาลงเองเป็นวิดีโอปกติ');
        }
        if(platform==='tiktok') {
            if(meta.duration>600) reasons.push('เกิน 10 นาทีตามเกณฑ์ Buffer กรุณาลงเอง');
            if(meta.duration<3) reasons.push('คลิปสั้นกว่า 3 วินาที');
            if(meta.width<360 || meta.height<360) reasons.push('ความกว้างและความสูงต้องไม่น้อยกว่า 360 px');
        }
        return {kind:reasons.length?'manual':'preliminary',reasons:reasons.length?reasons:['ผ่านเกณฑ์ไฟล์เบื้องต้น — รอเชื่อมบัญชีและตรวจเงื่อนไขเพิ่มเติม']};
    }
    function duration(seconds) {
        const rounded=Math.ceil(seconds);
        return Math.floor(rounded/60)+':'+String(rounded%60).padStart(2,'0');
    }
    function validPostUrl(value,platform) {
        if(!value.trim())return true;
        try {
            const url=new URL(value);
            const domains={facebook:['facebook.com','fb.watch'],tiktok:['tiktok.com'],youtube:['youtube.com','youtu.be']};
            return url.protocol==='https:' && !url.username && !url.password && domains[platform].some(d=>url.hostname===d||url.hostname.endsWith('.'+d));
        } catch {return false;}
    }
    function checkUpload(meta,platform){
        const result=check(meta,platform);
        if(meta?.size>52428800){
            return {kind:'manual',reasons:['ไฟล์เกิน 50 MB ที่เว็บอัปโหลดได้ กรุณาลดขนาดไฟล์หรือลงเอง',...(result.kind==='manual'?result.reasons:[])]};
        }
        return result;
    }
    const api={platforms,check,checkUpload,duration,validPostUrl};
    if(typeof module!=='undefined'&&module.exports)module.exports=api;
    else root.PublishRules=api;
})(typeof globalThis!=='undefined'?globalThis:this);
