-- Migration: storage policies (DRO-980 #55, parts 3 and 4)
-- 3. quote-pdfs: drop the SELECT policy that applies to every role. A public bucket serves
--    /storage/v1/object/public/... without any policy, so the links customers already hold keep working;
--    what stops is listing the bucket through the API. quote-page reads and writes with the service role.
-- 4. cleaning-photos: the anon insert/update/delete policies let anyone write or delete photos.
--    No code on any default branch uses the bucket (gh code search + local grep over quote-page, CRM,
--    line-bot-external, drone168-workplan); it holds 10 objects, the newest from 2026-05-13 (one test record).
--    The public read policy is left as is (out of scope; it also allows listing).
-- storage.objects is owned by supabase_storage_admin and postgres is not a member of that role, so this
-- file may fail with "must be owner of table objects". In that case make the same four changes in
-- Dashboard → Storage → Policies (see supabase/lockdown/README.md).

drop policy if exists "Public read access for quote PDFs" on storage.objects;

drop policy if exists "cleaning photos: anon insert" on storage.objects;
drop policy if exists "cleaning photos: anon update" on storage.objects;
drop policy if exists "cleaning photos: anon delete" on storage.objects;
