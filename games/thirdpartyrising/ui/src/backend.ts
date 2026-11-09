// One interface, two hosts. In a browser the simulation is the WebAssembly build; inside the
// installed (Tauri) game the same calls go to the native multi-threaded build.

export interface Backend {
  kind: "wasm" | "native";
  newGame(states: string, pack: string, content: string, config: string): Promise<void>;
  load(save: string, content: string): Promise<void>;
  step(days: number): Promise<void>;
  snapshot(): Promise<any>;
  detail(q: object): Promise<any>;
  command(c: object): Promise<{ ok: boolean; err?: string }>;
  save(): Promise<string>;
  saveToFile(name: string, text: string): Promise<string>;
}

function download(name: string, text: string): string {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return name;
}

async function wasmBackend(): Promise<Backend> {
  const mod = await import("./wasm/tpr_wasm.js");
  await mod.default();
  let sim: any = null;
  return {
    kind: "wasm",
    async newGame(states, pack, content, config) {
      sim?.free();
      sim = new mod.Sim(states, pack, content, config);
    },
    async load(save, content) {
      const next = mod.Sim.load(save, content);
      sim?.free();
      sim = next;
    },
    async step(days) { sim.step(days); },
    async snapshot() { return JSON.parse(sim.snapshot()); },
    async detail(q) { return JSON.parse(sim.detail(JSON.stringify(q))); },
    async command(c) { return JSON.parse(sim.command(JSON.stringify(c))); },
    async save() { return sim.save(); },
    async saveToFile(name, text) { return download(name, text); },
  };
}

function nativeBackend(invoke: (cmd: string, args?: any) => Promise<any>): Backend {
  return {
    kind: "native",
    newGame: (states, pack, content, config) => invoke("sim_new", { states, pack, content, config }),
    load: (save, content) => invoke("sim_load", { save, content }),
    step: (days) => invoke("sim_step", { days }),
    snapshot: async () => JSON.parse(await invoke("sim_snapshot")),
    detail: async (q) => JSON.parse(await invoke("sim_detail", { query: JSON.stringify(q) })),
    command: async (c) => JSON.parse(await invoke("sim_command", { cmd: JSON.stringify(c) })),
    save: () => invoke("sim_save"),
    saveToFile: (name, text) => invoke("save_file", { name, text }),
  };
}

export async function createBackend(): Promise<Backend> {
  const t = (window as any).__TAURI__;
  if (t?.core?.invoke) return nativeBackend(t.core.invoke);
  return wasmBackend();
}
