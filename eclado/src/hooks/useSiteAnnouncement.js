import useAnnouncementClock from './useAnnouncementClock.js';
import { useEffect, useState } from 'react';
import { EMPTY_ANNOUNCEMENT, fetchSiteAnnouncement } from '../services/siteAnnouncement.js';
import { subscribeToTables, removeRealtimeChannel } from '../services/realtime.js';

export default function useSiteAnnouncement() {
  const [announcement, setAnnouncement] = useState(EMPTY_ANNOUNCEMENT);
  useEffect(() => {
    let disposed = false;
    let request = 0;
    async function load() {
      const currentRequest = ++request;
      const { data, error } = await fetchSiteAnnouncement();
      if (!disposed && currentRequest === request) setAnnouncement(error ? EMPTY_ANNOUNCEMENT : data || EMPTY_ANNOUNCEMENT);
    }
    load();
    let channel;
    try { channel = subscribeToTables('site-announcement', ['site_announcement'], load); } catch { /* Focus refresh remains available. */ }
    const refreshVisible = () => { if (!document.hidden) load(); };
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      disposed = true;
      removeRealtimeChannel(channel);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, []);
  useAnnouncementClock(announcement);
  return announcement;
}
