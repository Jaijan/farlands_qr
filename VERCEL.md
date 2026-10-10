# Deploy Farlands to Vercel

Use the existing GitHub repository: https://github.com/Jaijan/farlands_qr.
No special Vercel routing config is required: Vercel detects Next.js App Router automatically.

## 1. Create the Supabase backend

1. Visit https://supabase.com/dashboard and create an account/project.
2. Choose your organization, project name `farlands`, a strong database password, and a region close to the event. Save the database password privately.
3. Wait for provisioning. Enable **Cron / pg_cron** in the dashboard.
4. Open the SQL Editor. Run these files in order, one at a time:
   - `supabase/migrations/202610060001_core.sql`
   - `supabase/migrations/202610060002_schedule.sql`
   - `supabase/migrations/202610060003_email_verification.sql`
   - `supabase/migrations/202610100001_qr_inventory.sql`
   - `supabase/migrations/202610100002_email_qr_claim.sql`
5. In the project's Connect/API settings, find its project URL and client key. For the existing variable names, use the anon key and server-only service-role key under legacy API keys. Do not use the database password as an API key.
6. Enable Email Auth/signup and configure custom SMTP in Supabase. Include `{{ .Token }}` in both Confirm signup and Magic Link templates. Follow [README email OTP configuration](README.md#5-otp-provider-configuration). Existing staff email/password login stays the same.

## 2. Generate and retain the QR encryption key

With Node.js available:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

For the portable runtime already installed in this Windows workspace:

```powershell
& '.\.tools\node-v24.21.0-win-x64\node.exe' -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Save the 64-character output in your password manager. Use the **same** value locally and in Vercel. Do not commit it or paste it into chat.

## 3. Import the repository into Vercel

1. Visit https://vercel.com/new, sign in with GitHub, and allow access to `Jaijan/farlands_qr`.
2. Import `farlands_qr`.
3. Framework: **Next.js**. Root directory: **./**. Keep the detected install/build/output defaults (`npm install` or `npm ci`, `npm run build`, default Next.js output).
4. Use **Node.js 24.x** under Build and Deployment settings. The repository requires Node 24 or newer; 24.x is the tested version.
5. Expand Environment Variables and enter:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon client key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase server-only service-role key |
| `QR_ENCRYPTION_KEY` | The 64-character key you generated |
| `OTP_PROVIDER` | `supabase` |

Use Production for these variables. Use a separate staging Supabase project if enabling functional Preview deployments. Keep privileged keys out of the two `NEXT_PUBLIC_*` variables.

6. Click **Deploy**. After it finishes, copy the project's stable production URL from Domains (not a single deployment's unique URL).

## 4. Set the production origin

1. In Vercel → Project Settings → Environment Variables, add `APP_ORIGIN` with the exact production origin, e.g. `https://your-actual-project.vercel.app`. No trailing slash, path, or placeholder.
2. In Supabase → Authentication → URL Configuration, set Site URL to the same HTTPS origin.
3. Redeploy from Vercel's Deployments tab so the new variable takes effect. Changes to `NEXT_PUBLIC_*` also require a fresh build.
4. If Vercel Deployment Protection is enabled for production, configure public access so participants can open `/register` without a Vercel account. Application admin/volunteer pages still enforce their own authentication.

When adding a custom domain later, update `APP_ORIGIN` and the Supabase Site URL, and redeploy. Use only the canonical origin for event operations; other aliases will fail POST origin checks.

## 5. Create your administrator locally

Copy `.env.example` to `.env.local`. Fill the Supabase variables and QR key with the same values used in Vercel. Add:

```dotenv
BOOTSTRAP_ADMIN_EMAIL=your-real-email@example.com
BOOTSTRAP_ADMIN_PASSWORD=your-own-strong-password-at-least-12-characters
BOOTSTRAP_ADMIN_NAME=Event administrator
```

These example values must be replaced. Run from the repository:

```powershell
$env:PATH = (Join-Path $PWD '.tools\node-v24.21.0-win-x64') + ';' + $env:PATH
npm.cmd run bootstrap
```

Or `npm run bootstrap` with a normally installed Node 24 runtime. The script creates the account in your hosted Supabase project. Remove the bootstrap password from `.env.local` afterward. Do not put bootstrap passwords in Vercel or GitHub.

## 6. Prepare the event

1. Open `https://YOUR-DOMAIN/admin/login` and sign in.
2. Create Exit 1 and Exit 2 accounts under Gate volunteers.
3. Verify the Cron jobs are running in Supabase; no Vercel Cron configuration is needed.
4. Finish the live acceptance checklist in `TESTING.md`, including real email OTP delivery, two gate browsers, camera access, return recording, and notifications.
5. Generate and download 300 ID card QRs in Event settings. Print cards, then open registration. `/registration-screen` tells participants to scan their own cards.

Registration is closed by default. A successful Vercel build alone does not configure Supabase, SMTP, or an admin account.

## Deployment help

- **Import cannot find the repository:** grant the Vercel GitHub integration access to that repository.
- **Build fails:** copy the first actual error from the Vercel build log, excluding secrets. The application has passed a local production build.
- **System setup required:** verify the four Supabase/QR environment variables are set for Production, then redeploy.
- **Invalid request origin:** set `APP_ORIGIN` to the exact domain visible in your browser and redeploy.
- **Admin sign-in fails:** apply migrations and run the bootstrap script against the same Supabase project used by Vercel.
- **Registration stays closed:** sign in as admin and open it in Event settings.
- **Email code cannot send:** verify Email Auth, custom SMTP credentials, token email templates and provider limits.

References: [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [configuration and email limits](README.md#5-otp-provider-configuration).
