// ZUT Sports template: simple frontend interactions

// Mobile navigation menu (home page)
const menuToggle = document.getElementById("menuToggle");
const mainNav = document.getElementById("mainNav");

if (menuToggle && mainNav) {
  menuToggle.addEventListener("click", function () {
    const isOpen = mainNav.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", isOpen);
    menuToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
  });

  mainNav.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      mainNav.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
    });
  });
}

// Automatically display the current year on pages that have a year element.
document.querySelectorAll("#year").forEach(function (element) {
  element.textContent = new Date().getFullYear();
});

// Login form: interface demonstration only, not real authentication.
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();
    document.getElementById("loginMessage").textContent =
      "Demo only: login will work after we connect a secure backend.";
  });
}

// Sign-up form: check that both password entries match.
const signupForm = document.getElementById("signupForm");
if (signupForm) {
  signupForm.addEventListener("submit", function (event) {
    event.preventDefault();

    const password = document.getElementById("signupPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const message = document.getElementById("signupMessage");

    if (password !== confirmPassword) {
      message.textContent = "The passwords do not match. Please try again.";
      return;
    }

    message.textContent =
      "The form looks good! Account creation will be enabled when we add the backend.";
  });
}
