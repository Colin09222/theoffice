//! A scripted "sensible human" playing through the public command interface, to check that the
//! ladder from a town council to the governor's office can actually be climbed.
//!   cargo run --release -p tpr-headless --example climb -- OH 3982000 7 60
use tpr_sim::{sim, world::*, Engine, GOVERNOR, MAYOR, P, PLAYER};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let st = a.get(1).cloned().unwrap_or("OH".into());
    let home = a.get(2).cloned().unwrap_or_default();
    let seed: u64 = a.get(3).and_then(|x| x.parse().ok()).unwrap_or(7);
    let years: i32 = a.get(4).and_then(|x| x.parse().ok()).unwrap_or(60);
    let dir = "data";
    let rd = |f: &str| std::fs::read_to_string(format!("{dir}/{f}")).unwrap();
    let j = |f: &str| -> serde_json::Value { serde_json::from_str(&rd(f)).unwrap() };
    let issues = j("content/issues.json");
    let content = serde_json::json!({"issues": issues["issues"], "platforms": issues["platforms"], "events": j("content/events.json")["events"], "scandals": j("content/scandals.json")["scandals"], "bribes": j("content/bribes.json")["bribes"], "names": j("content/names.json")}).to_string();
    // Platform: start from the home county's own views (a player can read them on the County tab).
    let probe = Engine::new(&rd("states.json"), &rd(&format!("packs/{st}.json")), &content, &serde_json::json!({"seed": seed, "homePlace": home}).to_string()).unwrap();
    let hc = probe.world.arenas[probe.world.home_arena as usize].county as usize;
    let plat: Vec<i8> = (0..8).map(|k| probe.world.ideal[hc * 8 + k].round() as i8).collect();
    let cfg = serde_json::json!({"seed": seed, "homePlace": home, "partyName": "Climbers", "leaderName": "Pat Climber", "platform": plat}).to_string();
    let mut e = Engine::new(&rd("states.json"), &rd(&format!("packs/{st}.json")), &content, &cfg).unwrap();
    let cmd = |e: &mut Engine, v: serde_json::Value| e.command(&v.to_string()).contains("true");
    let ha = e.world.home_arena as usize;
    let mut top = -1i32;
    let mut last_seat = -1;
    for day in 0..years * 365 {
        e.step(1);
        let w = &e.world;
        let me = &w.parties[PLAYER];
        let (money, qualified, leader, race) = (me.money, me.qualified, me.leader, me.race);
        let free = sim::slots(me) - me.ops.iter().filter(|o| o.kind != OP_NONE).count();
        for s in 0..PENDING { if e.world.pending[s].active { cmd(&mut e, serde_json::json!({"t": "choose", "slot": s, "choice": 0})); } }
        let w = &e.world;
        let lseat = w.pols[leader as usize].seat;
        if lseat != last_seat {
            last_seat = lseat;
            if lseat >= 0 { let k = w.seats[lseat as usize].kind as i32; top = top.max(k); println!("{:?}  leader takes office: kind {} (seat {})  statewide {:.1}%  money {:.0}", tpr_sim::cal::ymd(w.day), k, lseat, w.parties[PLAYER].statewide * 100.0, money); }
        }
        let cur_kind = if lseat >= 0 { w.seats[lseat as usize].kind as i32 } else { -1 };
        // Filing: the highest office within reach that the leader would be competitive for.
        if race < 0 && day % 7 == 0 && !w.seats.iter().any(|s| s.elect == leader) {
            let mut cands: Vec<usize> = (0..w.seats.len()).filter(|&s| {
                let x = &w.seats[s]; let d = sim::seat_election_day(x) - w.day;
                let near = match x.kind { 0 | 1 => x.area as usize == ha, GOVERNOR => true, _ => w.seat_covers(x, hc) };
                near && d > sim::FILE_DEADLINE + 1 && d < 300 && (x.kind as i32 > cur_kind || s as i32 == lseat) && (x.kind <= MAYOR || qualified)
            }).collect();
            cands.sort_by_key(|&s| std::cmp::Reverse(e.world.seats[s].kind));
            for s in cands {
                if !cmd(&mut e, serde_json::json!({"t": "file", "seat": s, "leader": true})) { continue; }
                let sh = sim::seat_poll(&e.world, s);
                let lead = sh.iter().cloned().fold(0f32, f32::max);
                let kind = e.world.seats[s].kind;
                if std::env::var("DBG").is_ok() { println!("  {:?} try kind {} share {:.2} lead {:.2}", tpr_sim::cal::ymd(e.world.day), kind, sh[PLAYER], lead); }
                if sh[PLAYER] > lead * if kind == 0 { 0.0 } else { 0.3 } { break; }
                cmd(&mut e, serde_json::json!({"t": "withdraw", "seat": s}));
            }
        }
        let w = &e.world;
        let me = &w.parties[PLAYER];
        if me.organizers < 10 && money > 6000.0 + me.organizers as f64 * 5000.0 && me.net > 120.0 * me.organizers as f32 - 200.0 { cmd(&mut e, serde_json::json!({"t": "hire", "n": 1})); }
        let w = &e.world;
        let short = (w.need_sigs - w.parties[PLAYER].sigs) as f64 + 1.0;
        if !qualified && money > 25_000.0 { cmd(&mut e, serde_json::json!({"t": "sigs", "n": ((money - 8000.0) / 4.5).min(short)})); }
        if free == 0 { continue; }
        let w = &e.world;
        let op = |kind: u8, target: usize, arg: i32| serde_json::json!({"t": "op", "kind": kind, "target": target, "arg": arg});
        let busy = |kind: u8, target: usize| w.parties[PLAYER].ops.iter().any(|o| o.kind == kind && o.target == target as i32);
        let race = w.parties[PLAYER].race;
        let mut todo = None;
        if money < 1200.0 {
            let best = (0..w.nc).max_by(|&a, &b| (w.support[a * P + PLAYER] * w.pop[a]).partial_cmp(&(w.support[b * P + PLAYER] * w.pop[b])).unwrap()).unwrap();
            if !busy(OP_FUNDRAISE, best) { todo = Some(op(OP_FUNDRAISE, best, -1)); }
        }
        if todo.is_none() && race >= 0 {
            let s = &w.seats[race as usize];
            let d = sim::seat_election_day(s) - w.day;
            if d < 240 && s.camp[PLAYER] < 1.55 && money > 3000.0f64.min(sim::op_cost(w, OP_CAMPAIGN, race) as f64 * 2.0) && !w.parties[PLAYER].ops.iter().any(|o| o.kind == OP_CAMPAIGN) { todo = Some(op(OP_CAMPAIGN, 0, race)); }
            else if s.kind <= MAYOR && w.arenas[ha].roots[PLAYER] < 2.4 && !busy(OP_TOWN, ha) { todo = Some(op(OP_TOWN, ha, -1)); }
        }
        if todo.is_none() {
            // Work outwards from home: counties ordered by how well the platform fits.
            let mut order: Vec<usize> = (0..w.nc).collect();
            order.sort_by(|&a, &b| { let f = |c: usize| w.appeal[c * P + PLAYER] - w.cal[c * P + PLAYER] + if c == hc { 5.0 } else { 0.0 } + w.support[c * P + PLAYER] * 3.0; f(b).partial_cmp(&f(a)).unwrap() });
            for &c in order.iter().take(3 + w.parties[PLAYER].organizers as usize * 2) {
                let i = c * P + PLAYER;
                let cap = w.support[i] * w.pop[c] * 0.004 + 12.0;
                if w.org[i] < cap * 0.8 && money > 800.0 && !busy(OP_RECRUIT, c) { todo = Some(op(OP_RECRUIT, c, -1)); break; }
                if w.aware[i] < 0.85 && !busy(OP_CANVASS, c) { todo = Some(op(OP_CANVASS, c, -1)); break; }
                if !qualified && w.org[i] > 10.0 && !busy(OP_PETITION, c) && money > 500.0 { todo = Some(op(OP_PETITION, c, -1)); break; }
                if w.press[i] < 1.0 && !busy(OP_CANVASS, c) { todo = Some(op(OP_CANVASS, c, -1)); break; }
            }
        }
        if todo.is_none() && money > 4000.0 && !busy(OP_DONOR, hc) { todo = Some(op(OP_DONOR, hc, -1)); }
        if let Some(t) = todo { cmd(&mut e, t); }
        // Recruit candidates where the party is strong, a week before the deadline.
        let w = &e.world;
        let ed = tpr_sim::cal::election_day(w.year());
        if w.day == ed - sim::FILE_DEADLINE - 7 {
            let picks: Vec<usize> = (0..w.seats.len()).filter(|&s| { let x = &w.seats[s]; x.next_year as i32 == w.year() && x.cand[PLAYER] < 0 && (x.kind <= MAYOR && w.arenas[x.area as usize].roots[PLAYER] > 0.8 || x.kind > MAYOR && qualified && (x.kind == GOVERNOR || w.support[x.area as usize * P + PLAYER] > 0.12)) }).collect();
            for s in picks { if e.world.parties[PLAYER].money > 6000.0 { cmd(&mut e, serde_json::json!({"t": "file", "seat": s, "leader": false})); } }
        }
        if day % 1825 == 1824 { let w = &e.world; let me = &w.parties[PLAYER]; println!("{:?}  statewide {:.1}%  seats {:?}  money {:.0}  qualified {}  home support {:.1}%", tpr_sim::cal::ymd(w.day), me.statewide * 100.0, me.seats, me.money, me.qualified, w.support[hc * P + PLAYER] * 100.0); }
    }
    println!("highest office reached by the leader: {}", ["none", "city council", "mayor", "county commission", "state house", "state senate", "GOVERNOR"][(top + 1) as usize]);
}
