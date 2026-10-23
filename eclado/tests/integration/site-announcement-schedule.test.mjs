import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAnnouncementState, isAnnouncementVisible, announcementInputToTime, announcementTimeToInput, formatAnnouncementTime } from '../../src/domain/siteAnnouncement.js';

test('announcement schedule: inclusive start, exclusive end, switch and invalid timestamps',()=>{
  const start=Date.parse('2026-11-11T00:00:00+08:00'), end=Date.parse('2026-11-12T00:00:00+08:00');
  const scheduled={content:'雙11',enabled:true,start_at:new Date(start).toISOString(),end_at:new Date(end).toISOString()};
  assert.equal(getAnnouncementState(scheduled,start-1),'scheduled');
  assert.equal(isAnnouncementVisible(scheduled,start),true);
  assert.equal(isAnnouncementVisible(scheduled,end-1),true);
  assert.equal(getAnnouncementState(scheduled,end),'ended');
  assert.equal(isAnnouncementVisible({...scheduled,enabled:false},start),false);
  assert.equal(isAnnouncementVisible({...scheduled,start_at:null,end_at:null},0),true);
  assert.equal(isAnnouncementVisible({...scheduled,start_at:null},start),true);
  assert.equal(isAnnouncementVisible({...scheduled,end_at:null},end),true);
  for(const patch of [{start_at:'invalid'},{end_at:'invalid'},{end_at:scheduled.start_at},{content:' '}]) {
    assert.equal(isAnnouncementVisible({...scheduled,...patch},start),false);
  }
});

test('announcement Taipei midnight conversion is independent of device timezone',()=>{
  assert.equal(announcementInputToTime('2026-11-11T00:00'),'2026-11-10T16:00:00.000Z');
  assert.equal(announcementInputToTime('2026-11-11T23:59'),'2026-11-11T15:59:00.000Z');
  assert.equal(announcementTimeToInput('2026-11-10T16:00:00Z'),'2026-11-11T00:00');
  assert.equal(formatAnnouncementTime('2026-11-10T16:00:00Z'),'2026-11-11 00:00');
  assert.equal(announcementInputToTime(''),null);
  assert.throws(()=>announcementInputToTime('2026-02-30T00:00'));
});
