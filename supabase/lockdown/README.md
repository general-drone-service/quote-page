# quote-drone168 lockdown (DRO-980 #55)

Migrations `005`–`007` close quote-drone168 to the public API roles. **Not applied yet:** applying them needs Teddy's approval.

| File | Part | What it does |
|---|---|---|
| `../migrations/005_close_api_roles.sql` | 1 | Enables RLS on `quotes`, `quote_drafts`, `pricing_params`, `knowledge_chunks`, `chat_history` and `bot_pause`, then revokes `anon` and `authenticated` from them. Also removes their EXECUTE on `match_knowledge`. |
| `../migrations/006_pricing_params_audit.sql` | 2 | Adds `pricing_params.updated_at`. Adds the `pricing_params_audit` table, written by triggers on insert, activate, deactivate, update and delete. The table is read-only for `service_role` and closed to `anon` and `authenticated`. |
| `../migrations/007_storage_policies.sql` | 3, 4 | Drops the `quote-pdfs` SELECT policy, which applied to every role. Drops the three anon write policies on `cleaning-photos`. |
| `check.sql` | all | Read-only check that needs no key. It reports every gap, or prints `lockdown check OK`. |
| `verify.sh` | all | HTTP check that prints status codes and counts only. It confirms anon is blocked, existing customer PDF links still open, and the apps still work. |
| `rollback.sql` | all | Restores the 2026-10-19 state, one independent section per part. |

## Apply order

1. Run `check.sql` in the SQL editor. It should fail and list every gap.
2. Run `bash supabase/lockdown/verify.sh`. The anon section should fail, which proves the hole exists today.
3. Apply `005`, then `006`, through the SQL editor or `supabase db push`.
4. Apply `007`. If it fails with `must be owner of relation objects`, make the four changes in **Dashboard → Storage → Policies** instead:
   - Under **quote-pdfs**, delete "Public read access for quote PDFs".
   - Under **cleaning-photos**, delete "cleaning photos: anon insert", "cleaning photos: anon update" and "cleaning photos: anon delete".
   - Keep "cleaning photos: public read".

   Why it may fail: `storage.objects` is owned by `supabase_storage_admin`, and `postgres` is not a member of that role. A local dry run hit the same error.
5. Run `check.sql` again. It should print `lockdown check OK`.
6. Run `AFTER=1 PDF_URL=<a pdf_url from quotes> bash supabase/lockdown/verify.sh`. It should print `ALL PASS`.

   `PDF_URL` gets a HEAD request only, so it returns just the status code. Take the URL from the `quotes.pdf_url` column in the SQL editor. Do not paste it into chat.
7. Do the manual checks below with test data.

## Manual checks (test data)

- **quote-page:** Generate one quote, which writes `quotes` and the PDF. Open the LINE link and confirm the PDF arrives. Save one draft, which writes `quote_drafts`.
- **quote-page `/admin/params`:** Activate the current version again; this needs `PRICING_ADMIN_TOKEN` from PR #11. Then run `select action, version, db_role from pricing_params_audit order by id desc limit 3` and expect `deactivate` and `activate` rows with `service_role`.
- **line-bot-external:** From a staff LINE account, ask a question the knowledge base answers. Expect the answer to use the knowledge base (`match_knowledge`), and two new `chat_history` rows.
- **drone168-workplan:** Open one work plan. It does not use these tables, so this is only a smoke test.

## Rollback

Run only the section of `rollback.sql` for the part that broke something. Part 2's rollback drops the audit log, so export it first if the rows matter. The storage section needs the same privilege as `007`; otherwise recreate the policies in the Dashboard with the same names and expressions.

Tested on a local Postgres that emulates the Supabase roles, default privileges and storage ownership:
- check fails before the migrations and passes after
- audit rows record `service_role`
- `anon` cannot read the audit table or write `pricing_params`
- `service_role` cannot write the audit table, `setval` its sequence, or attach the audit trigger function to its own table
- the function's guard refuses to run on any table other than `pricing_params`
- check fails when the audit trigger is disabled or `service_role` loses a needed privilege
- rollback restores the old state, and re-applying passes the check

`verify.sh` was also run against a fake `curl` in four scenarios: closed, still open, 503 outage and connection failure. Only "closed" passes; outages and connection failures fail as "cannot verify".
