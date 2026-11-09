//! Desktop shell. The interface is the same TypeScript as the browser build; here its calls go to
//! the native, multi-threaded simulation instead of WebAssembly. Nothing is sent anywhere.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Manager, State};
use tpr_sim::Engine;

struct Game(Mutex<Option<Engine>>);

fn with<T>(game: &State<Game>, f: impl FnOnce(&mut Engine) -> T) -> Result<T, String> {
    let mut g = game.0.lock().map_err(|_| "simulation lock poisoned".to_string())?;
    g.as_mut().map(f).ok_or_else(|| "no game is running".to_string())
}

#[tauri::command]
fn sim_new(game: State<Game>, states: String, pack: String, content: String, config: String) -> Result<(), String> {
    let e = Engine::new(&states, &pack, &content, &config)?;
    *game.0.lock().map_err(|_| "simulation lock poisoned".to_string())? = Some(e);
    Ok(())
}

#[tauri::command]
fn sim_load(game: State<Game>, save: String, content: String) -> Result<(), String> {
    let e = Engine::load(&save, &content)?;
    *game.0.lock().map_err(|_| "simulation lock poisoned".to_string())? = Some(e);
    Ok(())
}

#[tauri::command]
fn sim_step(game: State<Game>, days: u32) -> Result<(), String> {
    with(&game, |e| e.step(days.min(3660)))
}

#[tauri::command]
fn sim_snapshot(game: State<Game>) -> Result<String, String> {
    with(&game, |e| e.snapshot())
}

#[tauri::command]
fn sim_detail(game: State<Game>, query: String) -> Result<String, String> {
    with(&game, |e| e.detail(&query))
}

#[tauri::command]
fn sim_command(game: State<Game>, cmd: String) -> Result<String, String> {
    with(&game, |e| e.command(&cmd))
}

#[tauri::command]
fn sim_save(game: State<Game>) -> Result<String, String> {
    with(&game, |e| e.save())
}

/// Writes a save into Documents/Third Party Rising/saves and returns the full path.
#[tauri::command]
fn save_file(app: tauri::AppHandle, name: String, text: String) -> Result<String, String> {
    let clean: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')).collect();
    if clean.is_empty() || clean.starts_with('.') {
        return Err("bad file name".into());
    }
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Third Party Rising").join("saves");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(clean);
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn main() {
    tauri::Builder::default()
        .manage(Game(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![sim_new, sim_load, sim_step, sim_snapshot, sim_detail, sim_command, sim_save, save_file])
        .run(tauri::generate_context!())
        .expect("error while running Third Party Rising");
}
