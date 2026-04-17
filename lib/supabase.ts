
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vbiyuufykfifbuynlicv.supabase.co';
const supabaseKey = 'sb_publishable_gbHBZ_uGIEKwd1FgATuA8g_IKqm1k76';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Helper for database operations with safe generic syntax
export const db = {
  get: async function<T>(table: string) {
    const { data, error } = await supabase.from(table).select('*');
    if (error) throw error;
    return data as T[];
  },
  insert: async function<T>(table: string, payload: any) {
    const { data, error } = await supabase.from(table).insert(payload).select().single();
    if (error) throw error;
    return data as T;
  },
  update: async function<T>(table: string, id: number, payload: any) {
    const { data, error } = await supabase.from(table).update(payload).eq('id', id).select().single();
    if (error) throw error;
    return data as T;
  },
  delete: async function(table: string, id: number) {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw error;
  }
};

export const createNotification = async (params: {
  user_id: number;
  type: 'mention' | 'assigned' | 'comment';
  actor_id: number;
  actor_name: string;
  message: string;
  preview?: string;
  entity_type?: 'team_task' | 'personal_task' | 'project';
  entity_id?: number;
  entity_name?: string;
}): Promise<void> => {
  try {
    await supabase.from('notifications').insert({
      user_id: params.user_id,
      type: params.type,
      actor_id: params.actor_id,
      actor_name: params.actor_name,
      message: params.message,
      preview: params.preview ?? null,
      entity_type: params.entity_type ?? null,
      entity_id: params.entity_id ?? null,
      entity_name: params.entity_name ?? null,
    });
  } catch (e) {
    console.error('createNotification failed:', e);
  }
};

export const parseMentionUsernames = (text: string): string[] => {
  const matches = text.match(/@(\w+)/g) || [];
  return [...new Set(matches.map(m => m.slice(1).toLowerCase()))];
};
