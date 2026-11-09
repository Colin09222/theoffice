// Builds the simulation to WebAssembly and writes the browser glue into ui/src/wasm.
// Needs: rustup target add wasm32-unknown-unknown; cargo install wasm-bindgen-cli --version 0.2.130 --locked
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
run("cargo", ["build", "-p", "tpr-wasm", "--release", "--target", "wasm32-unknown-unknown"]);
run("wasm-bindgen", ["--target", "web", "--out-dir", join("ui", "src", "wasm"), join("target", "wasm32-unknown-unknown", "release", "tpr_wasm.wasm")]);
console.log("wasm written to ui/src/wasm");
