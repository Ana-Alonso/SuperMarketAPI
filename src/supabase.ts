import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

if (!supabaseUrl || supabaseUrl.includes('tu_proyecto_de_supabase')) {
    console.warn('⚠️ WARNING: SUPABASE_URL is not configured or uses default template. Database queries will fail.');
}

export const supabase = createClient(
    supabaseUrl || 'https://placeholder-url-for-dev.supabase.co',
    supabaseKey || 'placeholder-key'
);
