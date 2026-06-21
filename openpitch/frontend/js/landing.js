// Landing page: auth tab switching + login/register submission.
let mode = "login";

// Already signed in? Go straight to the dashboard.
if (API.token()) location.href = "/dashboard.html";

function showTab(m) {
  mode = m;
  document.getElementById("tab-login").classList.toggle("active", m === "login");
  document.getElementById("tab-register").classList.toggle("active", m === "register");
  document.getElementById("submit").textContent =
    m === "login" ? "Sign in" : "Create account";
  document.getElementById("password").autocomplete =
    m === "login" ? "current-password" : "new-password";
  document.getElementById("auth-error").textContent = "";
}

async function submit() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const err = document.getElementById("auth-error");
  err.textContent = "";
  if (!email || !password) { err.textContent = "Email and password required."; return; }
  const btn = document.getElementById("submit");
  btn.disabled = true;
  try {
    const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const data = await API.form(path, { email, password });
    API.setSession(data.token, data.email);
    location.href = "/dashboard.html";
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("submit").addEventListener("click", submit);
document.getElementById("auth-form").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submit();
});
