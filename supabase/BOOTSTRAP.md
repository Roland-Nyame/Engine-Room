# First administrator setup

The Supabase project currently has no Auth users. Do not enable public registration as a workaround.

1. In Supabase Dashboard, open Authentication → Users → Add user.
2. Create the first account using the intended super administrator email and a strong password.
3. Open SQL Editor and run this query, replacing the email:

```sql
update public.profiles p
set role = 'super_admin', is_approved = true, must_change_password = false
from auth.users u
where p.id = u.id and lower(u.email) = lower('YOUR_SUPER_ADMIN_EMAIL');
```

4. Verify exactly one row was updated.
5. In Authentication → URL Configuration, allow the deployed app URL for password recovery: https://roland-nyame.github.io/Engine-Room/.
6. Deploy the functions in supabase/functions/ using the Supabase CLI. They require the project server-side SUPABASE_SERVICE_ROLE_KEY. Never put this key in frontend environment variables or GitHub code.
7. Disable public sign-ups in Authentication settings. Member accounts should be created by an approved admin.

## Deploy Edge Functions

From a trusted local checkout linked to this Supabase project:

```bash
supabase functions deploy change-own-password
supabase functions deploy create-member
```

Do not commit secrets. The schema is applied to the live database and saved in schema.sql for review. Generate a proper migration with the Supabase CLI before recreating this setup elsewhere; do not blindly re-run the baseline on a database with existing data.
