// Firebase sign-in and cloud storage. The app loads this module on demand,
// only when Firebase is configured, so the editor itself opens instantly.

import { initializeApp } from "firebase/app";
import {
  GithubAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  SAMLAuthProvider,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, getDoc, getFirestore, onSnapshot, setDoc } from "firebase/firestore";
import { authProvider, authTenant, firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Firestore documents can hold up to 1 MiB; leave room for the other fields.
export const maxBytes = 900_000;

const REDIRECT_FLAG = "pocket-jotter:redirecting";

const codeError = (code, cause) => Object.assign(new Error(code), { code, cause });

// ---- sign-in -------------------------------------------------------------

function makeProvider(id) {
  if (id === "google") {
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    return p;
  }
  if (id === "microsoft") {
    const p = new OAuthProvider("microsoft.com");
    p.setCustomParameters(authTenant ? { prompt: "select_account", tenant: authTenant } : { prompt: "select_account" });
    return p;
  }
  if (id === "apple") {
    const p = new OAuthProvider("apple.com");
    p.addScope("email");
    p.addScope("name");
    return p;
  }
  if (id === "github") return new GithubAuthProvider();
  if (id.startsWith("saml.")) return new SAMLAuthProvider(id);
  if (id.startsWith("oidc.")) return new OAuthProvider(id);
  throw codeError("provider");
}

function authError(e) {
  const code = (e && e.code) || "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request" || code === "auth/user-cancelled")
    return codeError("cancelled", e);
  if (code === "auth/unauthorized-domain") return codeError("domain", e);
  if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found") return codeError("disabled", e);
  if (code === "auth/network-request-failed") return codeError("network", e);
  if (code === "auth/account-exists-with-different-credential") return codeError("conflict", e);
  if (code === "provider") return e;
  return codeError("failed", e);
}

const toUser = (u) => ({
  uid: u.uid,
  name: u.displayName || "",
  email: u.email || "",
  avatarUrl: u.photoURL || "",
});

// Calls back with the signed-in person (or null) now and on every change,
// including sign-ins and sign-outs in other tabs.
export function onUser(callback) {
  return onAuthStateChanged(auth, (u) => callback(u ? toUser(u) : null));
}

// Opens the provider's sign-in popup. If the browser blocks popups, falls
// back to a full-page redirect and resolves null (the page navigates away;
// onUser reports the person when it comes back).
export async function signIn() {
  const provider = makeProvider(authProvider);
  try {
    const result = await signInWithPopup(auth, provider);
    return toUser(result.user);
  } catch (e) {
    const code = e && e.code;
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      try {
        sessionStorage.setItem(REDIRECT_FLAG, "1");
      } catch {
        /* storage unavailable */
      }
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw authError(e);
  }
}

// After returning from a redirect sign-in, resolves the error it ended
// with, or null.
export async function redirectError() {
  let pending = false;
  try {
    pending = sessionStorage.getItem(REDIRECT_FLAG) === "1";
    sessionStorage.removeItem(REDIRECT_FLAG);
  } catch {
    /* storage unavailable */
  }
  if (!pending) return null;
  try {
    await getRedirectResult(auth);
    return null;
  } catch (e) {
    return authError(e);
  }
}

export function signOut() {
  return firebaseSignOut(auth);
}

// ---- the note --------------------------------------------------------------

// Firestore error codes, translated to the ones the sync engine expects.
function storeError(e) {
  const code = (e && e.code) || "";
  if (code === "permission-denied" || code === "unauthenticated") return codeError("revoked", e);
  if (code === "invalid-argument" || code === "out-of-range") return codeError("invalid_argument", e);
  if (code === "resource-exhausted") return codeError("resource_exhausted", e);
  return codeError("unavailable", e);
}

const wrap = (s) => ({
  exists: s.exists(),
  data: () => s.data(),
  metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites },
});

// The person's note: users/{uid}/notes/jotter, readable and writable only
// by them (see firestore.rules).
export function noteDoc(uid) {
  const ref = doc(db, "users", uid, "notes", "jotter");
  return {
    async get() {
      try {
        return wrap(await getDoc(ref));
      } catch (e) {
        throw storeError(e);
      }
    },
    async set(data) {
      try {
        await setDoc(ref, data);
      } catch (e) {
        throw storeError(e);
      }
    },
    onSnapshot(next, error) {
      return onSnapshot(
        ref,
        (s) => next(wrap(s)),
        (e) => error && error(storeError(e)),
      );
    },
  };
}
