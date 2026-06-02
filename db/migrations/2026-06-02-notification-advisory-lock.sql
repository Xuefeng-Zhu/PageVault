-- db/migrations/2026-06-02-notification-advisory-lock.sql
-- Wrappers for pg_try_advisory_lock / pg_advisory_unlock in the public schema
-- so PostgREST's /api/database/rpc/<name> endpoint can reach them.
-- Built-in pg_catalog functions are not exposed by PostgREST by default;
-- without this wrapper, /api/database/rpc/pg_try_advisory_lock returns
-- 404 PGRST202 ("function not in schema cache").

create or replace function public.acquire_notification_lock(arg integer)
  returns boolean language sql security definer
  set search_path = pg_catalog, public as $$
  select pg_try_advisory_lock(arg);
$$;

create or replace function public.release_notification_lock(arg integer)
  returns void language sql security definer
  set search_path = pg_catalog, public as $$
  select pg_advisory_unlock(arg);
$$;

-- The cron worker uses the service-role key, so RLS/grant is a no-op for
-- the current caller, but be explicit for any future caller using the anon key.
revoke all on function public.acquire_notification_lock(integer) from public;
grant execute on function public.acquire_notification_lock(integer) to anon, authenticated, service_role;

revoke all on function public.release_notification_lock(integer) from public;
grant execute on function public.release_notification_lock(integer) to anon, authenticated, service_role;
