use std::time::Instant;
use tpr_sim::Engine;
fn main() {
    let dir = "data";
    let rd = |f: &str| std::fs::read_to_string(format!("{dir}/{f}")).unwrap();
    let content = tpr_sim::data::content_bundle_from_dir(dir).unwrap();
    let cfg = serde_json::json!({"seed": 2, "aiOnly": true, "platform": [0,1,0,1,0,1,0,1]}).to_string();
    let mut e = Engine::new(&rd("states.json"), &rd("packs/OH.json"), &content, &cfg).unwrap();
    e.step(365 * 90);
    // per-day timing histogram over one year
    let mut ts = Vec::new();
    for d in 0..730 { let t = Instant::now(); e.step(1); ts.push((t.elapsed().as_nanos() as u64, d)); }
    let total: u64 = ts.iter().map(|x| x.0).sum();
    ts.sort();
    println!("total {}us median {}ns p90 {}ns max {:?} top5 {:?}", total / 1000, ts[365].0, ts[657].0, ts[729], &ts[724..]);
    let top: u64 = ts[700..].iter().map(|x| x.0).sum();
    println!("top30 days share {:.0}%", top as f64 / total as f64 * 100.0);
}
