// ZUT Sports shared page interactions
const menuToggle = document.getElementById("menuToggle");
const mainNav = document.getElementById("mainNav");

if (menuToggle && mainNav) {
  function setMenuOpen(isOpen) {
    mainNav.classList.toggle("open", isOpen);
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
  }

  menuToggle.addEventListener("click", function () {
    setMenuOpen(!mainNav.classList.contains("open"));
  });

  mainNav.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      setMenuOpen(false);
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && mainNav.classList.contains("open")) {
      setMenuOpen(false);
      menuToggle.focus();
    }
  });
}

// Automatically display the current year on pages that have a year element.
document.querySelectorAll("#year").forEach(function (element) {
  element.textContent = new Date().getFullYear();
});

const logoutButton = document.getElementById("logoutButton");
const authMessage = document.getElementById("loginMessage") ||
  document.getElementById("signupMessage");

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    throw new Error(result.error || "The request could not be completed.");
  }
  return result;
}

function setFormBusy(form, isBusy) {
  const submitButton = form.querySelector('button[type="submit"]');
  if (!submitButton) return;

  if (isBusy) {
    submitButton.dataset.originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "Please wait...";
  } else {
    submitButton.disabled = false;
    submitButton.textContent = submitButton.dataset.originalText || submitButton.textContent;
  }
}

function showAuthError(error) {
  if (!authMessage) return;
  authMessage.textContent = error instanceof TypeError
    ? "Cannot reach the account server. Start it with npm start and open http://localhost:3000."
    : error.message;
}

async function loadCurrentSession() {
  if (!logoutButton) return;

  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!response.ok) return;
    const result = await response.json();
    if (authMessage) authMessage.textContent = `Signed in as ${result.user.fullName}.`;
    logoutButton.hidden = false;
  } catch {
    // Opening these pages directly from disk does not provide an API server.
  }
}

if (logoutButton) {
  logoutButton.addEventListener("click", async function () {
    try {
      await postJson("/api/auth/logout", {});
      logoutButton.hidden = true;
      if (authMessage) authMessage.textContent = "You have been signed out.";
    } catch (error) {
      showAuthError(error);
    }
  });
  loadCurrentSession();
}

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    setFormBusy(loginForm, true);
    try {
      await postJson("/api/auth/login", {
        email: document.getElementById("loginEmail").value,
        password: document.getElementById("loginPassword").value
      });
      window.location.assign("/");
    } catch (error) {
      showAuthError(error);
    } finally {
      setFormBusy(loginForm, false);
    }
  });
}

const signupForm = document.getElementById("signupForm");
if (signupForm) {
  signupForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const password = document.getElementById("signupPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    if (password !== confirmPassword) {
      if (authMessage) authMessage.textContent = "The passwords do not match. Please try again.";
      return;
    }

    setFormBusy(signupForm, true);
    try {
      await postJson("/api/auth/signup", {
        fullName: document.getElementById("fullName").value,
        email: document.getElementById("signupEmail").value,
        password: password
      });
      window.location.assign("/");
    } catch (error) {
      showAuthError(error);
    } finally {
      setFormBusy(signupForm, false);
    }
  });
}
