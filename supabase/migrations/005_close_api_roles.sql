-- Migration: close the API roles out of the six tables that had RLS off (DRO-980 #55, part 1)
-- quote_drafts / quotes / pricing_params are quote-page's; knowledge_chunks / chat_history / bot_pause
-- belong to line-bot-external but live in this project. All three apps (quote-page, line-bot-external,
-- drone168-workplan) reach them only from the server with the service role, which has BYPASSRLS and
-- keeps its grants, so no policy is needed. RLS is not FORCEd, so the owner keeps access.
-- Catalog on 2026-10-19: RLS off on all six, anon/authenticated held every table privilege, no
-- policies, triggers, views or realtime publications on them; match_knowledge is SECURITY INVOKER
-- with EXECUTE for PUBLIC/anon/authenticated.

alter table public.quotes           enable row level security;
alter table public.quote_drafts     enable row level security;
alter table public.pricing_params   enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.chat_history     enable row level security;
alter table public.bot_pause        enable row level security;

revoke all on table
  public.quotes, public.quote_drafts, public.pricing_params,
  public.knowledge_chunks, public.chat_history, public.bot_pause
from anon, authenticated;

revoke execute on function public.match_knowledge(vector, integer, double precision) from public, anon, authenticated;
grant  execute on function public.match_knowledge(vector, integer, double precision) to service_role;
