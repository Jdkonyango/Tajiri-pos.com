/* ---------- Tajiri POS · welcome page auth (login + signup) ---------- */
/* ---------- toast (shared by auth, modal and download handlers) ---------- */
var users = [];
var toastTimer = null;
var authRedirectTimer = null;
var authRedirectTimers = globalThis.__tajiriAuthRedirectTimers || (globalThis.__tajiriAuthRedirectTimers = []);

globalThis.__tajiriCurrentRedirectTimer = null;
globalThis.__tajiriAuthRedirectEnabled = false;

if (globalThis.__tajiriToastTimer) {
  clearTimeout(globalThis.__tajiriToastTimer);
}
globalThis.__tajiriToastTimer = null;

for (const timerId of authRedirectTimers) {
  clearTimeout(timerId);
}
authRedirectTimers.length = 0;

/* NOTE: window.firebaseAuth / window.firebaseDb are initialized by the
   inline Firebase bootstrap in index.html. Do NOT reset them here —
   resetting breaks cross-browser/cloud login (accounts would fall back
   to per-browser localStorage only). */
globalThis.users = users;

function showToast(message, kind = "") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `auth-toast show ${kind}`.trim();
  if (globalThis.__tajiriToastTimer) {
    clearTimeout(globalThis.__tajiriToastTimer);
  }
  globalThis.__tajiriToastTimer = setTimeout(() => {
    toast.className = "auth-toast";
    globalThis.__tajiriToastTimer = null;
  }, 2600);
  toastTimer = globalThis.__tajiriToastTimer;
}

function clearAuthRedirectTimer() {
  globalThis.__tajiriAuthRedirectEnabled = false;
  globalThis.__tajiriCurrentRedirectTimer = null;
  if (authRedirectTimer) {
    clearTimeout(authRedirectTimer);
    authRedirectTimer = null;
  }
  while (authRedirectTimers.length) {
    const timerId = authRedirectTimers.pop();
    if (timerId) clearTimeout(timerId);
  }
}

function registerAuthRedirectTimer(timerId) {
  if (!timerId) return;
  authRedirectTimer = timerId;
  globalThis.__tajiriCurrentRedirectTimer = timerId;
  globalThis.__tajiriAuthRedirectEnabled = true;
  authRedirectTimers.push(timerId);
}

function scheduleAuthRedirect(role = "cashier") {
  clearAuthRedirectTimer();
  const targetPath = role === "admin" ? "/admin" : "/cashier";
  const currentPath = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
  if (currentPath === targetPath) return;

  const timerId = setTimeout(() => {
    if (!globalThis.__tajiriAuthRedirectEnabled) return;
    if (globalThis.__tajiriCurrentRedirectTimer !== timerId) return;
    if (window.location) {
      const path = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
      if (path !== targetPath) {
        window.location.replace(targetPath);
      }
    }
  }, 1000);
  registerAuthRedirectTimer(timerId);
}

(function () {
  "use strict";

  const USERS_KEY = "tajiri-pos-accounts";
  const SESSION_KEY = "tajiri-session-user";
  const SESSION_ROLE_KEY = "tajiri-session-role";
  const REMEMBER_KEY = "tajiri-remembered-user";
  const REMEMBER_ROLE_KEY = "tajiri-remembered-role";

  const el = (id) => document.getElementById(id);
  const MIN_PASSWORD_LENGTH = 5;

  function getRequestedRole() {
    const requestedRole = String(window.__tajiriRequestedRole || "").toLowerCase();
    return requestedRole === "admin" || requestedRole === "cashier"
      ? requestedRole
      : "";
  }

  function ensureRequestedRoleAccess(userRole) {
    const requestedRole = getRequestedRole();
    if (!requestedRole) return true;

    if (String(userRole || "").toLowerCase() !== requestedRole) {
      setError(
        "loginForm",
        requestedRole === "admin"
          ? "Admin access is required on this route."
          : "Cashier access is required on this route.",
      );
      return false;
    }

    return true;
  }

  function passwordMeetsPolicy(password) {
    if (typeof password !== "string") return false;
    return password.length >= MIN_PASSWORD_LENGTH;
  }

  function getFirebaseAuth() {
    const auth = window.firebaseAuth;
    if (!auth) return null;
    if (
      typeof auth.signInWithEmailAndPassword !== "function" ||
      typeof auth.createUserWithEmailAndPassword !== "function"
    ) {
      return null;
    }
    return auth;
  }

  async function signIntoFirebase(email, password) {
    const auth = getFirebaseAuth();
    if (!auth || !email || !password) return null;
    try {
      return await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
      console.warn("Firebase sign-in fallback is unavailable:", error);
      return null;
    }
  }

  async function createFirebaseUser(email, password, displayName) {
    const auth = getFirebaseAuth();
    if (!auth || !email || !password) return null;
    try {
      const credential = await auth.createUserWithEmailAndPassword(
        email,
        password,
      );
      if (credential?.user && displayName) {
        await credential.user.updateProfile({ displayName });
      }
      return credential;
    } catch (error) {
      console.warn("Firebase signup fallback is unavailable:", error);
      return null;
    }
  }

  /* ---------- accounts store (shared with the POS state shape) ---------- */
  function loadUsers() {
    try {
      // Prefer the accounts store; fall back to users saved by the main app.
      const own = JSON.parse(localStorage.getItem(USERS_KEY) || "null");
      if (Array.isArray(own) && own.length) return own;
      const main = JSON.parse(localStorage.getItem("tajiri-pos") || "null");
      if (Array.isArray(main?.users) && main.users.length) return main.users;
    } catch (e) {
      /* corrupted storage — start fresh */
    }
    return [];
  }
  function saveUsers(nextUsers) {
    users = Array.isArray(nextUsers) ? nextUsers : [];
    window.users = users;
    globalThis.users = users;
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
      const savedState = JSON.parse(localStorage.getItem("tajiri-pos") || "{}");
      localStorage.setItem(
        "tajiri-pos",
        JSON.stringify({ ...savedState, users }),
      );
    } catch (e) {
      /* ignore */
    }
  }

  async function hashPassword(password) {
    const subtle =
      globalThis.crypto &&
      typeof globalThis.crypto === "object" &&
      globalThis.crypto.subtle;

    if (subtle && typeof subtle.digest === "function") {
      const bytes = new TextEncoder().encode(password);
      const digest = await subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    }

    let hash = 2166136261;
    for (const character of password) {
      hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    }
    return `fallback-${(hash >>> 0).toString(16)}`;
  }

  /* ---------- toast (top-level showToast above) ---------- */

  /* ---------- MySQL backend (optional) ----------
   * If a backend (server.js) is running on the same origin, accounts are
   * stored in MySQL. Otherwise we fall back to localStorage.
   */
  async function saveAccountToServer(payload) {
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        return { ok: false, error: data.error || "Sign-up failed." };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "offline" };
    }
  }

  /* ---------- tabs ---------- */
  function showTab(name) {
    document.querySelectorAll(".auth-tab").forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active);
    });
    document
      .querySelectorAll(".auth-form")
      .forEach((form) => form.classList.remove("active"));
    (name === "signup" ? el("signupForm") : el("loginForm")).classList.add(
      "active",
    );
    if (name === "signup") el("signupName").focus();
    else el("loginIdentity").focus();
  }
  document
    .querySelectorAll(".auth-tab")
    .forEach((tab) =>
      tab.addEventListener("click", () => showTab(tab.dataset.tab)),
    );
  document
    .querySelectorAll("[data-switch]")
    .forEach((button) =>
      button.addEventListener("click", () => showTab(button.dataset.switch)),
    );

  /* ---------- inline error helper ---------- */
  function setError(formId, message) {
    const error = el(formId === "loginForm" ? "loginError" : "signupError");
    error.textContent = message || "";
    error.hidden = !message;
  }

  /* ---------- password strength meter ---------- */
  el("signupPassword").addEventListener("input", (event) => {
    const value = event.target.value;
    const meter = el("strengthMeter");
    meter.hidden = value.length === 0;
    let score = 0;
    if (value.length >= 5) score++;
    if (value.length >= 8) score++;
    if (value.length >= 12) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;
    if (/\d/.test(value) && /[A-Za-z]/.test(value)) score++;
    const levels = ["Too weak", "Weak", "Fair", "Good", "Strong"];
    const colors = ["#e05261", "#e05261", "#dcdcaa", "#4aa3df", "#39d98a"];
    const fill = el("strengthFill");
    fill.style.width = `${Math.min((score / 3) * 100, 100)}%`;
    fill.style.background = colors[Math.min(score, 4)];
    el("strengthLabel").textContent = value
      ? `Password strength: ${levels[Math.min(score, 4)]}`
      : "";
  });

  /* ---------- login ---------- */
  el("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAuthRedirectTimer();
    setError("loginForm", null);
    const identity = el("loginIdentity").value.trim().toLowerCase();
    const password = el("loginPassword").value;
    if (!identity || !password)
      return setError("loginForm", "Enter your username/email and password.");

    if (identity.includes("@") && getFirebaseAuth()) {
      const firebaseUser = await signIntoFirebase(identity, password);
      if (firebaseUser?.user) {
        users = loadUsers();
        const matchedUser = users.find(entry => entry.email?.toLowerCase() === identity);
        const role = matchedUser?.role || "cashier";
        if (!ensureRequestedRoleAccess(role)) {
          return;
        }
        if (el("rememberLogin").checked)
          localStorage.setItem(REMEMBER_KEY, identity);
        else localStorage.removeItem(REMEMBER_KEY);
        if (el("rememberLogin").checked) localStorage.setItem(REMEMBER_ROLE_KEY, role);
        else localStorage.removeItem(REMEMBER_ROLE_KEY);
        sessionStorage.setItem(SESSION_KEY, firebaseUser.user.email || identity);
        sessionStorage.setItem(SESSION_ROLE_KEY, role);
        showToast("Welcome back! Opening your workspace…", "success");
        el("loginSubmit").textContent = "Signing in…";
        const loader = document.getElementById("appLoader");
        if (loader) {
          loader.classList.remove("hidden");
          loader.querySelector(".loader-text").textContent = "Please wait while we direct you to the page...";
        }
        scheduleAuthRedirect(role);
        return;
      }
    }

    users = loadUsers();
    const user = users.find(
      (entry) =>
        entry.username?.toLowerCase() === identity ||
        entry.email?.toLowerCase() === identity,
    );
    if (
      !user ||
      !user.passwordHash ||
      user.passwordHash !== (await hashPassword(password))
    ) {
      clearAuthRedirectTimer();
      return setError("loginForm", "Invalid username/email or password.");
    }

    if (!ensureRequestedRoleAccess(user.role)) {
      return;
    }

    if (el("rememberLogin").checked)
      localStorage.setItem(REMEMBER_KEY, identity);
    else localStorage.removeItem(REMEMBER_KEY);
    if (el("rememberLogin").checked) localStorage.setItem(REMEMBER_ROLE_KEY, user.role);
    else localStorage.removeItem(REMEMBER_ROLE_KEY);
    sessionStorage.setItem(
      SESSION_KEY,
      user.username?.toLowerCase() || identity,
    );
    sessionStorage.setItem(SESSION_ROLE_KEY, user.role);

    showToast(`Welcome back, ${user.name}! Opening your workspace…`, "success");
    el("loginSubmit").textContent = "Signing in…";
    const loader = document.getElementById("appLoader");
    if (loader) {
      loader.classList.remove("hidden");
      loader.querySelector(".loader-text").textContent = "Please wait while we direct you to the page...";
    }
    scheduleAuthRedirect(user.role);
  });

  el("forgotLink").addEventListener("click", () =>
    showToast("Ask an admin to reset your password, or create a new account."),
  );

  /* ---------- signup ---------- */
  el("signupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAuthRedirectTimer();
    setError("signupForm", null);
    const name = el("signupName").value.trim();
    const username = el("signupUsername").value.trim().toLowerCase();
    const email = el("signupEmail").value.trim().toLowerCase();
    const password = el("signupPassword").value;
    const confirmPassword = el("signupConfirmPassword").value;
    let role = "cashier";
    const phone = el("signupPhone").value.trim();

    if (!name || !username || !email || !password || !confirmPassword)
      return setError("signupForm", "Complete all required fields.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return setError("signupForm", "Enter a valid email address.");
    if (password !== confirmPassword)
      return setError("signupForm", "Passwords do not match.");
    if (!passwordMeetsPolicy(password))
      return setError(
        "signupForm",
        "Password must be at least 5 characters.",
      );

    users = loadUsers();
    role = users.length ? "cashier" : "admin";
    if (users.some((entry) => entry.username?.toLowerCase() === username))
      return setError("signupForm", "That username is already taken.");
    if (users.some((entry) => entry.email?.toLowerCase() === email))
      return setError(
        "signupForm",
        "An account with that email already exists.",
      );

    const payload = {
      name,
      username,
      email,
      role,
      phone,
      passwordHash: await hashPassword(password),
    };
    const firebaseCredential = getFirebaseAuth()
      ? await createFirebaseUser(email, password, name)
      : null;

    if (firebaseCredential?.user) {
      users.push(payload);
      saveUsers(users);
      updateAccountCount();
      el("signupSubmit").textContent = "Setting up…";
      sessionStorage.setItem(SESSION_KEY, email || username || name);
      sessionStorage.setItem(SESSION_ROLE_KEY, role);
      scheduleAuthRedirect(role);
      await completeSignup();
      return;
    }

    el("signupSubmit").textContent = "Saving…";
    const serverResult = await saveAccountToServer(payload);

    // The app is designed to work locally even when the optional MySQL backend is
    // unavailable or returning a transient server error. Keep the signup working by
    // saving locally instead of aborting the flow.
    if (serverResult && serverResult.ok) {
      // backend accepted it; keep the local store in sync for offline access.
    }

    users.push(payload);
    saveUsers(users);
    updateAccountCount();
    sessionStorage.setItem(SESSION_KEY, username || email || name);
    sessionStorage.setItem(SESSION_ROLE_KEY, role);
    scheduleAuthRedirect(role);
    await completeSignup();
  });

  /* ---------- after signup: switch to the login form ---------- */
  async function completeSignup() {
    const name = el("signupName").value.trim();
    const email = el("signupEmail").value.trim().toLowerCase();
    const username = el("signupUsername").value.trim().toLowerCase();

    el("signupSubmit").textContent = "Create account →";
    el("signupForm").reset();
    el("strengthMeter").hidden = true;

    sessionStorage.setItem(SESSION_KEY, username || email || name);
    showToast(
      `Account created, ${name}! Opening your workspace…`,
      "success",
    );
    showTab("login");
    el("loginIdentity").value = email || username;
    el("loginIdentity").focus();
  }

  /* ---------- welcome info ---------- */
  function updateAccountCount() {
    const users = loadUsers();
    el("heroAccounts").textContent = users.length
      ? `${users.length} account${users.length === 1 ? "" : "s"} ready`
      : "First run — create the admin account";
    const roleSelect = el("signupRole");
    if (roleSelect) {
      const role = users.length ? "cashier" : "admin";
      roleSelect.innerHTML = `<option value="${role}">${role === "admin" ? "Admin — full access" : "Cashier"}</option>`;
      roleSelect.value = role;
      roleSelect.disabled = true;
    }
  }

  function applyRouteLoginContext() {
    const requestedRole = getRequestedRole();
    if (!requestedRole) return;

    showTab("login");
    const modalAccess = document.getElementById("modal-access");
    if (modalAccess) {
      openModal("modal-access");
    }

    const loginHeading = document.querySelector("#modal-access .modal-head h2");
    if (loginHeading) {
      loginHeading.textContent = requestedRole === "admin" ? "Admin sign in" : "Cashier sign in";
    }

    const loginSubtitle = document.querySelector("#loginForm .auth-sub");
    if (loginSubtitle) {
      loginSubtitle.textContent = requestedRole === "admin"
        ? "Sign in with your admin account to manage the store."
        : "Sign in with your cashier account to begin a sale.";
    }

    const identityInput = el("loginIdentity");
    if (identityInput) {
      identityInput.placeholder = requestedRole === "admin"
        ? "Admin username or email"
        : "Cashier username or email";
    }
  }

  el("heroYear").textContent = new Date().getFullYear();
  updateAccountCount();
  showTab(loadUsers().length ? "login" : "signup");
  applyRouteLoginContext();

  const loader = document.getElementById("appLoader");
  window.addEventListener("load", () => {
    setTimeout(() => {
      loader?.classList.add("hidden");
    }, 450);
  });
})();

/* ---------- modal manager (open on click only, via delegation) ---------- */
const modalLayers = document.querySelectorAll(".modal-layer");

function openModal(id) {
  modalLayers.forEach(layer => { layer.hidden = layer.id !== id; });
  const layer = document.getElementById(id);
  if (layer) {
    layer.querySelector("input, select, button:not(.modal-close)")?.focus();
    document.body.style.overflow = "hidden";
  }
}
function closeModals() {
  modalLayers.forEach(layer => { layer.hidden = true; });
  document.body.style.overflow = "";
}

document.addEventListener("click", event => {
  const trigger = event.target.closest("[data-modal-open]");
  if (!trigger) return;
  openModal(trigger.dataset.modalOpen);
  if (trigger.dataset.authTab) {
    window.setTimeout(() => {
      const tab = document.querySelector(`.auth-tab[data-tab="${trigger.dataset.authTab}"]`);
      tab?.click();
    }, 0);
  }
});
document.querySelectorAll("[data-modal-close]").forEach(button =>
  button.addEventListener("click", closeModals));
modalLayers.forEach(layer =>
  layer.addEventListener("click", event => { if (event.target === layer) closeModals(); }));
document.addEventListener("keydown", event => { if (event.key === "Escape") closeModals(); });

/* ---------- download buttons ---------- */
const fallbackInstallerLink = "downloads/readme.txt";
const githubRepository = window.TAJIRI_GITHUB_REPOSITORY;
const releaseAssetUrl = (filename) => githubRepository
  ? `https://github.com/${githubRepository}/releases/latest/download/${encodeURIComponent(filename)}`
  : null;

document.querySelectorAll("[data-release-asset]").forEach(link => {
  const url = releaseAssetUrl(link.dataset.releaseAsset);
  if (!url) return;
  link.href = url;
  link.removeAttribute("download");
});

document.querySelectorAll("[data-installer-download]").forEach(control => {
  control.addEventListener("click", event => {
    if (releaseAssetUrl(control.dataset.releaseAsset)) return;
    event.preventDefault();
    if (control.getAttribute("aria-busy") === "true") return;

    control.setAttribute("aria-busy", "true");
    showToast("The installer is currently hosted outside Cloudflare Pages because the file exceeds the 25 MiB limit.");

    const downloadLink = document.createElement("a");
    downloadLink.href = fallbackInstallerLink;
    downloadLink.download = "readme.txt";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    control.removeAttribute("aria-busy");
  });
});

document.querySelectorAll(".dl-card:not([data-installer-download])").forEach(card => {
  card.addEventListener("click", event => {
    // let the browser try the download; warn via toast that the file must exist
    const file = card.getAttribute("href");
    fetch(file, { method: "HEAD" }).then(response => {
      if (!response.ok) showToast(`"${file}" is not in the downloads folder yet.`, "");
    }, () => showToast(`"${file}" is not in the downloads folder yet.`, ""));
  });
});

/* (the standalone "More" dropdown was merged into the nav "More ▾" menu) */

/* ---------- nav "More ▾" dropdown toggle ---------- */
(function () {
  const btn = document.getElementById("navMoreBtn");
  const menu = document.getElementById("navMoreMenu");
  if (!btn || !menu) return;

  menu.hidden = true;
  btn.setAttribute("aria-expanded", "false");

  function closeMenu() {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }
  btn.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  });
  // close when a menu item is used (modal-open click still fires)
  menu.addEventListener("click", event => {
    if (event.target.closest("[data-modal-open]")) closeMenu();
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".nav-more")) closeMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMenu();
  });
})();
