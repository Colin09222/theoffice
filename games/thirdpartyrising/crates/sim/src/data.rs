//! Input data: the per-state pack (real geography, demographics, returns), the state rules table,
//! and the content bundle (issues, events, scandals, bribes, names). All of it is JSON written by
//! tools or by hand; none of it is compiled into the simulation.

use crate::{K, P};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Deserialize)]
pub struct Pack {
    pub usps: String,
    pub name: String,
    pub pop: f64,
    pub counties: Vec<PCounty>,
    pub places: Vec<PPlace>,
    #[serde(default)]
    pub house: Vec<PSeat>,
    #[serde(default)]
    pub senate: Vec<PSeat>,
}
#[derive(Deserialize)]
pub struct PCounty {
    pub name: String,
    pub pop: f64,
    #[serde(rename = "landKm2")]
    pub land_km2: Option<f64>,
    pub income: Option<f64>,
    pub age: Option<f64>,
    pub bach: Option<f64>,
    #[serde(default)]
    pub pres: BTreeMap<String, [f64; 3]>,
    /// District shape containing this county's internal point (see tools/data/link.mjs).
    #[serde(default)]
    pub house: Option<usize>,
    #[serde(default)]
    pub senate: Option<usize>,
}
#[derive(Deserialize)]
pub struct PPlace {
    pub geoid: String,
    pub name: String,
    pub pop: f64,
    #[serde(rename = "landKm2")]
    pub land_km2: Option<f64>,
    pub county: usize,
}
#[derive(Deserialize)]
pub struct PSeat {
    #[serde(default)]
    pub shape: usize,
    #[serde(rename = "landKm2")]
    pub land_km2: Option<f64>,
    pub county: usize,
    pub inc: Option<PInc>,
}
#[derive(Deserialize)]
pub struct PInc {
    pub name: String,
    pub party: String,
}

/// One row of data/states.json, by column name.
#[derive(Clone, Debug)]
pub struct StateRules {
    pub usps: String,
    pub house: usize,
    pub senate: usize,
    pub house_cycle: String,
    pub senate_cycle: String,
    pub gov_term: i32,
    pub gov_next: i32,
    pub sigs: f32,
    pub retain: f32,
    pub governor: String,
    pub gov_party: String,
    pub lp: bool,
    pub gp: bool,
}

pub fn state_rules(states_json: &str, usps: &str) -> Result<StateRules, String> {
    let v: serde_json::Value = serde_json::from_str(states_json).map_err(|e| format!("states.json: {e}"))?;
    let cols: Vec<String> = v["columns"].as_array().ok_or("states.json: columns")?.iter().map(|c| c.as_str().unwrap_or("").to_string()).collect();
    let ix = |n: &str| cols.iter().position(|c| c == n).ok_or(format!("states.json: no column {n}"));
    for row in v["rows"].as_array().ok_or("states.json: rows")? {
        if row[ix("usps")?].as_str() != Some(usps) {
            continue;
        }
        let s = |n: &str| -> Result<String, String> { Ok(row[ix(n)?].as_str().unwrap_or("").to_string()) };
        let f = |n: &str| -> Result<f64, String> { Ok(row[ix(n)?].as_f64().unwrap_or(0.0)) };
        return Ok(StateRules {
            usps: usps.to_string(),
            house: f("house")? as usize,
            senate: f("senate")? as usize,
            house_cycle: s("houseCycle")?,
            senate_cycle: s("senateCycle")?,
            gov_term: f("govTerm")? as i32,
            gov_next: f("govNext")? as i32,
            sigs: f("sigs")? as f32,
            retain: f("retain")? as f32,
            governor: s("governor")?,
            gov_party: s("govParty")?,
            lp: f("lp")? > 0.0,
            gp: f("gp")? > 0.0,
        });
    }
    Err(format!("states.json: no state {usps}"))
}

// ---------------------------------------------------------------- content bundle

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct Content {
    pub issues: Vec<Issue>,
    #[serde(default)]
    pub platforms: BTreeMap<String, [i8; K]>,
    #[serde(default)]
    pub events: Vec<EventDef>,
    #[serde(default)]
    pub scandals: Vec<ScandalDef>,
    #[serde(default)]
    pub bribes: Vec<BribeDef>,
    pub names: Names,
}
/// A policy axis. `w` says how a county's ideal position is estimated from its real data:
/// [partisan lean, density, income, median age, college share]. These weights are a game
/// abstraction, not a measurement.
#[derive(Deserialize, Serialize, Clone)]
pub struct Issue {
    pub id: String,
    pub w: [f32; 5],
    #[serde(default = "one")]
    pub salience: f32,
}
fn one() -> f32 {
    1.0
}
#[derive(Deserialize, Serialize, Clone, Default)]
pub struct Names {
    pub first: Vec<String>,
    pub last: Vec<String>,
    #[serde(rename = "partyA")]
    pub party_a: Vec<String>,
    #[serde(rename = "partyB")]
    pub party_b: Vec<String>,
}
#[derive(Deserialize, Serialize, Clone, Default)]
pub struct Cond {
    #[serde(rename = "minDay", default)]
    pub min_day: i32,
    #[serde(rename = "minHeat", default)]
    pub min_heat: f32,
    #[serde(rename = "minMoney", default)]
    pub min_money: f32,
    #[serde(rename = "needsOffice", default)]
    pub needs_office: bool,
    #[serde(default)]
    pub qualified: Option<bool>,
    #[serde(rename = "minSeats", default)]
    pub min_seats: i32,
    /// Share of the petition requirement already collected.
    #[serde(rename = "minSigsShare", default)]
    pub min_sigs_share: f32,
}
#[derive(Deserialize, Serialize, Clone)]
pub struct EventDef {
    pub id: String,
    #[serde(default = "one")]
    pub weight: f32,
    #[serde(default)]
    pub when: Cond,
    pub choices: Vec<Choice>,
}
#[derive(Deserialize, Serialize, Clone)]
pub struct Choice {
    #[serde(default)]
    pub effects: Vec<Effect>,
}
/// `op` is one of: money, rep, heat, volunteers, awareness, buzz, donors, sigs, recognition.
/// `scope` is "home" (default) or "state".
#[derive(Deserialize, Serialize, Clone)]
pub struct Effect {
    pub op: String,
    pub v: f32,
    #[serde(default)]
    pub scope: String,
}
#[derive(Deserialize, Serialize, Clone)]
pub struct ScandalDef {
    pub id: String,
    pub severity: f32,
}
/// `effect` is one of: sigs (v = share of the petition requirement), buzz (v = pressure added in
/// every county the party is known in), camp (v = boost to the leader's current race).
#[derive(Deserialize, Serialize, Clone)]
pub struct BribeDef {
    pub id: String,
    pub cost: f32,
    #[serde(rename = "costPerNeed", default)]
    pub cost_per_need: f32,
    pub effect: String,
    pub v: f32,
    pub heat: f32,
}

/// What the player (or the headless runner) chooses when starting a game.
#[derive(Deserialize, Serialize, Clone)]
pub struct Config {
    pub seed: u64,
    /// GEOID of the home town. Empty = largest place.
    #[serde(rename = "homePlace", default)]
    pub home_place: String,
    #[serde(rename = "partyName", default)]
    pub party_name: String,
    #[serde(rename = "leaderName", default)]
    pub leader_name: String,
    #[serde(default)]
    pub color: u32,
    #[serde(default)]
    pub platform: [i8; K],
    /// Start real office-holders in their real seats (name, party, office only).
    #[serde(rename = "realNames", default = "yes")]
    pub real_names: bool,
    /// The player's party is run by the same AI as the rival parties.
    #[serde(rename = "aiOnly", default)]
    pub ai_only: bool,
}
fn yes() -> bool {
    true
}

pub fn party_code(s: &str) -> u8 {
    match s {
        "D" => crate::DEM as u8,
        "R" => crate::REP as u8,
        "L" => crate::LIB as u8,
        "G" => crate::GRN as u8,
        _ => crate::NO_PARTY,
    }
}
pub const PARTY_CODES: [&str; P] = ["D", "R", "L", "G", "P", "X1", "X2", "X3"];

/// Joins the separate content files (data/content/*.json) into the single bundle the engine takes.
pub fn content_bundle(issues: &str, events: &str, scandals: &str, bribes: &str, names: &str) -> Result<String, String> {
    let p = |name: &str, t: &str| -> Result<serde_json::Value, String> { serde_json::from_str(t).map_err(|e| format!("{name}: {e}")) };
    let i = p("issues.json", issues)?;
    Ok(serde_json::json!({
        "issues": i["issues"], "platforms": i["platforms"],
        "events": p("events.json", events)?["events"], "scandals": p("scandals.json", scandals)?["scandals"],
        "bribes": p("bribes.json", bribes)?["bribes"], "names": p("names.json", names)?,
    })
    .to_string())
}

/// Reads the content bundle from a data directory on disk (native hosts only).
pub fn content_bundle_from_dir(dir: &str) -> Result<String, String> {
    let rd = |f: &str| std::fs::read_to_string(format!("{dir}/content/{f}")).map_err(|e| format!("{f}: {e}"));
    content_bundle(&rd("issues.json")?, &rd("events.json")?, &rd("scandals.json")?, &rd("bribes.json")?, &rd("names.json")?)
}
