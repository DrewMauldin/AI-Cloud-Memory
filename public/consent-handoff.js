/* global document, fetch, FormData, HTMLButtonElement, HTMLFormElement, window */

const form = document.querySelector("[data-oauth-consent]");
const status = document.querySelector("[data-consent-status]");

if (form instanceof HTMLFormElement) {
  form.addEventListener("submit", async (event) => {
    const submitter = event.submitter;
    if (!(submitter instanceof HTMLButtonElement) || !submitter.name) return;

    event.preventDefault();
    submitter.disabled = true;
    if (status) status.textContent = "Completing the secure handoff…";

    try {
      const body = new FormData(form);
      body.set(submitter.name, submitter.value);
      const response = await fetch(form.action, {
        method: "POST",
        headers: { accept: "application/json" },
        body,
        credentials: "same-origin",
      });
      const result = await response.json();
      if (!response.ok || typeof result.redirectTo !== "string") {
        throw new Error("Consent handoff failed");
      }
      window.location.assign(result.redirectTo);
    } catch {
      submitter.disabled = false;
      if (status) status.textContent = "The handoff could not be completed. Please try again.";
    }
  });
}
