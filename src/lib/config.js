// Settings come from environment variables (see .env.example). Without the
// Firebase ones the app still works, saving in the browser only.

const env = import.meta.env;
const clean = (v) => (typeof v === "string" ? v.trim() : "");

export const firebaseConfig = {
  apiKey: clean(env.VITE_FIREBASE_API_KEY),
  authDomain: clean(env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: clean(env.VITE_FIREBASE_PROJECT_ID),
  appId: clean(env.VITE_FIREBASE_APP_ID),
};

// google (default), microsoft, apple, github, or a SAML/OIDC provider ID
// such as "saml.okta" or "oidc.okta".
export const authProvider = clean(env.VITE_AUTH_PROVIDER) || "google";

// Microsoft only: restrict sign-in to one Microsoft Entra tenant.
export const authTenant = clean(env.VITE_AUTH_TENANT);

export const cloudConfigured = Object.values(firebaseConfig).every(Boolean);
