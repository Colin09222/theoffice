//! Headless AI-only runner.
//!
//!   tpr-headless [--state OH] [--years 100] [--seed 1] [--data DIR] [--json]
//!
//! Plays the given number of in-game years with every party run by the AI and reports days per
//! second in year 1 and in the final year, plus memory use.

use std::time::Instant;
use tpr_sim::{Engine, P};

fn arg(name: &str, default: &str) -> String {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned()).unwrap_or(default.to_string())
}

/// Resident memory in bytes where the platform exposes it cheaply (Linux), else 0.
fn rss() -> usize {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| s.lines().find(|l| l.starts_with("VmRSS:")).and_then(|l| l.split_whitespace().nth(1).and_then(|v| v.parse::<usize>().ok())))
        .map(|kb| kb * 1024)
        .unwrap_or(0)
}

pub fn content_bundle(dir: &str) -> Result<String, String> {
    let rd = |f: &str| -> Result<serde_json::Value, String> {
        let t = std::fs::read_to_string(format!("{dir}/content/{f}")).map_err(|e| format!("{f}: {e}"))?;
        serde_json::from_str(&t).map_err(|e| format!("{f}: {e}"))
    };
    let issues = rd("issues.json")?;
    Ok(serde_json::json!({
        "issues": issues["issues"], "platforms": issues["platforms"],
        "events": rd("events.json")?["events"], "scandals": rd("scandals.json")?["scandals"],
        "bribes": rd("bribes.json")?["bribes"], "names": rd("names.json")?,
    })
    .to_string())
}

fn main() {
    let state = arg("--state", "OH");
    let years: i32 = arg("--years", "100").parse().unwrap_or(100);
    let seed: u64 = arg("--seed", "1").parse().unwrap_or(1);
    let dir = arg("--data", "data");
    let json = std::env::args().any(|a| a == "--json");
    let run = || -> Result<(), String> {
        let states = std::fs::read_to_string(format!("{dir}/states.json")).map_err(|e| e.to_string())?;
        let pack = std::fs::read_to_string(format!("{dir}/packs/{state}.json")).map_err(|e| format!("pack {state}: {e}"))?;
        let content = content_bundle(&dir)?;
        let cfg = serde_json::json!({"seed": seed, "aiOnly": true, "partyName": "Test Party", "platform": [0, 1, 0, 1, 0, 1, 0, 1]}).to_string();
        let mut e = Engine::new(&states, &pack, &content, &cfg)?;
        let (rss0, heap0) = (rss(), e.world.heap_bytes());
        let mut dps = Vec::new();
        for y in 0..years {
            let t = Instant::now();
            e.step(365);
            dps.push(365.0 / t.elapsed().as_secs_f64());
            if !json && (y < 3 || (y + 1) % 10 == 0) {
                let w = &e.world;
                let seats = |p: usize| w.parties[p].seats.iter().map(|x| *x as u32).sum::<u32>();
                let line: Vec<String> = (0..P).filter(|&p| w.parties[p].active).map(|p| format!("{}:{:.1}%/{}", &w.parties[p].name.chars().take(10).collect::<String>(), w.parties[p].statewide * 100.0, seats(p))).collect();
                println!("year {:3}  {:9.0} days/s  {}", y + 1, dps[y as usize], line.join("  "));
            }
        }
        // Median of a few years at each end, so one noisy year cannot decide the result.
        let med = |v: &[f64]| { let mut s = v.to_vec(); s.sort_by(|a, b| a.partial_cmp(b).unwrap()); s[s.len() / 2] };
        let n = (years as usize).min(5).max(1);
        let (first, last) = (med(&dps[..n]), med(&dps[dps.len() - n..]));
        let (rss1, heap1) = (rss(), e.world.heap_bytes());
        let save = e.save().len();
        let slow = (1.0 - last / first) * 100.0;
        if json {
            println!("{}", serde_json::json!({"state": state, "years": years, "seed": seed, "counties": e.world.nc, "seats": e.world.seats.len(), "politicians": e.world.pols.len(),
                "dpsYear1": dps[0], "dpsFirst": first, "dpsLast": last, "dpsFinalYear": dps[dps.len() - 1], "slowdownPct": slow, "worldBytesStart": heap0, "worldBytesEnd": heap1, "rssStart": rss0, "rssEnd": rss1, "saveBytes": save}));
        } else {
            println!("\n{state}: {} counties, {} seats, {} politician slots, {years} years, seed {seed}", e.world.nc, e.world.seats.len(), e.world.pols.len());
            println!("days/second  year 1: {:.0}   final year: {:.0}", dps[0], dps[dps.len() - 1]);
            println!("days/second  median of first {n} years: {first:.0}   median of last {n} years: {last:.0}   slowdown: {slow:.1}%");
            println!("world state  start: {heap0} bytes   end: {heap1} bytes   (fixed size)");
            println!("process RSS  start: {:.1} MB   end: {:.1} MB   save file: {:.0} KB", rss0 as f64 / 1e6, rss1 as f64 / 1e6, save as f64 / 1e3);
        }
        Ok(())
    };
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
