//! WebAssembly wrapper: the same JSON interface as the native build, nothing more.

use tpr_sim::Engine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Sim {
    e: Engine,
}

#[wasm_bindgen]
impl Sim {
    #[wasm_bindgen(constructor)]
    pub fn new(states_json: &str, pack_json: &str, content_json: &str, config_json: &str) -> Result<Sim, JsError> {
        Engine::new(states_json, pack_json, content_json, config_json).map(|e| Sim { e }).map_err(|e| JsError::new(&e))
    }
    pub fn load(save_json: &str, content_json: &str) -> Result<Sim, JsError> {
        Engine::load(save_json, content_json).map(|e| Sim { e }).map_err(|e| JsError::new(&e))
    }
    pub fn step(&mut self, days: u32) {
        self.e.step(days)
    }
    pub fn snapshot(&self) -> String {
        self.e.snapshot()
    }
    pub fn detail(&self, query: &str) -> String {
        self.e.detail(query)
    }
    pub fn command(&mut self, cmd: &str) -> String {
        self.e.command(cmd)
    }
    pub fn save(&self) -> String {
        self.e.save()
    }
}
