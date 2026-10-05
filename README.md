# Jotter

[![CI](https://github.com/izzyzizou/jotter/actions/workflows/ci.yml/badge.svg)](https://github.com/izzyzizou/jotter/actions/workflows/ci.yml)

A one-page notepad for getting ideas down fast. The whole screen is the note, it saves as you type, and the only button is **Sign in** in the top right.

- **Signed out**, the note is saved in the browser and survives refreshes.
- **Signed in** (Google by default, or Microsoft, Apple, GitHub, or your company's SAML/OIDC single sign-on), the note syncs to your account through Firebase, so it follows you between devices. Anything written while signed out is added to the account's note when you sign in.

Built with React, Tailwind CSS and Vite. Firebase handles sign-in (Authentication) and storage (Cloud Firestore).

## Run it locally

You need Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

Open the address Vite prints (usually http://localhost:5173). Without Firebase settings the app runs in browser-only mode, and Sign in explains what's missing.

## Turn on sign-in and cloud saving

1. **Create a Firebase project** at https://console.firebase.google.com, then add a **Web app** to it (Project settings › General › Your apps). Copy the config values it shows.
2. **Turn on a sign-in method**: Authentication › Get started › Sign-in method › Google › Enable.
3. **Create the database**: Firestore Database › Create database. Production mode is fine; the rules below open exactly what the app needs.
4. **Add your settings**: copy `.env.example` to `.env.local` and fill in the four `VITE_FIREBASE_…` values.
5. **Publish the security rules** with the Firebase CLI:

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add          # pick your project
   firebase deploy --only firestore:rules
   ```

6. Restart `npm run dev` and press **Sign in**.

The rules in `firestore.rules` let each person read and write only their own note, at `users/{uid}/notes/jotter`, and nothing else.

## Put it online

The simplest home is Firebase Hosting, already set up in `firebase.json`:

```bash
npm run build
firebase deploy --only hosting
```

The app is then live at `https://YOUR-PROJECT-ID.web.app`. On Vercel, import the repo and add the same `VITE_…` variables under Project Settings › Environment Variables (`vercel.json` already sets the build). Any static host works too (Netlify, Cloudflare Pages, your own server): upload the `dist` folder, set the same `VITE_…` variables in the host's build settings, and add the site's domain in Firebase under Authentication › Settings › Authorized domains. `localhost` and your Firebase Hosting domains are allowed already.

Sign-in opens in a popup. If a browser blocks the popup, the app falls back to a full-page redirect. Redirects are most reliable when the app is served from Firebase Hosting with `VITE_FIREBASE_AUTH_DOMAIN` set to the app's own domain; Firebase explains the options in [Best practices for using signInWithRedirect](https://firebase.google.com/docs/auth/web/redirect-best-practices).

## Choose how people sign in

Set `VITE_AUTH_PROVIDER` in `.env.local`, and turn the same method on in Firebase under Authentication › Sign-in method. The button stays a single **Sign in**.

| Value | Signs in with | Setup in Firebase |
| --- | --- | --- |
| `google` (default) | Google and Google Workspace accounts | Enable Google |
| `microsoft` | Microsoft personal and work accounts | Enable Microsoft with an app registration from Microsoft Entra ID. Set `VITE_AUTH_TENANT` to your directory ID to allow only your organization. |
| `apple` | Apple ID | Enable Apple with your Apple Developer service ID and key |
| `github` | GitHub | Enable GitHub with a GitHub OAuth app |
| `saml.…` / `oidc.…` | Your company's identity provider (Okta, Entra ID, Ping, Auth0, …) | Upgrade the project to Firebase Authentication with Identity Platform, add a SAML or OpenID Connect provider, and use the provider ID it shows, such as `saml.okta` |

## How saving works

- Typing saves to the browser within a fraction of a second, and, when signed in, to Firestore after a short pause (at least every few seconds while you keep typing).
- Every cloud save records which version it was built on. When two devices edit at once, the app merges their changes line by line instead of letting one overwrite the other; if both changed the same line differently, both versions are kept.
- While offline, edits stay in the browser and sync when the connection returns.
- Signing out shows the browser's own note again. The account's note stays in the cloud and comes back at the next sign-in.
- A note can hold about 900 KB of text, which is far more than most notes reach.

## Project layout

```
index.html            page shell
src/App.jsx           the editor, sign-in button, account menu and status line
src/index.css         design tokens (light and dark) and Tailwind setup
src/lib/cloud.js      Firebase sign-in and Firestore access (loaded only when configured)
src/lib/config.js     reads the VITE_… settings
src/lib/sync.js       keeps the note in step with the cloud
src/lib/merge.js      line-based merging used by sync
src/lib/storage.js    browser storage
firestore.rules       database security rules
firebase.json         Firebase Hosting and rules config
test/merge.test.js    tests for the merge logic (npm test)
```

## Notes

- `package.json` overrides `@grpc/grpc-js` to a patched version. Firebase only uses it in Node.js, never in the browser build; the override clears `npm audit` warnings without changing what ships.
- Fonts (Literata and IBM Plex Mono) are bundled with the app, so it makes no requests to font services.
