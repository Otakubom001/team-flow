-- First create the user in Authentication > Users > Add user.
-- Replace the example email locally. Do not commit private account details.
do $$
declare publisher_id uuid;
begin
  select id into publisher_id from auth.users where lower(email) = lower('owner@example.com');
  if publisher_id is null then
    raise exception 'Create this user in Authentication > Users first';
  end if;
  insert into public.publishers(user_id) values(publisher_id) on conflict do nothing;
end $$;
