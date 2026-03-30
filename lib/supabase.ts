
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
