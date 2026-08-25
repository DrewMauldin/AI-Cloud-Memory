const values = {
  origin: window.location.origin,
  callback: `${window.location.origin}/callback`,
  mcp: `${window.location.origin}/mcp`,
};

for (const [key, value] of Object.entries(values)) {
  document.querySelectorAll(`[data-${key}]`).forEach((node) => { node.textContent = value; });
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const key = button.dataset.copy;
    if (!key || !values[key]) return;
    await navigator.clipboard.writeText(values[key]);
    const original = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = original; }, 1400);
  });
});

const storageKey = "ai-cloud-memory-community-setup-v1";
const saved = new Set(JSON.parse(localStorage.getItem(storageKey) ?? "[]"));
const steps = [...document.querySelectorAll("[data-step]")];

function renderProgress() {
  const completed = steps.filter((step) => step.querySelector("input")?.checked).length;
  document.querySelector("[data-completed]").textContent = String(completed);
  document.querySelector("[data-progress]").style.width = `${(completed / steps.length) * 100}%`;
}

steps.forEach((step) => {
  const checkbox = step.querySelector("input");
  checkbox.checked = saved.has(step.dataset.step);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) saved.add(step.dataset.step);
    else saved.delete(step.dataset.step);
    localStorage.setItem(storageKey, JSON.stringify([...saved]));
    renderProgress();
  });
});

renderProgress();
/* global window, document, navigator, localStorage */
