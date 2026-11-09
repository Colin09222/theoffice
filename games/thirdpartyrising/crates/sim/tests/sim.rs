//! Integration tests against the real data packs in data/.

use std::sync::atomic::Ordering;
use tpr_sim::{data, sim, world::*, Engine, COUNCIL, COUNTY, GOVERNOR, HOUSE, PLAYER, SENATE};

fn dir() -> String {
    format!("{}/../../data", env!("CARGO_MANIFEST_DIR"))
}
fn rd(f: &str) -> String {
    std::fs::read_to_string(format!("{}/{f}", dir())).unwrap_or_else(|e| panic!("{f}: {e}"))
}
fn engine(state: &str, seed: u64, ai_only: bool) -> Engine {
    let cfg = serde_json::json!({"seed": seed, "aiOnly": ai_only, "partyName": "Test Party", "leaderName": "Test Leader", "platform": [1, 0, 1, 0, 1, 0, 1, 0]}).to_string();
    Engine::new(&rd("states.json"), &rd(&format!("packs/{state}.json")), &data::content_bundle_from_dir(&dir()).unwrap(), &cfg).unwrap()
}
fn ok(e: &mut Engine, v: serde_json::Value) -> bool {
    e.command(&v.to_string()).contains("true")
}

#[test]
fn same_seed_same_world() {
    let (mut a, mut b, mut c) = (engine("OH", 11, true), engine("OH", 11, true), engine("OH", 12, true));
    a.step(365 * 6);
    b.step(365 * 6);
    c.step(365 * 6);
    assert!(a.save() == b.save(), "two runs from one seed diverged");
    assert!(a.save() != c.save(), "different seeds gave identical worlds");
}

#[test]
fn threads_do_not_change_the_result() {
    let mut a = engine("OH", 5, true);
    a.step(365 * 3);
    sim::PAR_MIN_COUNTIES.store(1, Ordering::Relaxed); // force the multi-threaded county pass
    let mut b = engine("OH", 5, true);
    b.step(365 * 3);
    sim::PAR_MIN_COUNTIES.store(1024, Ordering::Relaxed);
    assert!(a.save() == b.save(), "threaded and single-threaded runs diverged");
}

#[test]
fn save_and_load_round_trip() {
    let mut a = engine("VT", 3, true);
    a.step(800);
    let saved = a.save();
    let mut b = Engine::load(&saved, &data::content_bundle_from_dir(&dir()).unwrap()).unwrap();
    assert!(b.save() == saved);
    a.step(900);
    b.step(900);
    assert!(a.save() == b.save(), "a loaded game played on differently");
    assert!(Engine::load(&saved.replacen("\"version\":1", "\"version\":999", 1), "{}").is_err(), "wrong save version was accepted");
}

#[test]
fn real_seat_counts_and_calendars() {
    for (st, house, senate, gov_next, house_next) in [("OH", 99, 33, 2026, 2026), ("TX", 150, 31, 2026, 2026), ("NH", 400, 24, 2026, 2026), ("NE", 0, 49, 2026, 0), ("VA", 100, 40, 2025, 2025), ("NJ", 80, 40, 2025, 2025), ("MS", 122, 52, 2027, 2027), ("CA", 80, 40, 2026, 2026)] {
        let e = engine(st, 1, true);
        let n = |k: u8| e.world.seats.iter().filter(|s| s.kind == k).count();
        assert_eq!(n(HOUSE), house, "{st} house");
        assert_eq!(n(SENATE), senate, "{st} senate");
        assert_eq!(n(GOVERNOR), 1);
        assert_eq!(e.world.seats[e.world.gov_seat as usize].next_year, gov_next, "{st} governor");
        if house > 0 {
            assert_eq!(e.world.seats.iter().filter(|s| s.kind == HOUSE).map(|s| s.next_year).min().unwrap(), house_next, "{st} house cycle");
        }
    }
}

#[test]
fn real_people_get_no_invented_history() {
    let mut e = engine("OH", 9, true);
    assert!(e.world.real_names.iter().any(|n| n == "Mike DeWine"), "the sitting governor should start in office");
    assert!(e.world.real_names.len() > 100);
    for _ in 0..30 {
        e.step(365);
        for (i, p) in e.world.pols.iter().enumerate() {
            if p.real >= 0 && p.status != 0 {
                assert_eq!(p.taint, 0.0, "a real person was given a scandal");
                assert!(!e.world.parties.iter().any(|pt| pt.kind >= HUMAN && pt.leader == i as i32), "a real person leads a fictional party");
            }
        }
    }
    // With the option off, nobody real appears at all.
    let cfg = serde_json::json!({"seed": 1, "realNames": false}).to_string();
    let f = Engine::new(&rd("states.json"), &rd("packs/OH.json"), &data::content_bundle_from_dir(&dir()).unwrap(), &cfg).unwrap();
    assert!(f.world.real_names.is_empty());
}

#[test]
fn a_new_party_must_earn_its_ballot_line() {
    let mut e = engine("OH", 2, false);
    let w = &e.world;
    let home = w.home_arena as usize;
    let council = (0..w.seats.len()).find(|&s| w.seats[s].kind == COUNCIL && w.seats[s].area as usize == home && w.seats[s].next_year == 2025).unwrap();
    let county = (0..w.seats.len()).find(|&s| w.seats[s].kind == COUNTY && w.seats[s].next_year == 2026).unwrap();
    assert!(!w.parties[PLAYER].qualified);
    e.step(60);
    assert!(!ok(&mut e, serde_json::json!({"t": "file", "seat": county, "leader": true})), "filed for a partisan county race without ballot access");
    assert!(ok(&mut e, serde_json::json!({"t": "file", "seat": council, "leader": true})), "could not file for the local council");
    e.world.parties[PLAYER].money = 1e9;
    let need = e.world.need_sigs;
    assert!(ok(&mut e, serde_json::json!({"t": "sigs", "n": need})));
    assert!(e.world.parties[PLAYER].qualified);
    e.step(330); // into 2026, when filing for that November is open
    assert!(ok(&mut e, serde_json::json!({"t": "file", "seat": county, "leader": false})));
}

#[test]
fn world_never_grows() {
    let mut e = engine("OH", 4, true);
    let (bytes, pols, seats) = (e.world.heap_bytes(), e.world.pols.len(), e.world.seats.len());
    let early = e.save().len();
    e.step(365 * 40);
    assert_eq!(e.world.heap_bytes(), bytes);
    assert_eq!((e.world.pols.len(), e.world.seats.len(), e.world.log.len(), e.world.years.len()), (pols, seats, LOG, YEARS));
    assert!(e.save().len() < early * 2, "save file is growing without bound");
    assert!(e.world.seats.iter().all(|s| s.holder >= 0 || s.kind < HOUSE), "legislative seats were left empty");
}

#[test]
fn shortcuts_work_and_can_end_in_ruin() {
    let mut ruined = 0;
    for seed in 0..14 {
        let mut e = engine("OH", 1000 + seed * 7919, false);
        e.world.parties[PLAYER].money = 5e6;
        let before = e.world.parties[PLAYER].sigs;
        assert!(ok(&mut e, serde_json::json!({"t": "bribe", "i": 0})));
        assert!(e.world.parties[PLAYER].sigs > before, "the shortcut did nothing");
        assert!(e.world.parties[PLAYER].heat > 0.5);
        ok(&mut e, serde_json::json!({"t": "bribe", "i": 0}));
        ok(&mut e, serde_json::json!({"t": "bribe", "i": 1}));
        e.step(365 * 8);
        ruined += e.world.parties[PLAYER].ruined as u32;
    }
    assert!(ruined >= 3, "heavy use of shortcuts almost never led to charges ({ruined} of 14)");
    // And a party that never touches them is never investigated.
    let mut clean = engine("OH", 200, false);
    clean.step(365 * 8);
    assert_eq!(clean.world.parties[PLAYER].ruined, 0);
    assert_eq!(clean.world.parties[PLAYER].invest, 0);
}

#[test]
fn every_state_loads_and_runs_an_election() {
    let states: serde_json::Value = serde_json::from_str(&rd("states.json")).unwrap();
    for row in states["rows"].as_array().unwrap() {
        let st = row[0].as_str().unwrap();
        let mut e = engine(st, 7, true);
        e.step(700); // through the November 2025 and 2026 elections
        let snap: serde_json::Value = serde_json::from_str(&e.snapshot()).unwrap();
        assert_eq!(snap["usps"], st);
        let total: f32 = e.world.parties.iter().map(|p| p.statewide).sum();
        assert!((total - 1.0).abs() < 0.01, "{st}: support shares sum to {total}");
        assert!(e.world.seats.iter().any(|s| s.last_year >= 2025), "{st}: no election was held");
    }
}

#[test]
fn start_matches_real_returns() {
    // Ohio's 2016-2024 presidential average is roughly 45-46% Democratic of the two-party vote; a
    // world left alone for a year should still look like the data it was seeded from.
    let mut e = engine("OH", 1, true);
    let d0 = e.world.parties[0].statewide;
    assert!(d0 > 0.42 && d0 < 0.48, "Ohio starts at {d0}");
    e.step(365);
    let c = e.world.arenas.iter().map(|a| a.county as usize).next().unwrap();
    let drift = (e.world.support[c * 8] - e.world.anchor[c * 8]).abs();
    assert!(drift < 0.08, "a county drifted {drift} from its real baseline within a year");
}
