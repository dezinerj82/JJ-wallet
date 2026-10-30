import { initialiseGoogleLogin, signIn, signOut } from "./auth.js";

const status = document.getElementById("setup-status");
const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");
const signedInView = document.getElementById("signed-in-view");
const signedInAccount = document.getElementById("signed-in-account");

function showSignedOut(message = "Sign in with your authorised Google account.") {
  signedInView.hidden = true;
  loginButton.hidden = false;
  status.textContent = message;
  signedInAccount.textContent = "";
}

function showSignedIn(email) {
  loginButton.hidden = true;
  signedInView.hidden = false;
  signedInAccount.textContent = `Signed in as ${email}`;
  status.textContent = "Google identity confirmed.";
}

loginButton.addEventListener("click", () => {
  try {
    status.textContent = "Opening Google sign-in...";
    signIn();
  } catch (error) {
    showSignedOut(error.message);
  }
});

logoutButton.addEventListener("click", () => {
  signOut();
  showSignedOut();
});

try {
  await initialiseGoogleLogin({
    onSignedIn: showSignedIn,
    onError: message => showSignedOut(message)
  });
  loginButton.disabled = false;
  showSignedOut();
} catch (error) {
  loginButton.disabled = true;
  showSignedOut(error.message);
}
