// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// Hardcoded credentials as requested
const supabaseUrl = 'https://mipvcafqrmwxnoqmicxh.supabase.co';
const supabaseKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pcHZjYWZxcm13eG5vcW1pY3hoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3NDk5OTQsImV4cCI6MjA4MTMyNTk5NH0.EWr6S_W0FZzbAv8TI1KwqE3pTedryaVBjIOv6tVkOBg';

export const supabase = createClient(supabaseUrl, supabaseKey);
