// WOSAI preference migration marker.
//
// Extensions load in existing browser profiles during upgrades. Never clear
// localStorage or ComfyUI settings automatically: both are user-owned data.
import { app } from "../../../scripts/app.js";

const MIGRATION_MARKER = "wosai-preferences-preserved-v2";

function markPreferencesPreserved() {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(MIGRATION_MARKER)) return;
  try { localStorage.setItem(MIGRATION_MARKER, "done"); } catch (_) {}
}

app.registerExtension({
  name: "WOSAI.ResetDefaults",
  setup() {
    // Retained as a no-op migration for manifest compatibility with older builds.
    markPreferencesPreserved();
  },
});
