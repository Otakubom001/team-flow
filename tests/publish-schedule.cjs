const assert=require('node:assert/strict');
const S=require('../publish-schedule.js');
const now=Date.parse('2026-11-21T10:00:00Z');
for(const tz of ['UTC','America/New_York','Asia/Bangkok']){
 process.env.TZ=tz;
 assert.equal(S.parse('2026-11-21T19:00',now),'2026-11-21T12:00:00.000Z');
 assert.equal(S.parse('2026-11-22T00:15',now),'2026-11-21T17:15:00.000Z');
 assert.equal(S.localValue(now),'2026-11-21T17:00');
 assert.ok(S.format('2026-11-21T12:00:00Z').includes('19:00'));
}
for(const value of ['', '2026-02-30T19:00','2026-13-01T10:00','2026-11-21T24:01','2026-11-21T16:00','2026-11-21T17:04'])assert.throws(()=>S.parse(value,now));
assert.equal(S.parse('2026-11-21T17:05',now),'2026-11-21T10:05:00.000Z');
console.log('PASS: Thai time independent of device timezone, date rollover, invalid dates, past times and five-minute boundary');
