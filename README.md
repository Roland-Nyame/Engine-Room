# The Engine Room

A mobile-friendly prayer-team fund-management web app. React + TypeScript frontend, Supabase Auth/Postgres backend, and GitHub Pages deployment.

## Features included

- Email/password sign-in and member account requests
- Pending approval until an admin grants access
- Member dashboard showing calculated balance, contributions, expenses, and adjustments
- Individual contribution attribution and mobile-money reference field
- Admin transaction entry and member approval/suspension
- Transaction filtering and CSV export
- Admin-only audit history
- PostgreSQL Row Level Security policies and transaction audit trigger
- Responsive desktop/mobile layout

## Architecture note

This is a serverless architecture: the browser is the frontend and Supabase Auth/Postgres is the backend. There is no separate Express server. Do not put Supabase service-role credentials in the frontend. Use only the project URL and publishable/anon key in `VITE_...` environment variables.

## Requirements

- Node.js LTS (20 or newer recommended)
- Git
- GitHub account
- Supabase account

## Local setup

1. Create a new Supabase project.
2. Open Supabase SQL Editor and run `supabase/schema.sql`.
3. Create `.env.local` in the project root with:
   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
   ```
4. Install and run:
   ```bash
   npm install
   npm run dev
   ```
5. Open the local URL printed by Vite.

## Set up the first administrator

1. In Supabase Authentication settings, configure email confirmation as desired for your team.
2. Use the app to create the intended admin account.
3. Verify that account's email if email confirmation is enabled.
4. In Supabase SQL Editor, run the following after replacing the address:
   ```sql
   update public.profiles p
   set role = 'admin', is_approved = true
   from auth.users u
   where p.id = u.id
     and lower(u.email) = lower('ADMIN_EMAIL_HERE');
   ```
5. Do not give anyone else the admin role. The frontend does not provide a role-promotion button.
6. New users sign up and stay pending until the admin approves them in the Members screen.

## GitHub Pages deployment

1. Create a GitHub repository named exactly `engine-room-app` (or update the `base` in `vite.config.ts` to match your repository name).
2. Push the project to the `main` branch.
3. In GitHub repository Settings → Secrets and variables → Actions, create:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. In Settings → Pages, set the build/deployment source to **GitHub Actions**.
5. Push to `main`; the workflow in `.github/workflows/deploy.yml` builds and deploys the app.
6. The expected URL format is `https://YOUR_GITHUB_USERNAME.github.io/engine-room-app/`.

If you deploy under a different repository name, update `base` in `vite.config.ts`. If deploying to a custom domain or the root `username.github.io` repository, use `base: '/'`.

## Security and accounting notes

- Supabase RLS is the real security boundary. UI role checks are only for presentation.
- Profile roles are not self-editable. Promote the one admin through the Supabase SQL Editor.
- The app starts with no transactions, so the calculated balance is GH₵0.00.
- Amounts are stored as integer pesewas. Example: GH₵10.50 = `1050`.
- Contribution and expense amounts must be positive; adjustments may be positive or negative.
- Financial records have no delete policy. Use traceable corrections.
- Never store mobile money PINs, OTPs, or wallet passwords. The reference field is for a provider transaction ID only.
- Test permissions with at least one approved member and one unapproved account before recording real financial information.
- Review Supabase Auth settings, email delivery, backups, and recovery procedures before production use.

## Important production hardening before relying on this for real funds

- Consider disabling public sign-up and manually inviting approved members if that better fits your group.
- Ensure the only admin account has a strong unique password and MFA where available.
- Test RLS with member, pending-member, and admin accounts.
- Consider adding a database RPC for financial summaries and stronger correction workflows before larger-scale use.
- Keep a separate official mobile-money statement and reconcile it against app records regularly.
