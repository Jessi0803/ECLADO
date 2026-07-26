import { supabase } from './supabase.js';

export async function findProfileByEmail(email) {
  return supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
}

export async function upsertConsumerProfile(profile) {
  return supabase.from('profiles').upsert({
    ...profile,
    role: 'consumer',
  });
}

export async function setProfileRole(userId, role) {
  return supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId);
}
