import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cloudConfigured } from "./lib/config.js";
import { mapCaret } from "./lib/merge.js";
import { store } from "./lib/storage.js";
import { CloudSync } from "./lib/sync.js";

const PLACEHOLDER = {
  browser: "Jot down ideas, lists, things to remember.\nEverything saves in this browser as you type.",
  account: "Jot down ideas, lists, things to remember.\nEverything saves to your account as you type.",
};

const NOTICES = {
  "not-configured":
    "Sign-in isn’t set up yet. Add your Firebase settings to .env.local (see the README). Your notes are saved in this browser meanwhile.",
  provider:
    "The sign-in provider in VITE_AUTH_PROVIDER isn’t recognised. Use google, microsoft, apple, github, or a saml. or oidc. provider ID.",
  domain: "This address isn’t allowed to sign in yet. Add it in Firebase under Authentication › Settings › Authorized domains.",
  disabled: "This sign-in method is turned off. Turn it on in Firebase under Authentication › Sign-in method.",
  network: "Couldn’t reach the sign-in service. Your notes are saved in this browser, so try again in a moment.",
  conflict: "That email already signs in to this app another way. Use the sign-in method you used before.",
  sync: "You’re signed in, but your notes couldn’t be reached. They’re saved in this browser; try again in a moment.",
  failed: "Sign-in didn’t finish. Your notes are saved in this browser, so try again in a moment.",
};

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const timeOf = (ms) => (ms ? clock.format(new Date(ms)) : "");
const codeError = (code) => Object.assign(new Error(code), { code });
const noticeFor = (e) => (e && NOTICES[e.code] ? e.code : "failed");

// Firebase loads only when it is configured, after the editor is up.
let cloudPromise = null;
function loadCloud() {
  if (!cloudConfigured) return Promise.resolve(null);
  if (!cloudPromise) {
    cloudPromise = import("./lib/cloud.js").catch(() => {
      cloudPromise = null; // offline on first visit: try again later
      return null;
    });
  }
  return cloudPromise;
}

const profileOf = (user) => ({ name: user.name, email: user.email, avatarUrl: user.avatarUrl });

function statusText(mode, sync) {
  switch (sync.state) {
    case "saved":
      return mode === "account" ? (sync.at ? `Saved ${timeOf(sync.at)}` : "Saved") : "Saved in this browser";
    case "pending":
    case "saving":
      return "Saving…";
    case "connecting":
      return "Connecting…";
    case "offline":
      return "Offline · saved in this browser";
    case "stopped":
      return "Sync stopped · saved in this browser";
    case "too-big":
      return "Too long to sync · saved in this browser";
    case "blocked":
      return "Not saving · browser storage is off";
    case "signed-out":
      return sync.synced === false ? "Signed out · recent edits sync next sign-in" : "Signed out";
    default:
      return "";
  }
}

function syncDetail(sync) {
  switch (sync.state) {
    case "saved":
      return sync.at ? `Everything is saved. Last change synced at ${timeOf(sync.at)}.` : "Everything is saved.";
    case "pending":
    case "saving":
      return "Saving your latest changes.";
    case "connecting":
      return "Connecting to your account.";
    case "offline":
      return "You’re offline. Changes stay in this browser and sync when you’re back online.";
    case "stopped":
      return "Sync stopped for this visit. Changes stay in this browser. Reload the page to reconnect.";
    case "too-big":
      return "This note is over 900 KB, which is too long to sync. Shorten it to resume syncing.";
    default:
      return "";
  }
}

function dotClass(state) {
  if (state === "saved" || state === "idle") return "bg-ok";
  if (state === "pending" || state === "saving" || state === "connecting") return "bg-muted motion-safe:animate-pulse";
  if (state === "offline") return "bg-warn";
  return "bg-err";
}

function StatusLine({ mode, sync }) {
  const text = statusText(mode, sync);
  const fades = sync.state === "saved" || sync.state === "signed-out";
  const [shown, setShown] = useState(Boolean(text));
  useEffect(() => {
    if (!text) {
      setShown(false);
      return undefined;
    }
    setShown(true);
    if (!fades) return undefined;
    const t = setTimeout(() => setShown(false), sync.state === "signed-out" ? 4000 : 2400);
    return () => clearTimeout(t);
  }, [text, fades, sync.state, sync.at]);
  return (
    <p
      role="status"
      aria-live="polite"
      className={
        "min-w-0 truncate font-ui text-xs tabular-nums text-muted transition-opacity duration-500 motion-reduce:transition-none " +
        (shown ? "opacity-100" : "opacity-0")
      }
    >
      {text}
    </p>
  );
}

function PersonGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c1.4-3.2 4-4.8 7-4.8s5.6 1.6 7 4.8" strokeLinecap="round" />
    </svg>
  );
}

function Avatar({ profile, pending, className }) {
  const [broken, setBroken] = useState(false);
  const base = "block shrink-0 rounded-full " + className;
  if (!profile) {
    return (
      <span className={base + " grid place-items-center bg-paper " + (pending ? "motion-safe:animate-pulse" : "")}>
        {!pending && <PersonGlyph />}
      </span>
    );
  }
  if (profile.avatarUrl && !broken) {
    return (
      <img
        src={profile.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={base + " object-cover"}
      />
    );
  }
  const initial = (profile.name || profile.email || "").trim().charAt(0).toUpperCase();
  return (
    <span className={base + " grid place-items-center bg-accent font-ui text-xs font-medium text-paper"}>
      {initial || <PersonGlyph />}
    </span>
  );
}

const panelClass =
  "absolute right-0 top-[calc(100%-0.25rem)] z-20 w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-rule bg-raised shadow-[var(--shadow)]";

function AccountPanel({ profile, sync, busy, onSignOut }) {
  return (
    <div role="dialog" aria-label="Account" className={panelClass + " p-2"}>
      <div className="flex items-center gap-3 p-2">
        <Avatar profile={profile} pending={sync.state === "connecting"} className="size-9 ring-1 ring-rule" />
        <div className="min-w-0">
          <p className="truncate font-note text-[15px] leading-snug text-ink">{(profile && profile.name) || "Signed in"}</p>
          <p className="truncate font-ui text-xs text-muted">
            {(profile && profile.email) || "Notes sync across your devices"}
          </p>
        </div>
      </div>
      <p className="px-2 pb-3 pt-1 font-ui text-xs leading-relaxed text-muted">{syncDetail(sync)}</p>
      <div className="border-t border-rule pt-2">
        <button
          id="sign-out"
          type="button"
          onClick={onSignOut}
          disabled={busy}
          className="flex w-full items-center rounded-lg px-2 py-2 text-left font-ui text-[13px] text-ink transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-progress disabled:opacity-60"
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}

function Notice({ code }) {
  return (
    <div role="alert" className={panelClass + " p-4"}>
      <p className="font-ui text-[13px] leading-relaxed text-ink">{NOTICES[code] || NOTICES.failed}</p>
    </div>
  );
}

export default function App() {
  const taRef = useRef(null);
  const headerRef = useRef(null);

  // What to show before anything async happens: the signed-in account's
  // local copy, or the browser note.
  const [boot] = useState(() => {
    const uid = store.readSession();
    if (uid) {
      const cached = store.readAccount(uid);
      return { mode: "account", uid, text: cached ? cached.text : "" };
    }
    return { mode: "browser", uid: null, text: store.readBrowserNote() };
  });

  const [mode, setModeState] = useState(boot.mode);
  const modeRef = useRef(boot.mode);
  const setMode = (m) => {
    modeRef.current = m;
    setModeState(m);
  };
  const uidRef = useRef(boot.uid);
  const engineRef = useRef(null);
  const cloudRef = useRef(null);
  const userRef = useRef(null);
  const [sync, setSync] = useState({ state: boot.mode === "account" ? "connecting" : "idle", at: 0 });
  const [profile, setProfile] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const signingInRef = useRef(false);
  const signingOutRef = useRef(false);
  const [panel, setPanel] = useState(null); // null | "account" | { notice }
  const browserTimer = useRef(null);
  const cacheTimer = useRef(null);
  const lastBrowserSave = useRef(boot.mode === "browser" ? boot.text : "");

  // ---- editor access -------------------------------------------------------

  const getText = () => (taRef.current ? taRef.current.value : "");

  // Replace the text but keep the caret and scroll where the person was.
  const setText = (next) => {
    const ta = taRef.current;
    if (!ta || ta.value === next) return;
    const before = ta.value;
    const focused = document.activeElement === ta;
    const { selectionStart, selectionEnd, scrollTop } = ta;
    ta.value = next;
    if (focused) ta.setSelectionRange(mapCaret(before, next, selectionStart), mapCaret(before, next, selectionEnd));
    ta.scrollTop = scrollTop;
  };

  // Tab types a tab character instead of moving focus. Shift+Tab is left
  // alone so keyboard users can still leave the note.
  const onTab = (e) => {
    if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const ta = e.currentTarget;
    // execCommand keeps the browser's undo history and fires an input event.
    if (document.execCommand && document.execCommand("insertText", false, "\t")) return;
    ta.setRangeText("\t", ta.selectionStart, ta.selectionEnd, "end");
    onInput();
  };

  // Swap in a different note entirely (signing out).
  const showNote = (next) => {
    const ta = taRef.current;
    if (!ta) return;
    ta.value = next;
    if (document.activeElement === ta) ta.setSelectionRange(next.length, next.length);
    ta.scrollTop = ta.scrollHeight;
  };

  // ---- saving --------------------------------------------------------------

  const saveBrowserNow = () => {
    clearTimeout(browserTimer.current);
    browserTimer.current = null;
    if (modeRef.current !== "browser") return;
    const text = getText();
    const ok = store.writeBrowserNote(text);
    lastBrowserSave.current = text;
    setSync({ state: ok ? "saved" : "blocked", at: Date.now() });
  };

  const saveAccountNow = () => {
    clearTimeout(cacheTimer.current);
    cacheTimer.current = null;
    const uid = uidRef.current;
    if (modeRef.current !== "account" || !uid) return;
    const engine = engineRef.current;
    const cached = engine ? null : store.readAccount(uid);
    store.writeAccount(uid, getText(), engine ? engine.base : cached && cached.base);
  };

  const saveNow = () => {
    if (modeRef.current === "browser") saveBrowserNow();
    else {
      saveAccountNow();
      if (engineRef.current) engineRef.current.flush();
    }
  };

  const onInput = () => {
    if (modeRef.current === "browser") {
      clearTimeout(browserTimer.current);
      browserTimer.current = setTimeout(saveBrowserNow, 300);
    } else {
      clearTimeout(cacheTimer.current);
      cacheTimer.current = setTimeout(saveAccountNow, 300);
      if (engineRef.current) engineRef.current.touch();
    }
  };

  // ---- account -------------------------------------------------------------

  // Start syncing the editor with `user`'s note. With `fromBrowserNote`,
  // the editor holds the signed-out note, which is added to theirs.
  const connect = async (user, { fromBrowserNote }) => {
    const cloud = cloudRef.current;
    const uid = user.uid;
    const prevUid = uidRef.current;
    // Another account than the one this browser last used: show that
    // account's own note rather than mixing the two.
    if (!fromBrowserNote && prevUid && prevUid !== uid) {
      saveAccountNow();
      const other = store.readAccount(uid);
      showNote(other ? other.text : "");
      store.writeSession(uid);
    }
    if (!fromBrowserNote) uidRef.current = uid;
    if (engineRef.current) {
      engineRef.current.close();
      engineRef.current = null;
    }
    const cached = store.readAccount(uid);
    const engine = new CloudSync({
      ref: cloud.noteDoc(uid),
      maxBytes: cloud.maxBytes,
      getText,
      setText,
      persist: (text, base) => store.writeAccount(uid, text, base),
      onStatus: (s) => {
        if (engineRef.current === engine) setSync(s);
      },
    });
    engineRef.current = engine;
    try {
      await engine.start({ cached, fromBrowserNote });
    } catch (e) {
      engine.close();
      if (engineRef.current === engine) engineRef.current = null;
      throw e;
    }
    clearTimeout(browserTimer.current);
    browserTimer.current = null;
    uidRef.current = uid;
    store.writeSession(uid);
    if (fromBrowserNote) store.clearBrowserNote();
    setMode("account");
    setProfile(profileOf(user));
    if (engine.dirty()) engine.touch();
  };

  // Back to the browser note. `byPerson`: they pressed Sign out, so push
  // what's unsaved first and end the sign-in session too.
  const leaveAccount = async ({ byPerson }) => {
    signingOutRef.current = true;
    if (byPerson) setSigningOut(true);
    saveAccountNow();
    const engine = engineRef.current;
    const uid = uidRef.current;
    if (engine) {
      if (byPerson) await engine.drain();
      engine.close();
      engineRef.current = null;
    }
    // Forget this account's local copy once the cloud has all of it;
    // otherwise keep it so the edits sync at the next sign-in.
    let synced = true;
    if (uid) {
      const c = store.readAccount(uid);
      const clean = !c || (c.base ? c.text === c.base.text : c.text === "");
      if (clean) store.clearAccount(uid);
      else synced = false;
    }
    store.clearSession();
    uidRef.current = null;
    setMode("browser");
    setProfile(null);
    setPanel(null);
    const note = store.readBrowserNote();
    lastBrowserSave.current = note;
    showNote(note);
    if (byPerson && cloudRef.current) {
      try {
        await cloudRef.current.signOut();
      } catch {
        /* the local session is cleared regardless */
      }
    }
    setSigningOut(false);
    signingOutRef.current = false;
    setSync({ state: "signed-out", at: Date.now(), synced });
  };

  // Sign-in state from Firebase: on load, and after sign-ins or sign-outs
  // here or in other tabs.
  const handleUser = async (user) => {
    userRef.current = user;
    if (signingInRef.current || signingOutRef.current) return; // that flow handles it
    if (!user) {
      if (modeRef.current === "account") await leaveAccount({ byPerson: false });
      return;
    }
    if (engineRef.current && uidRef.current === user.uid) {
      setProfile(profileOf(user));
      return;
    }
    try {
      await connect(user, { fromBrowserNote: modeRef.current === "browser" });
    } catch {
      if (modeRef.current === "account") setSync({ state: "offline", at: 0 });
    }
  };

  const signIn = async () => {
    if (signingInRef.current) return;
    signingInRef.current = true;
    setSigningIn(true);
    setPanel(null);
    try {
      if (!cloudConfigured) throw codeError("not-configured");
      const cloud = cloudRef.current || (await loadCloud());
      if (!cloud) throw codeError("network");
      cloudRef.current = cloud;
      const user = userRef.current || (await cloud.signIn());
      if (!user) return; // on the way to the provider's page
      userRef.current = user;
      try {
        await connect(user, { fromBrowserNote: true });
      } catch {
        throw codeError("sync");
      }
    } catch (e) {
      if (modeRef.current === "browser") saveBrowserNow();
      if (!e || e.code !== "cancelled") setPanel({ notice: noticeFor(e) });
    } finally {
      signingInRef.current = false;
      setSigningIn(false);
    }
  };

  // ---- effects -------------------------------------------------------------

  // Caret at the end, ready to add the next thought.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const end = ta.value.length;
    try {
      ta.focus({ preventScroll: true });
    } catch {
      /* focus is optional */
    }
    ta.setSelectionRange(end, end);
    ta.scrollTop = ta.scrollHeight;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = null;
    loadCloud().then((cloud) => {
      if (cancelled) return;
      if (!cloud) {
        if (modeRef.current === "account") setSync({ state: "offline", at: 0 });
        return;
      }
      cloudRef.current = cloud;
      unsubscribe = cloud.onUser(handleUser);
      cloud.redirectError().then((err) => {
        if (!cancelled && err && err.code !== "cancelled") setPanel({ notice: noticeFor(err) });
      });
    });

    const resume = () => {
      if (modeRef.current !== "account") return;
      if (engineRef.current) engineRef.current.refresh();
      else if (userRef.current) handleUser(userRef.current);
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? saveNow() : resume());
    const onStorage = (e) => {
      // Another tab edited the browser note; follow it unless this tab
      // has typing that hasn't been saved yet.
      if (e.key !== store.browserKey || modeRef.current !== "browser") return;
      if (getText() !== lastBrowserSave.current) return;
      const next = store.readBrowserNote();
      lastBrowserSave.current = next;
      setText(next);
    };
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveNow();
      } else if (e.key === "Escape") setPanel(null);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", saveNow);
    window.addEventListener("online", resume);
    window.addEventListener("storage", onStorage);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", saveNow);
      window.removeEventListener("online", resume);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Close a panel on an outside tap; notices also close on their own.
  useEffect(() => {
    if (!panel) return undefined;
    const onDown = (e) => {
      if (headerRef.current && !headerRef.current.contains(e.target)) setPanel(null);
    };
    document.addEventListener("pointerdown", onDown);
    const t = panel.notice ? setTimeout(() => setPanel((p) => (p === panel ? null : p)), 9000) : null;
    return () => {
      document.removeEventListener("pointerdown", onDown);
      clearTimeout(t);
    };
  }, [panel]);

  // ---- view ----------------------------------------------------------------

  return (
    <div className="flex h-full flex-col px-4 sm:px-6">
      <header ref={headerRef} className="relative flex h-14 shrink-0 items-center justify-end gap-3">
        <StatusLine mode={mode} sync={sync} />
        {mode === "browser" ? (
          <button
            id="sign-in"
            type="button"
            onClick={signIn}
            disabled={signingIn}
            aria-busy={signingIn}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-rule bg-paper px-4 font-ui text-[13px] font-medium text-accent transition-colors hover:border-accent hover:bg-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-progress disabled:opacity-70"
          >
            {signingIn && (
              <span
                aria-hidden="true"
                className="size-3 rounded-full border-[1.5px] border-current border-r-transparent motion-safe:animate-spin"
              />
            )}
            {signingIn ? "Signing in…" : "Sign in"}
          </button>
        ) : (
          <button
            id="account"
            type="button"
            aria-label={profile && profile.name ? `Account: ${profile.name}` : "Account"}
            aria-haspopup="dialog"
            aria-expanded={panel === "account"}
            onClick={() => setPanel((p) => (p === "account" ? null : "account"))}
            className="relative grid size-9 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Avatar profile={profile} pending={sync.state === "connecting"} className="size-8 ring-1 ring-rule" />
            <span
              aria-hidden="true"
              className={"absolute bottom-0 right-0 size-2.5 rounded-full ring-2 ring-paper " + dotClass(sync.state)}
            />
          </button>
        )}
        {panel === "account" && mode === "account" && (
          <AccountPanel profile={profile} sync={sync} busy={signingOut} onSignOut={() => leaveAccount({ byPerson: true })} />
        )}
        {panel && panel.notice && <Notice code={panel.notice} />}
      </header>
      <textarea
        id="note"
        ref={taRef}
        defaultValue={boot.text}
        onInput={onInput}
        onKeyDown={onTab}
        onCompositionStart={() => engineRef.current && engineRef.current.setComposing(true)}
        onCompositionEnd={() => {
          if (engineRef.current) engineRef.current.setComposing(false);
          onInput();
        }}
        placeholder={mode === "account" ? PLACEHOLDER.account : PLACEHOLDER.browser}
        aria-label="Note"
        spellCheck={true}
        autoCapitalize="sentences"
        autoComplete="off"
        className="note min-h-0 w-full flex-1 resize-none border-0 bg-transparent text-ink outline-none"
      />
    </div>
  );
}
