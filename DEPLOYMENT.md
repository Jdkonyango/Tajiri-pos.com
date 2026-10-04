# Deployment

## Frontend and backend

The static frontend is built into `public/` and deployed to Cloudflare Pages. Firebase remains the backend for authentication and Firestore data; the frontend continues to initialize Firebase directly.

### Manual deployment

Install Wrangler and authenticate with Cloudflare:

```powershell
npm install -g wrangler
wrangler login
```

Create the Pages project and select the repository's default branch (`main` or `master`) when prompted:

```powershell
wrangler pages project create
```

Enter `tajiri-pos` as the project name and choose the repository's default branch.

Deploy the frontend. The build reads the GitHub repository from `GITHUB_REPOSITORY`, `TAJIRI_GITHUB_REPOSITORY`, or the local `origin` remote so release downloads point to the right repository:

```powershell
$env:TAJIRI_GITHUB_REPOSITORY = "OWNER/REPO"
npm run deploy:pages
```

### Automatic deployment

The GitHub Actions workflow deploys to the Cloudflare Pages project `tajiri-pos`. Set the production branch in Cloudflare to this GitHub repository's default branch, then add these GitHub Actions repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` with Cloudflare Pages edit permissions

The workflow publishes pull-request previews for branches in this repository and production deployments from `main` or `master`. Firebase Functions and Data Connect remain independent and are not deployed by the Pages workflow.

## Releases

Push a version tag such as `v1.0.0` to build the Windows installer and publish it with the Android demo and PDF documentation as GitHub Release assets. The download links on the site target the latest release, so the Windows installer filename must continue to match the configured `TajiriPOS-1.0.0-setup.exe` link unless the site configuration is updated too.