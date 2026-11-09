//! The one interface every host uses (native Tauri commands, WebAssembly, the headless runner):
//! JSON text in, JSON text out. Keeping it this narrow is what lets the same interface code run
//! in the installed game and in a plain browser.

use crate::data::*;
use crate::sim;
use crate::world::*;
use crate::*;
use serde_json::{json, Value};

pub struct Engine {
    pub world: World,
    pub content: Content,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct SaveFile {
    game: String,
    version: u32,
    world: World,
}

fn r4(x: f32) -> f32 {
    (x * 10_000.0).round() / 10_000.0
}

impl Engine {
    pub fn new(states_json: &str, pack_json: &str, content_json: &str, config_json: &str) -> Result<Engine, String> {
        let pack: Pack = serde_json::from_str(pack_json).map_err(|e| format!("state pack: {e}"))?;
        let content: Content = serde_json::from_str(content_json).map_err(|e| format!("content: {e}"))?;
        let cfg: Config = serde_json::from_str(config_json).map_err(|e| format!("config: {e}"))?;
        let rules = state_rules(states_json, &pack.usps)?;
        if pack.house.len() != rules.house || pack.senate.len() != rules.senate {
            return Err(format!("pack seat counts ({}, {}) do not match states.json ({}, {})", pack.house.len(), pack.senate.len(), rules.house, rules.senate));
        }
        let world = World::new(&pack, &rules, &content, &cfg)?;
        Ok(Engine { world, content })
    }

    /// Saves are versioned JSON. Content (events, text) is not saved; it is reloaded from data.
    pub fn save(&self) -> String {
        serde_json::to_string(&SaveFile { game: "third-party-rising".into(), version: SAVE_VERSION, world: self.world.clone() }).unwrap_or_default()
    }

    pub fn load(save_json: &str, content_json: &str) -> Result<Engine, String> {
        let head: Value = serde_json::from_str(save_json).map_err(|e| format!("save file: {e}"))?;
        if head["game"] != "third-party-rising" {
            return Err("not a Third Party Rising save file".into());
        }
        let v = head["version"].as_u64().unwrap_or(0) as u32;
        if v != SAVE_VERSION {
            return Err(format!("save version {v} is not supported by this build (expects {SAVE_VERSION})"));
        }
        let sf: SaveFile = serde_json::from_value(head).map_err(|e| format!("save file: {e}"))?;
        let content: Content = serde_json::from_str(content_json).map_err(|e| format!("content: {e}"))?;
        Ok(Engine { world: sf.world, content })
    }

    pub fn step(&mut self, days: u32) {
        for _ in 0..days {
            sim::step(&mut self.world, &self.content);
        }
    }

    pub fn pol_name(&self, i: i32) -> String {
        if i < 0 || i as usize >= self.world.pols.len() {
            return String::new();
        }
        let p = &self.world.pols[i as usize];
        if p.real >= 0 {
            return self.world.real_names[p.real as usize].clone();
        }
        if i == self.world.parties[PLAYER].leader && self.world.parties[PLAYER].ruined == 0 && !self.world.player_name.trim().is_empty() && (cal::ymd(self.world.day).0 - p.born as i32) < 76 {
            return self.world.player_name.clone();
        }
        let n = &self.content.names;
        format!("{} {}", n.first[p.first as usize % n.first.len()], n.last[p.last as usize % n.last.len()])
    }

    fn pol_json(&self, i: i32) -> Value {
        if i < 0 {
            return Value::Null;
        }
        let p = &self.world.pols[i as usize];
        let real = p.real >= 0;
        // Nothing but name, party and office is ever reported for a real person.
        json!({
            "i": i, "name": self.pol_name(i), "party": p.party, "real": real, "seat": p.seat,
            "age": if real { Value::Null } else { json!(self.world.year() - p.born as i32) },
            "cha": if real { Value::Null } else { json!(p.cha) },
            "skl": if real { Value::Null } else { json!(p.skl) },
            "int": if real { Value::Null } else { json!(p.int) },
            "recog": r4(p.recog), "taint": if real { 0.0 } else { r4(p.taint) }, "wins": p.wins, "losses": p.losses,
        })
    }

    fn seat_json(&self, s: usize, poll: bool) -> Value {
        let w = &self.world;
        let seat = &w.seats[s];
        let cands: Vec<Value> = (0..P).filter(|&p| seat.cand[p] != NONE).map(|p| json!({"p": p, "pol": self.pol_json(seat.cand[p]), "camp": r4(seat.camp[p])})).collect();
        let mut v = json!({
            "i": s, "kind": seat.kind, "area": seat.area, "ord": seat.ord, "next": seat.next_year, "term": seat.term,
            "electionDay": sim::seat_election_day(seat), "voters": seat.voters.round(),
            "counties": seat.mix.iter().filter(|m| m.1 > 0.0).map(|m| m.0).collect::<Vec<u16>>(),
            "holder": self.pol_json(seat.holder), "holderParty": seat.holder_party,
            "elect": self.pol_json(seat.elect), "electParty": seat.elect_party,
            "cands": cands, "lastYear": seat.last_year, "lastShare": seat.last_share.map(r4),
        });
        if poll {
            v["poll"] = json!(sim::seat_poll(w, s).map(r4));
        }
        v
    }

    /// The light view the interface polls several times a second.
    pub fn snapshot(&self) -> String {
        let w = &self.world;
        let (y, m, d, _) = cal::ymd(w.day);
        let mut ed = cal::election_day(y);
        if ed < w.day {
            ed = cal::election_day(y + 1);
        }
        let parties: Vec<Value> = (0..P)
            .map(|p| {
                let pt = &w.parties[p];
                let own = p == PLAYER;
                json!({
                    "id": p, "active": pt.active, "kind": pt.kind, "name": pt.name, "color": pt.color, "qualified": pt.qualified,
                    "sigs": pt.sigs.round(), "rep": r4(pt.rep), "platform": pt.platform, "leader": self.pol_json(pt.leader),
                    "seats": pt.seats, "statewide": r4(pt.statewide), "home": pt.home, "founded": pt.founded, "ruined": pt.ruined,
                    "investigated": pt.invest > 0,
                    // Private books: only the player's own are exposed.
                    "money": if own { json!(pt.money.round()) } else { Value::Null },
                    "net": if own { json!(pt.net.round()) } else { Value::Null },
                    "heat": if own { json!(r4(pt.heat)) } else { Value::Null },
                    "donors": if own { json!(pt.donors) } else { Value::Null },
                    "organizers": if own { json!(pt.organizers) } else { Value::Null },
                })
            })
            .collect();
        let pl = &w.parties[PLAYER];
        let row = |a: &Vec<f32>| -> Vec<f32> { (0..w.nc).map(|c| r4(a[c * P + PLAYER])).collect() };
        let ops: Vec<Value> = pl.ops.iter().enumerate().filter(|(_, o)| o.kind != OP_NONE).map(|(i, o)| json!({"slot": i, "kind": o.kind, "target": o.target, "arg": o.arg, "left": o.left, "total": OP_SPEC[o.kind as usize].0, "repeat": o.repeat})).collect();
        let races: Vec<Value> = (0..w.seats.len()).filter(|&s| w.seats[s].cand[PLAYER] != NONE || w.seats[s].elect_party == PLAYER as u8).map(|s| self.seat_json(s, true)).collect();
        let pending: Vec<Value> = w.pending.iter().enumerate().filter(|(_, e)| e.active).map(|(i, e)| json!({"slot": i, "event": self.content.events[e.event as usize].id, "day": e.day})).collect();
        let n = (w.log_n as usize).min(60);
        let log: Vec<Value> = (0..n)
            .map(|k| {
                let e = &w.log[(w.log_n as usize - 1 - k) % LOG];
                let pol = match e.kind {
                    L_ELECTED | L_DEFEATED | L_FILED => e.b,
                    L_SCANDAL | L_RETIRED => e.a,
                    _ => NONE,
                };
                json!({"n": w.log_n as usize - 1 - k, "day": e.day, "kind": e.kind, "a": e.a, "b": e.b, "c": e.c, "f": r4(e.f), "name": self.pol_name(pol)})
            })
            .collect();
        let arenas: Vec<Value> = w.arenas.iter().map(|a| json!({"place": a.place, "county": a.county, "roots": r4(a.roots[PLAYER]), "mayor": a.mayor, "council0": a.council0, "councilN": a.council_n})).collect();
        json!({
            "day": w.day, "date": [y, m, d], "usps": w.usps, "electionDay": ed, "seed": w.seed.to_string(),
            "need": w.need_sigs, "retain": w.retain, "parties": parties, "mood": w.mood.map(r4),
            "support": w.support.iter().map(|x| r4(*x)).collect::<Vec<f32>>(),
            "aware": row(&w.aware), "org": row(&w.org), "press": row(&w.press),
            "arenas": arenas, "homeArena": w.home_arena, "govSeat": w.gov_seat,
            "ops": ops, "slots": sim::slots(pl), "races": races, "pending": pending, "log": log,
            "fileDeadline": sim::FILE_DEADLINE, "sigPrice": sim::SIG_PRICE,
        })
        .to_string()
    }

    /// Heavier, on-demand views. `q` is {"t": "seats", "kind": n} | {"t": "seat", "i": n} |
    /// {"t": "history"} | {"t": "county", "i": n} | {"t": "costs"}.
    pub fn detail(&self, q: &str) -> String {
        let w = &self.world;
        let q: Value = serde_json::from_str(q).unwrap_or(Value::Null);
        match q["t"].as_str().unwrap_or("") {
            "seats" => {
                let kind = q["kind"].as_i64().unwrap_or(-1);
                let area = q["area"].as_i64().unwrap_or(-1);
                let list: Vec<Value> = (0..w.seats.len()).filter(|&s| (kind < 0 || w.seats[s].kind as i64 == kind) && (area < 0 || w.seats[s].area as i64 == area)).map(|s| self.seat_json(s, false)).collect();
                json!(list).to_string()
            }
            "seat" => {
                let i = q["i"].as_u64().unwrap_or(0) as usize;
                if i < w.seats.len() { self.seat_json(i, true).to_string() } else { "null".into() }
            }
            "history" => {
                let n = (w.years_n as usize).min(YEARS);
                let rows: Vec<&YearRow> = (0..n).map(|k| &w.years[(w.years_n as usize - n + k) % YEARS]).collect();
                json!(rows).to_string()
            }
            "county" => {
                let c = (q["i"].as_u64().unwrap_or(0) as usize).min(w.nc - 1);
                let r = c * P..c * P + P;
                let seats: Vec<Value> = (0..w.seats.len()).filter(|&s| w.seats[s].kind >= COUNTY && w.seats[s].kind < GOVERNOR && w.seat_covers(&w.seats[s], c)).map(|s| self.seat_json(s, false)).collect();
                json!({
                    "i": c, "pop": w.pop[c], "support": w.support[r.clone()].iter().map(|x| r4(*x)).collect::<Vec<_>>(),
                    "aware": r4(w.aware[c * P + PLAYER]), "org": r4(w.org[c * P + PLAYER]), "press": r4(w.press[c * P + PLAYER]),
                    "ideal": w.ideal[c * K..c * K + K].iter().map(|x| r4(*x)).collect::<Vec<_>>(),
                    "adCost": sim::ad_cost(w, c as i32, 1).round(), "seats": seats,
                })
                .to_string()
            }
            "costs" => json!({
                "ops": OP_SPEC.iter().map(|(d, c)| json!({"days": d, "cost": c})).collect::<Vec<_>>(),
                "adState": sim::ad_cost(w, -1, 1).round(), "sig": sim::SIG_PRICE, "recruit": sim::RECRUIT_COST, "campaign": sim::CAMPAIGN_COST,
                "bribes": self.content.bribes.iter().map(|b| (b.cost + b.cost_per_need * w.need_sigs).round()).collect::<Vec<_>>(),
            })
            .to_string(),
            _ => "null".into(),
        }
    }

    /// Player commands. Returns {"ok": true} or {"ok": false, "err": "..."}.
    pub fn command(&mut self, cmd: &str) -> String {
        let q: Value = match serde_json::from_str(cmd) {
            Ok(v) => v,
            Err(e) => return json!({"ok": false, "err": e.to_string()}).to_string(),
        };
        let i = |k: &str| q[k].as_i64().unwrap_or(-1) as i32;
        let b = |k: &str| q[k].as_bool().unwrap_or(false);
        let w = &mut self.world;
        let p = PLAYER;
        let res: Result<(), &'static str> = match q["t"].as_str().unwrap_or("") {
            "op" => sim::start_op(w, p, i("kind").max(0) as u8, i("target"), i("arg"), b("repeat")),
            "cancel" => {
                let s = i("slot");
                if s >= 0 && (s as usize) < OPS {
                    w.parties[p].ops[s as usize] = Op::default();
                    Ok(())
                } else {
                    Err("no such slot")
                }
            }
            "ads" => sim::buy_ads(w, p, i("county"), i("tier")),
            "sigs" => sim::buy_sigs(w, p, q["n"].as_f64().unwrap_or(0.0) as f32),
            "hire" => {
                let n = i("n");
                let pt = &mut w.parties[p];
                if n > 0 && pt.organizers < 10 {
                    if pt.money < 1500.0 {
                        Err("not enough money (an organizer needs $1,500 up front, then $100 a day)")
                    } else {
                        pt.money -= 1500.0;
                        pt.organizers += 1;
                        Ok(())
                    }
                } else if n < 0 && pt.organizers > 0 {
                    pt.organizers -= 1;
                    Ok(())
                } else {
                    Err("cannot change staff")
                }
            }
            "bribe" => sim::bribe(w, &self.content, p, i("i").max(0) as usize),
            "file" => sim::file(w, p, i("seat").max(0) as usize, b("leader"), sim::FILE_DEADLINE).map(|_| ()),
            "withdraw" => sim::withdraw(w, p, i("seat").max(0) as usize),
            "platform" => sim::set_platform(w, p, i("issue").max(0) as usize, i("pos") as i8),
            "choose" => sim::choose_event(w, &self.content, i("slot").max(0) as usize, i("choice").max(0) as usize),
            _ => Err("unknown command"),
        };
        match res {
            Ok(()) => r#"{"ok":true}"#.to_string(),
            Err(e) => json!({"ok": false, "err": e}).to_string(),
        }
    }
}
