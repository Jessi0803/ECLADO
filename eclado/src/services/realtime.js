import { supabase } from './supabase.js';

export function subscribeToTables(channelName, tables, callback) {
  let channel = supabase.channel(channelName);
  tables.forEach(table => {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      callback,
    );
  });
  return channel.subscribe();
}

export function removeRealtimeChannel(channel) {
  if (channel) supabase.removeChannel(channel);
}
