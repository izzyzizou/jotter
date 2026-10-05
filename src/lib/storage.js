// Browser storage for the note. Every access is wrapped: storage can be
// blocked or cleared (private windows, previews), and the page must keep
// working without it.

const KEY_BROWSER = "pocket-jotter:browser-note:v1";
const KEY_SESSION = "pocket-jotter:session:v1";
const accountKey = (uid) => "pocket-jotter:account:v1:" + uid;

function read(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

// A synced version of the note as stored in the cloud and cached here.
export function readVersion(v) {
  if (!v || typeof v !== "object") return null;
  if (typeof v.text !== "string" || typeof v.nonce !== "string" || !v.nonce) return null;
  return {
    text: v.text,
    nonce: v.nonce,
    lineage: Array.isArray(v.lineage) ? v.lineage.filter((x) => typeof x === "string").slice(0, 32) : [],
    updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : 0,
  };
}

export const store = {
  browserKey: KEY_BROWSER,

  // The note kept in this browser while signed out.
  readBrowserNote() {
    const v = read(KEY_BROWSER);
    return v && typeof v.text === "string" ? v.text : "";
  },
  writeBrowserNote(text) {
    return write(KEY_BROWSER, { text, savedAt: Date.now() });
  },
  clearBrowserNote() {
    remove(KEY_BROWSER);
  },

  // Which account this browser is signed in to, if any.
  readSession() {
    const v = read(KEY_SESSION);
    return v && typeof v.uid === "string" && v.uid ? v.uid : null;
  },
  writeSession(uid) {
    return write(KEY_SESSION, { uid });
  },
  clearSession() {
    remove(KEY_SESSION);
  },

  // Local copy of an account's note: the text as last edited here, plus
  // the cloud version it was last in step with (used to merge safely).
  readAccount(uid) {
    const v = read(accountKey(uid));
    if (!v || typeof v.text !== "string") return null;
    return { text: v.text, base: readVersion(v.base) };
  },
  writeAccount(uid, text, base) {
    return write(accountKey(uid), { text, base: base || null, savedAt: Date.now() });
  },
  clearAccount(uid) {
    remove(accountKey(uid));
  },
};
