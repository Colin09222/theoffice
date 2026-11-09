use tpr_sim::{Engine, P};
fn main() {
    let dir = "data";
    let rd = |f: &str| std::fs::read_to_string(format!("{dir}/{f}")).unwrap();
    let j = |f: &str| -> serde_json::Value { serde_json::from_str(&rd(f)).unwrap() };
    let issues = j("content/issues.json");
    let content = serde_json::json!({"issues": issues["issues"], "platforms": issues["platforms"], "events": j("content/events.json")["events"], "scandals": j("content/scandals.json")["scandals"], "bribes": j("content/bribes.json")["bribes"], "names": j("content/names.json")}).to_string();
    let st = std::env::args().nth(1).unwrap_or("OH".into());
    let cfg = serde_json::json!({"seed": 1, "aiOnly": true, "platform": [0,1,0,1,0,1,0,1]}).to_string();
    let mut e = Engine::new(&rd("states.json"), &rd(&format!("packs/{st}.json")), &content, &cfg).unwrap();
    for y in 0..60 {
        e.step(365);
        if y % 6 == 5 {
            let w = &e.world;
            let mut st = [0; 3];
            for p in &w.pols { st[p.status as usize] += 1; }
            let yr = w.year() as u16;
            let recent = w.seats.iter().filter(|s| s.last_year + 2 >= yr).count();
            let contested = w.seats.iter().filter(|s| s.last_year + 2 >= yr && s.last_share.iter().filter(|x| **x > 0.0).count() >= 2).count();
            let vac = w.seats.iter().filter(|s| s.holder < 0).count();
            println!("y{} pols free/bench/office {:?} recent elections {} contested {} vacant {}", yr, st, recent, contested, vac);
            for p in 4..P { let pt = &w.parties[p]; if pt.active { println!("   {} money {:.0} net {:.0} rep {:.2} heat {:.2} org {} qual {} sigs {:.0}/{:.0} ruined {} leader seat {} ops {}", pt.name, pt.money, pt.net, pt.rep, pt.heat, pt.organizers, pt.qualified, pt.sigs, w.need_sigs, pt.ruined, w.pols[pt.leader as usize].seat, pt.ops.iter().filter(|o| o.kind != 0).count()); } }
        }
    }
    let w = &e.world;
    let g = &w.seats[w.gov_seat as usize];
    println!("gov last {:?} holder party {}", g.last_share, g.holder_party);
}
