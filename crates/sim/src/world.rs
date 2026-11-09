//! World state and its construction from real data. Every collection here is sized once, in
//! `World::new`, and never grows afterwards.

use crate::data::*;
use crate::rng::Seq;
use crate::*;
use serde::{Deserialize, Serialize};

pub const OPS: usize = 12;
pub const LOG: usize = 256;
pub const YEARS: usize = 160;
pub const PENDING: usize = 4;
pub const ARENAS: usize = 32;
pub const BENCH: usize = 320;

// Party kinds.
pub const MAJOR: u8 = 0;
pub const MINOR: u8 = 1;
pub const HUMAN: u8 = 2;
pub const RIVAL: u8 = 3;

// Queued operation kinds.
pub const OP_NONE: u8 = 0;
pub const OP_CANVASS: u8 = 1;
pub const OP_TOWN: u8 = 2;
pub const OP_RECRUIT: u8 = 3;
pub const OP_FUNDRAISE: u8 = 4;
pub const OP_PETITION: u8 = 5;
pub const OP_RALLY: u8 = 6;
pub const OP_DONOR: u8 = 7;
pub const OP_CAMPAIGN: u8 = 8;
/// (days, cost in dollars) per operation kind.
pub const OP_SPEC: [(i16, f32); 9] = [(0, 0.0), (14, 0.0), (10, 0.0), (10, 300.0), (7, 150.0), (21, 200.0), (3, 500.0), (14, 1000.0), (10, 400.0)];

// Log entry kinds. The UI turns these into sentences using data/content/strings.json.
pub const L_FOUNDED: u8 = 1; // a = party
pub const L_QUALIFIED: u8 = 2; // a = party
pub const L_LOST_STATUS: u8 = 3; // a = party
pub const L_ELECTED: u8 = 4; // a = seat, b = politician, c = party, f = share
pub const L_DEFEATED: u8 = 5; // a = seat, b = politician, c = party, f = share
pub const L_INVESTIGATION: u8 = 6; // a = party
pub const L_CHARGED: u8 = 7; // a = party, b = old leader
pub const L_CLEARED: u8 = 8; // a = party
pub const L_SCANDAL: u8 = 9; // a = politician, b = scandal index, c = party, f = 1 if resigned
pub const L_RETIRED: u8 = 10; // a = politician, b = seat
pub const L_DISSOLVED: u8 = 11; // a = party
pub const L_OP_DONE: u8 = 12; // a = op kind, b = target, c = party, f = amount
pub const L_CHAMBER: u8 = 13; // a = kind, b = year, c = leading party, f = its seats
pub const L_PLATFORM: u8 = 14; // a = party, b = issue, c = new position
pub const L_DONOR: u8 = 15; // a = party, f = 1 gained / 0 failed
pub const L_BRIBE: u8 = 16; // a = party, b = bribe index
pub const L_BROKE: u8 = 17; // a = party
pub const L_FILED: u8 = 18; // a = seat, b = politician, c = party

#[derive(Serialize, Deserialize, Clone, Copy, Default)]
pub struct Op {
    pub kind: u8,
    pub target: i32,
    pub arg: i32,
    pub left: i16,
    pub repeat: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Party {
    pub active: bool,
    pub kind: u8,
    pub name: String,
    pub color: u32,
    pub qualified: bool,
    pub sigs: f32,
    pub money: f64,
    pub rep: f32,
    pub heat: f32,
    /// Days left in an open investigation; 0 = none.
    pub invest: i32,
    pub platform: [i8; K],
    pub leader: i32,
    pub founded: i32,
    pub home: i32,
    pub donors: f32,
    pub organizers: u8,
    pub scruples: f32,
    pub ops: [Op; OPS],
    pub cursor: u32,
    pub seats: [u16; KINDS],
    pub ruined: u8,
    pub last_platform_day: i32,
    pub low_years: u8,
    pub net: f32,
    pub statewide: f32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Seat {
    pub kind: u8,
    /// Arena index for council/mayor, county index for county and district seats.
    pub area: u16,
    /// Index of this seat within its kind's list in the pack (district order) or within its area.
    pub ord: u16,
    /// Positive leans Democratic, negative Republican, relative to the surrounding county.
    pub tilt: f32,
    pub voters: f32,
    pub term: u8,
    pub next_year: u16,
    pub holder: i32,
    pub holder_party: u8,
    pub elect: i32,
    pub elect_party: u8,
    pub cand: [i32; P],
    pub camp: [f32; P],
    pub last_share: [f32; P],
    pub last_year: u16,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Pol {
    /// 0 = free slot, 1 = available (no office), 2 = in office.
    pub status: u8,
    pub first: u16,
    pub last: u16,
    /// Index into `World::real_names`, or -1 for a fictional person. Real people are exempt from
    /// scandals, bribes and every other invented event.
    pub real: i32,
    pub party: u8,
    pub born: u16,
    pub cha: u8,
    pub skl: u8,
    pub int: u8,
    pub seat: i32,
    pub recog: f32,
    pub taint: f32,
    pub wins: u8,
    pub losses: u8,
    pub top: u8,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Arena {
    /// Index into the pack's places.
    pub place: u32,
    pub county: u16,
    pub pop: f32,
    pub tilt: f32,
    pub roots: [f32; P],
    pub mayor: u32,
    pub council0: u32,
    pub council_n: u8,
}

#[derive(Serialize, Deserialize, Clone, Copy, Default)]
pub struct LogEntry {
    pub day: i32,
    pub kind: u8,
    pub a: i32,
    pub b: i32,
    pub c: i32,
    pub f: f32,
}

/// One compressed row of history per year.
#[derive(Serialize, Deserialize, Clone, Copy, Default)]
pub struct YearRow {
    pub year: u16,
    pub support: [f32; P],
    pub house: [u16; P],
    pub senate: [u16; P],
    pub local: [u16; P],
    pub gov: u8,
    pub money: f32,
}

#[derive(Serialize, Deserialize, Clone, Copy, Default)]
pub struct Pending {
    pub active: bool,
    pub event: u16,
    pub day: i32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct World {
    pub version: u32,
    pub seed: u64,
    pub day: i32,
    pub usps: String,
    pub need_sigs: f32,
    pub retain: f32,
    pub gov_term: u8,
    pub nc: usize,
    // ---- static per county
    pub pop: Vec<f32>,
    pub openness: Vec<f32>,
    pub wealth: Vec<f32>,
    pub ideal: Vec<f32>,
    /// Cached platform fit per county x party, refreshed when a platform changes.
    pub appeal: Vec<f32>,
    pub salience: [f32; K],
    // ---- dynamic per county x party
    pub support: Vec<f32>,
    pub base: Vec<f32>,
    /// Long-run pull on `base`: the county's historical character. Drifts very slowly.
    pub anchor: Vec<f32>,
    pub aware: Vec<f32>,
    pub org: Vec<f32>,
    pub press: Vec<f32>,
    // ---- entities
    pub parties: Vec<Party>,
    pub seats: Vec<Seat>,
    pub pols: Vec<Pol>,
    pub arenas: Vec<Arena>,
    pub real_names: Vec<String>,
    pub player_name: String,
    pub mood: [f32; P],
    pub log: Vec<LogEntry>,
    pub log_n: u32,
    pub years: Vec<YearRow>,
    pub years_n: u32,
    pub pending: [Pending; PENDING],
    pub next_event_day: i32,
    pub home_arena: u32,
    pub ai_only: bool,
    pub pol_cursor: u32,
    pub gov_seat: u32,
    pub state_pop: f32,
    pub n_first: u16,
    pub n_last: u16,
}

/// Share of residents who are adults, and turnout among adults, by office kind. Estimates.
pub const ADULT: f32 = 0.77;
pub const TURNOUT: [f32; KINDS] = [0.20, 0.22, 0.48, 0.50, 0.50, 0.52];
pub const RIVAL_COLORS: [u32; 3] = [0xE08A2C, 0x8A5BD6, 0x2CB5A9];

fn zscores(v: &[Option<f64>]) -> Vec<f32> {
    let known: Vec<f64> = v.iter().flatten().copied().collect();
    if known.is_empty() {
        return vec![0.0; v.len()];
    }
    let mean = known.iter().sum::<f64>() / known.len() as f64;
    let sd = (known.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / known.len() as f64).sqrt().max(1e-9);
    v.iter().map(|x| x.map(|x| ((x - mean) / sd).clamp(-3.0, 3.0) as f32).unwrap_or(0.0)).collect()
}

/// Parses a cycle code from states.json into (term, first election year for seat index i).
fn cycle(code: &str, i: usize) -> (u8, u16) {
    if let Some(y) = code.strip_prefix("4a:") {
        return (4, y.parse().unwrap_or(2026));
    }
    match code {
        "2:odd" => (2, 2025),
        "4s" => (4, if i % 2 == 0 { 2026 } else { 2028 }),
        _ => (2, 2026),
    }
}

impl World {
    pub fn new(pack: &Pack, rules: &StateRules, content: &Content, cfg: &Config) -> Result<World, String> {
        let nc = pack.counties.len();
        if nc == 0 || pack.places.is_empty() {
            return Err("pack has no counties or places".into());
        }
        if content.issues.len() != K {
            return Err(format!("content must define exactly {K} issues"));
        }
        if content.names.first.len() < 8 || content.names.last.len() < 8 {
            return Err("content names lists are too short".into());
        }
        let mut seq = Seq(rng::key(cfg.seed, 1, 2, 3));
        let year0 = cal::EPOCH_YEAR;

        // ---- counties: partisan lean from real presidential returns
        let mut dshare = vec![0.5f32; nc];
        let mut other = vec![0.03f32; nc];
        for (i, c) in pack.counties.iter().enumerate() {
            let (mut d, mut r, mut o, mut n) = (0.0, 0.0, 0.0, 0);
            for v in c.pres.values() {
                let t = v[0] + v[1] + v[2];
                if t > 0.0 && v[0] + v[1] > 0.0 {
                    d += v[0] / (v[0] + v[1]);
                    r += 1.0;
                    o += v[2].max(0.0) / t;
                    n += 1;
                }
            }
            if n > 0 {
                dshare[i] = ((d / r) as f32).clamp(0.03, 0.97);
                other[i] = ((o / n as f64) as f32).clamp(0.005, 0.2);
            }
        }
        let dens: Vec<Option<f64>> = pack.counties.iter().map(|c| c.land_km2.filter(|a| *a > 0.0).map(|a| (c.pop.max(1.0) / a).ln())).collect();
        let zd = zscores(&dens);
        let zi = zscores(&pack.counties.iter().map(|c| c.income).collect::<Vec<_>>());
        let za = zscores(&pack.counties.iter().map(|c| c.age).collect::<Vec<_>>());
        let zb = zscores(&pack.counties.iter().map(|c| c.bach).collect::<Vec<_>>());
        let mean_income = {
            let k: Vec<f64> = pack.counties.iter().filter_map(|c| c.income).collect();
            if k.is_empty() { 1.0 } else { k.iter().sum::<f64>() / k.len() as f64 }
        };
        let mut w = World {
            version: SAVE_VERSION,
            seed: cfg.seed,
            day: cal::day_of(2025, 2, 1),
            usps: pack.usps.clone(),
            need_sigs: rules.sigs.max(100.0),
            retain: rules.retain / 100.0,
            gov_term: rules.gov_term as u8,
            nc,
            pop: pack.counties.iter().map(|c| c.pop.max(1.0) as f32).collect(),
            openness: other.iter().map(|o| 0.012 + o * 0.5).collect(),
            wealth: pack.counties.iter().map(|c| c.income.map(|x| (x / mean_income) as f32).unwrap_or(1.0).clamp(0.4, 2.5)).collect(),
            ideal: vec![0.0; nc * K],
            appeal: vec![0.0; nc * P],
            salience: [1.0; K],
            support: vec![0.0; nc * P],
            base: vec![0.0; nc * P],
            anchor: Vec::new(),
            aware: vec![0.0; nc * P],
            org: vec![0.0; nc * P],
            press: vec![0.0; nc * P],
            parties: vec![Party::default(); P],
            seats: Vec::new(),
            pols: Vec::new(),
            arenas: Vec::new(),
            real_names: Vec::new(),
            player_name: cfg.leader_name.clone(),
            mood: [0.0; P],
            log: vec![LogEntry::default(); LOG],
            log_n: 0,
            years: vec![YearRow::default(); YEARS],
            years_n: 0,
            pending: [Pending::default(); PENDING],
            next_event_day: cal::day_of(2025, 2, 20),
            home_arena: 0,
            ai_only: cfg.ai_only,
            pol_cursor: 0,
            gov_seat: 0,
            state_pop: pack.counties.iter().map(|c| c.pop as f32).sum(),
            n_first: content.names.first.len() as u16,
            n_last: content.names.last.len() as u16,
        };
        for (k, iss) in content.issues.iter().enumerate() {
            w.salience[k] = iss.salience;
        }
        for i in 0..nc {
            let lean = dshare[i] * 2.0 - 1.0;
            for (k, iss) in content.issues.iter().enumerate() {
                let x = iss.w[0] * lean * 2.0 + iss.w[1] * zd[i] + iss.w[2] * zi[i] + iss.w[3] * za[i] + iss.w[4] * zb[i];
                w.ideal[i * K + k] = 2.0 * x.tanh();
            }
            let l = (other[i] * 0.45).max(0.004);
            let g = (other[i] * 0.20).max(0.002);
            let b = &mut w.base[i * P..i * P + P];
            b[LIB] = l;
            b[GRN] = g;
            b[DEM] = dshare[i] * (1.0 - l - g);
            b[REP] = (1.0 - dshare[i]) * (1.0 - l - g);
            for p in PLAYER..P {
                b[p] = w.openness[i];
            }
            let pop = w.pop[i];
            for p in 0..4 {
                w.support[i * P + p] = w.base[i * P + p];
                w.aware[i * P + p] = [1.0, 1.0, 0.6, 0.5][p];
                w.org[i * P + p] = if p < 2 { w.base[i * P + p] * pop / 4000.0 * 2.5 } else { pop / 4000.0 * 0.15 };
            }
        }

        w.anchor = w.base.clone();

        // ---- parties
        let plat = |code: &str| content.platforms.get(code).copied().unwrap_or([0; K]);
        let names = ["Democratic Party", "Republican Party", "Libertarian Party", "Green Party"];
        let colors = [0x3D7DD8u32, 0xD8453D, 0xE3B93B, 0x4FA34A];
        for p in 0..4 {
            let pt = &mut w.parties[p];
            pt.active = true;
            pt.kind = if p < 2 { MAJOR } else { MINOR };
            pt.name = names[p].to_string();
            pt.color = colors[p];
            pt.qualified = p < 2 || (p == LIB && rules.lp) || (p == GRN && rules.gp);
            pt.platform = plat(PARTY_CODES[p]);
            pt.leader = NONE;
            pt.home = NONE;
            pt.scruples = 1.0;
        }
        for p in 4..P {
            w.parties[p].leader = NONE;
            w.parties[p].home = NONE;
            w.parties[p].color = if p == PLAYER { 0xC64FD0 } else { RIVAL_COLORS[p - 5] };
        }

        // ---- arenas: the largest places plus the chosen home town
        let home_place = pack.places.iter().position(|p| p.geoid == cfg.home_place).unwrap_or(0);
        let mut picks: Vec<usize> = (0..pack.places.len().min(ARENAS)).collect();
        if !picks.contains(&home_place) {
            picks.pop();
            picks.push(home_place);
        }
        let county_dens = |c: usize| dens[c].unwrap_or(0.0);
        let state_pop = w.state_pop;
        for (ai, &pi) in picks.iter().enumerate() {
            let pl = &pack.places[pi];
            let c = pl.county.min(nc - 1);
            let pop = (pl.pop as f32).max(50.0);
            let tilt = match pl.land_km2 {
                Some(a) if a > 0.0 => (0.2 * ((pl.pop.max(1.0) / a).ln() - county_dens(c)) as f32).clamp(-0.6, 0.6),
                _ => 0.0,
            };
            let n = if pop < 10_000.0 { 5 } else if pop < 100_000.0 { 7 } else { 9 };
            let is_home = pi == home_place;
            if is_home {
                w.home_arena = ai as u32;
            }
            let mayor = w.seats.len() as u32;
            let mk = |kind: u8, area: usize, ord: usize, tilt: f32, voters: f32, term: u8, next: u16| Seat {
                kind, area: area as u16, ord: ord as u16, tilt, voters, term, next_year: next,
                holder: NONE, holder_party: NO_PARTY, elect: NONE, elect_party: NO_PARTY,
                cand: [NONE; P], camp: [0.0; P], last_share: [0.0; P], last_year: 0,
            };
            let v = pop * ADULT;
            w.seats.push(mk(MAYOR, ai, 0, tilt, v * TURNOUT[MAYOR as usize], 4, if is_home || ai % 2 == 0 { 2027 } else { 2025 }));
            for j in 0..n {
                w.seats.push(mk(COUNCIL, ai, j, tilt, v * TURNOUT[COUNCIL as usize], 4, if j % 2 == 0 { 2025 } else { 2027 }));
            }
            w.arenas.push(Arena { place: pi as u32, county: c as u16, pop, tilt, roots: [0.0; P], mayor, council0: mayor + 1, council_n: n as u8 });
        }
        let mk = |kind: u8, area: usize, ord: usize, tilt: f32, voters: f32, term: u8, next: u16| Seat {
            kind, area: area as u16, ord: ord as u16, tilt, voters, term, next_year: next,
            holder: NONE, holder_party: NO_PARTY, elect: NONE, elect_party: NO_PARTY,
            cand: [NONE; P], camp: [0.0; P], last_share: [0.0; P], last_year: 0,
        };
        // ---- county commissions: three seats per county (estimate; real boards vary)
        for c in 0..nc {
            for j in 0..3 {
                w.seats.push(mk(COUNTY, c, j, 0.0, w.pop[c] * ADULT * TURNOUT[COUNTY as usize], 4, if j == 1 { 2028 } else { 2026 }));
            }
        }
        // ---- legislature
        for (kind, list, code) in [(HOUSE, &pack.house, &rules.house_cycle), (SENATE, &pack.senate, &rules.senate_cycle)] {
            let n = list.len().max(1) as f32;
            let mut per_shape = std::collections::BTreeMap::new();
            for s in list.iter() {
                *per_shape.entry(s.shape).or_insert(0u32) += 1;
            }
            for (i, s) in list.iter().enumerate() {
                let c = s.county.min(nc - 1);
                let dpop = state_pop / n * per_shape[&s.shape] as f32;
                let mut tilt = match s.land_km2 {
                    Some(a) if a > 0.0 => (0.25 * ((dpop as f64 / a).ln() - county_dens(c)) as f32).clamp(-0.8, 0.8),
                    _ => 0.0,
                };
                // Keep the seat consistent with its real current holder's party where one is known.
                if let Some(inc) = &s.inc {
                    let (d, r) = (w.base[c * P + DEM], w.base[c * P + REP]);
                    let code = party_code(&inc.party);
                    if code == DEM as u8 {
                        tilt = tilt.max(0.5 * (1.08 * r / d).ln());
                    } else if code == REP as u8 {
                        tilt = tilt.min(-0.5 * (1.08 * d / r).ln());
                    }
                }
                let (term, next) = cycle(code, i);
                w.seats.push(mk(kind, c, i, tilt, state_pop / n * ADULT * TURNOUT[kind as usize], term, next));
            }
        }
        w.gov_seat = w.seats.len() as u32;
        w.seats.push(mk(GOVERNOR, 0, 0, 0.0, state_pop * ADULT * TURNOUT[GOVERNOR as usize], rules.gov_term as u8, rules.gov_next as u16));

        // ---- politicians
        w.pols = vec![Pol { real: NONE, seat: NONE, party: NO_PARTY, ..Pol::default() }; w.seats.len() + BENCH];
        for s in 0..w.seats.len() {
            let seat = w.seats[s].clone();
            let (c, tilt) = (seat.area as usize, seat.tilt);
            let c = if seat.kind <= MAYOR { w.arenas[c].county as usize } else { c };
            let mut real: Option<(&str, u8)> = None;
            if cfg.real_names {
                match seat.kind {
                    HOUSE => real = pack.house[seat.ord as usize].inc.as_ref().map(|i| (i.name.as_str(), party_code(&i.party))),
                    SENATE => real = pack.senate[seat.ord as usize].inc.as_ref().map(|i| (i.name.as_str(), party_code(&i.party))),
                    GOVERNOR => real = Some((rules.governor.as_str(), party_code(&rules.gov_party))),
                    _ => {}
                }
            }
            let party = match real {
                Some((_, p)) => p,
                None => {
                    // Fictional holder: party drawn from the local two-party balance.
                    let d = if seat.kind == GOVERNOR {
                        (0..nc).map(|i| w.base[i * P + DEM] * w.pop[i]).sum::<f32>() / state_pop
                    } else {
                        w.base[c * P + DEM] * tilt.exp()
                    };
                    let r = if seat.kind == GOVERNOR { 1.0 - d } else { w.base[c * P + REP] * (-tilt).exp() };
                    let pd = d.powi(4) / (d.powi(4) + r.powi(4));
                    if seq.unit() < pd { DEM as u8 } else { REP as u8 }
                }
            };
            let i = w.alloc_pol(party, &mut seq, year0);
            if let Some((name, _)) = real {
                w.pols[i as usize].real = w.real_names.len() as i32;
                w.real_names.push(name.to_string());
                w.pols[i as usize].int = 100;
            }
            let pol = &mut w.pols[i as usize];
            pol.status = 2;
            pol.seat = s as i32;
            pol.top = seat.kind;
            pol.recog = 0.5;
            w.seats[s].holder = i;
            w.seats[s].holder_party = party;
        }

        // ---- the player's party
        {
            let home = w.arenas[w.home_arena as usize].clone();
            let leader = w.alloc_pol(PLAYER as u8, &mut seq, year0);
            let l = &mut w.pols[leader as usize];
            l.cha = 62;
            l.skl = 58;
            l.int = 70;
            l.born = (year0 - 38) as u16;
            let pt = &mut w.parties[PLAYER];
            pt.active = true;
            pt.kind = if cfg.ai_only { RIVAL } else { HUMAN };
            pt.name = if cfg.party_name.trim().is_empty() { "New Party".to_string() } else { cfg.party_name.trim().chars().take(40).collect() };
            if cfg.color != 0 {
                pt.color = cfg.color & 0xFFFFFF;
            }
            pt.platform = cfg.platform.map(|v| v.clamp(-2, 2));
            pt.leader = leader;
            pt.home = w.home_arena as i32;
            pt.money = 5000.0;
            pt.founded = w.day;
            pt.scruples = 0.6;
            pt.last_platform_day = -10_000;
            let c = home.county as usize;
            w.aware[c * P + PLAYER] = 0.05;
            w.org[c * P + PLAYER] = 6.0;
            w.arenas[w.home_arena as usize].roots[PLAYER] = 0.3;
            w.push_log(L_FOUNDED, PLAYER as i32, 0, 0, 0.0);
        }
        w.refresh_appeal();
        w.recount();
        Ok(w)
    }

    /// Takes a free slot from the fixed politician pool, recycling the least notable person
    /// without an office if the pool is full.
    pub fn alloc_pol(&mut self, party: u8, seq: &mut Seq, year: i32) -> i32 {
        let n = self.pols.len();
        let mut found = None;
        for k in 0..n {
            let i = (self.pol_cursor as usize + k) % n;
            if self.pols[i].status == 0 {
                found = Some(i);
                break;
            }
        }
        let i = found.unwrap_or_else(|| {
            let leaders: Vec<i32> = self.parties.iter().map(|p| p.leader).collect();
            let mut best = usize::MAX;
            let mut score = f32::MAX;
            for (i, p) in self.pols.iter().enumerate() {
                if p.status == 1 && !leaders.contains(&(i as i32)) && !self.is_candidate(i as i32) && p.recog < score {
                    score = p.recog;
                    best = i;
                }
            }
            if best == usize::MAX { 0 } else { best }
        });
        self.pol_cursor = ((i + 1) % n) as u32;
        self.pols[i] = Pol {
            status: 1,
            first: (seq.next() % self.n_first as u64) as u16,
            last: (seq.next() % self.n_last as u64) as u16,
            real: NONE,
            party,
            born: (year - seq.range(30, 62)) as u16,
            cha: seq.range(30, 88) as u8,
            skl: seq.range(30, 88) as u8,
            int: seq.range(25, 95) as u8,
            seat: NONE,
            recog: 0.1,
            taint: 0.0,
            wins: 0,
            losses: 0,
            top: 0,
        };
        i as i32
    }

    pub fn is_candidate(&self, pol: i32) -> bool {
        self.seats.iter().any(|s| s.cand.contains(&pol) || s.elect == pol)
    }

    pub fn push_log(&mut self, kind: u8, a: i32, b: i32, c: i32, f: f32) {
        let i = self.log_n as usize % LOG;
        self.log[i] = LogEntry { day: self.day, kind, a, b, c, f };
        self.log_n = self.log_n.wrapping_add(1);
    }

    /// Recomputes each party's seat totals and statewide support.
    pub fn recount(&mut self) {
        for p in self.parties.iter_mut() {
            p.seats = [0; KINDS];
            p.statewide = 0.0;
        }
        for s in &self.seats {
            if (s.holder_party as usize) < P && s.holder != NONE {
                self.parties[s.holder_party as usize].seats[s.kind as usize] += 1;
            }
        }
        for c in 0..self.nc {
            for p in 0..P {
                self.parties[p].statewide += self.support[c * P + p] * self.pop[c];
            }
        }
        for p in self.parties.iter_mut() {
            p.statewide /= self.state_pop;
        }
    }

    /// How well each party's platform fits each county, from -1 to 1.
    pub fn refresh_appeal(&mut self) {
        let ss: f32 = self.salience.iter().sum::<f32>().max(0.001);
        for c in 0..self.nc {
            for p in 0..P {
                let mut dist = 0f32;
                for k in 0..K {
                    dist += (self.parties[p].platform[k] as f32 - self.ideal[c * K + k]).abs() * self.salience[k];
                }
                self.appeal[c * P + p] = (1.0 - dist / ss / 1.5).clamp(-1.0, 1.0);
            }
        }
    }

    pub fn year(&self) -> i32 {
        cal::ymd(self.day).0
    }

    /// The county a seat's voters are drawn from (governor: none, uses every county).
    pub fn seat_county(&self, s: &Seat) -> usize {
        if s.kind <= MAYOR { self.arenas[s.area as usize].county as usize } else { s.area as usize }
    }

    /// Approximate bytes of heap held by the world. Constant for the life of a game.
    pub fn heap_bytes(&self) -> usize {
        use std::mem::size_of;
        (self.pop.len() + self.openness.len() + self.wealth.len() + self.ideal.len()) * 4
            + (self.support.len() * 7) * 4
            + self.parties.len() * size_of::<Party>()
            + self.seats.len() * size_of::<Seat>()
            + self.pols.len() * size_of::<Pol>()
            + self.arenas.len() * size_of::<Arena>()
            + self.log.len() * size_of::<LogEntry>()
            + self.years.len() * size_of::<YearRow>()
            + self.real_names.iter().map(|s| s.len() + 24).sum::<usize>()
    }
}
