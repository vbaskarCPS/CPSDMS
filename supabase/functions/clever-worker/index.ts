// supabase/functions/clever-worker/index.ts — the bounce webhook's entry point (see handler.ts).
import { handle } from './handler.ts';

Deno.serve(handle);
