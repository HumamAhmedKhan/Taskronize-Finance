import { supabase } from './src/lib/supabase';

async function test() {
  const { data, error } = await supabase.from('project_activities').select('*').limit(1);
  console.log('project_activities:', data, error);
}

test();
