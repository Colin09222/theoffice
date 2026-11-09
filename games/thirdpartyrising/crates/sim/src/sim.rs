//! The daily tick: opinion drift, party economies, queued operations, AI, elections,
//! investigations, careers. Everything here costs the same on day 1 and on day 36,500.

use crate::data::*;
use crate::rng::{key, normal, unit, Seq};
use crate::world::*;
use crate::*;

/// County evaluations each AI party may make per day.
pub const AI_EVALS: usize = 12;
/// Below this many counties the daily pass runs on one thread.
pub const PAR_MIN_COUNTIES: usize = 1024;
/// Days before election day that AI parties file, and the last day the player may file.
pub const AI_FILE_LEAD: i32 = 100;
pub const FILE_DEADLINE: i32 = 45;
pub const SIG_PRICE: f32 = 4.5;
const KQ: [f32; KINDS] = [1.5, 1.3, 0.9, 0.7, 0.6, 0.45];
const CAMPAIGN_COST: [f32; KINDS] = [400.0, 900.0, 1500.0, 3000.0, 6000.0, 40000.0];
const RECRUIT_COST: [f32; KINDS] = [300.0, 800.0, 1000.0, 2500.0, 5000.0, 25000.0];

pub fn step(w: &mut World, ct: &Content) {
    w.day += 1;
    let (y, m, d, _) = cal::ymd(w.day);
    for p in 0..P {
        // National-mood stand-in: a slow random walk per party, the same process for every party.
        w.mood[p] = w.mood[p] * 0.995 + normal(key(w.seed, w.day as u64, p as u64, 11)) * 0.006;
    }
    parties_daily(w);
    ops_daily(w);
    ai_daily(w, ct, y);
    counties_daily(w);
    if d == 1 {
        monthly(w, ct, y);
        if m == 1 {
            new_year(w, ct, y);
        }
    }
    let ed = cal::election_day(y);
    if w.day == ed - AI_FILE_LEAD {
        ai_filing(w, y);
    }
    if w.day == ed {
        elections(w, y);
    }
    events_daily(w, ct);
}

fn uses_money(k: u8) -> bool {
    k == HUMAN || k == RIVAL
}

// ------------------------------------------------------------------ opinion

fn counties_daily(w: &mut World) {
    let mut bonus = [0f32; P];
    let mut active = [false; P];
    let mut established = [false; P];
    let mut live = [0f32; P];
    let mut insurgent = [0f32; P];
    for p in 0..P {
        let pt = &w.parties[p];
        active[p] = pt.active;
        established[p] = pt.kind == MAJOR || pt.kind == MINOR;
        live[p] = if pt.active { 1.0 } else { 0.0 };
        insurgent[p] = if established[p] { 0.0 } else { 1.0 };
        bonus[p] = 0.5 * pt.rep + w.mood[p];
    }
    let (seed, day) = (w.seed, w.day as u64);
    let (appeal, pop) = (&w.appeal, &w.pop);
    let work = |c: usize, sup: &mut [f32], base: &mut [f32], anchor: &mut [f32], aware: &mut [f32], org: &mut [f32], press: &mut [f32]| {
        // Every party slot is processed every day, active or not: the cost of a day is fixed.
        let mut wt = [0f32; P];
        let mut sum = 0f32;
        for p in 0..P {
            // An established party's organisation is already part of its base; an insurgent's
            // volunteers are a bonus it has to build.
            let orgf = insurgent[p] * 0.35 * fmath::ln(1.0 + org[p] * 4000.0 / pop[c]);
            // Support far above a county's long-run character meets resistance, whoever holds it.
            let drag = 1.5 * (sup[p] - anchor[p] - 0.25).max(0.0);
            wt[p] = live[p] * aware[p] * base[p] * fmath::exp(0.9 * appeal[c * P + p] + orgf + 0.35 * press[p] + bonus[p] - drag);
            sum += wt[p];
        }
        let sum = sum.max(1e-9);
        let mut total = 0f32;
        let mut h = key(seed, day, c as u64, 100);
        for p in 0..P {
            let target = wt[p] / sum;
            h = rng::mix(h);
            let n = (unit(h) - 0.5) * 0.0052;
            // Values decaying towards zero are snapped to zero: subnormal floats are very slow and
            // would make old worlds run slower than new ones.
            let v = sup[p] + (target - sup[p]) * 0.03 + n * sup[p];
            sup[p] = if v > 1e-7 { v } else { 0.0 };
            total += sup[p];
        }
        for p in 0..P {
            sup[p] /= total.max(1e-9);
            base[p] += (sup[p] - base[p]) * 0.0006 + (anchor[p] - base[p]) * 0.0006;
            anchor[p] += (base[p] - anchor[p]) * 0.00004;
            press[p] = if press[p].abs() > 1e-4 { press[p] * 0.975 } else { 0.0 };
            if !established[p] && active[p] {
                let floor = (base[p] * 8.0).min(1.0);
                if aware[p] > floor {
                    aware[p] += (floor - aware[p]) * 0.0006;
                }
                // Volunteers come from supporters: a party cannot field more than its base allows.
                let cap = sup[p] * pop[c] * 0.004 + 12.0;
                org[p] = (org[p] * 0.9992 + sup[p] * pop[c] * aware[p] * 0.000002).min(cap);
            } else if active[p] {
                // Established parties keep a standing volunteer base in proportion to their support.
                let rate = if p < 2 { 0.0025 } else { 0.001 };
                org[p] += (sup[p] * pop[c] * rate - org[p]) * 0.01;
            }
        }
    };
    // Threads only pay for themselves on big maps (the future national map); a single state is
    // faster on one core, and the result is identical either way.
    #[cfg(feature = "parallel")]
    if w.nc >= PAR_MIN_COUNTIES {
        use rayon::prelude::*;
        w.support
            .par_chunks_mut(P)
            .zip(w.base.par_chunks_mut(P))
            .zip(w.anchor.par_chunks_mut(P))
            .zip(w.aware.par_chunks_mut(P))
            .zip(w.org.par_chunks_mut(P))
            .zip(w.press.par_chunks_mut(P))
            .enumerate()
            .with_min_len(128)
            .for_each(|(c, (((((s, b), an), a), o), pr))| work(c, s, b, an, a, o, pr));
        return;
    }
    for c in 0..w.nc {
        let r = c * P..c * P + P;
        let (s, b, an, a, o, pr) = (&mut w.support[r.clone()], &mut w.base[r.clone()], &mut w.anchor[r.clone()], &mut w.aware[r.clone()], &mut w.org[r.clone()], &mut w.press[r]);
        work(c, s, b, an, a, o, pr);
    }
}

// ------------------------------------------------------------------ party economy and law

fn parties_daily(w: &mut World) {
    for p in 2..P {
        if !w.parties[p].active {
            continue;
        }
        let kind = w.parties[p].kind;
        if kind == MINOR {
            // Established minor parties petition slowly in the background.
            if !w.parties[p].qualified {
                w.parties[p].sigs += w.need_sigs / 1500.0;
                check_qualified(w, p);
            }
            continue;
        }
        let (mut supporters, mut vols) = (0f32, 0f32);
        for c in 0..w.nc {
            supporters += w.support[c * P + p] * w.pop[c] * w.wealth[c];
            vols += w.org[c * P + p];
        }
        let pt = &mut w.parties[p];
        let income = supporters * 0.006 * (0.7 + 0.5 * pt.rep).max(0.2) + pt.donors * 66.0;
        let upkeep = vols * 0.15 + pt.organizers as f32 * 100.0;
        pt.net = income - upkeep;
        pt.money += pt.net as f64;
        pt.heat = if pt.heat > 1e-4 { pt.heat * 0.9992 } else { 0.0 };
        pt.rep = if pt.rep.abs() > 1e-4 { pt.rep * 0.9993 } else { 0.0 };
        if pt.money < -3000.0 && pt.organizers > 0 {
            pt.organizers -= 1;
            pt.money += 1500.0;
            w.push_log(L_BROKE, p as i32, 0, 0, 0.0);
        }
        let pt = &mut w.parties[p];
        if pt.invest > 0 {
            pt.invest -= 1;
            pt.rep = (pt.rep - 0.0006).max(-1.0);
            if pt.invest == 0 {
                resolve_investigation(w, p);
            }
        } else if pt.heat > 0.05 {
            let hazard = pt.heat * pt.heat * 0.0006;
            if unit(key(w.seed, w.day as u64, p as u64, 21)) < hazard {
                pt.invest = 90 + (key(w.seed, w.day as u64, p as u64, 22) % 150) as i32;
                w.push_log(L_INVESTIGATION, p as i32, 0, 0, 0.0);
            }
        }
    }
}

fn resolve_investigation(w: &mut World, p: usize) {
    let heat = w.parties[p].heat;
    let charged = unit(key(w.seed, w.day as u64, p as u64, 23)) < heat / (heat + 1.5);
    if !charged {
        w.parties[p].heat *= 0.4;
        w.parties[p].rep = (w.parties[p].rep + 0.03).min(1.0);
        w.push_log(L_CLEARED, p as i32, 0, 0, 0.0);
        return;
    }
    // Scandal and ruin: the leader is out, money and trust go with them.
    let old = w.parties[p].leader;
    w.parties[p].race = NONE;
    for c in 0..w.nc {
        w.support[c * P + p] *= 0.6;
        w.base[c * P + p] *= 0.75;
        w.org[c * P + p] *= 0.6;
    }
    for a in w.arenas.iter_mut() {
        a.roots[p] *= 0.4;
    }
    {
        let pt = &mut w.parties[p];
        pt.rep = (pt.rep - 0.5).max(-1.0);
        pt.money = if pt.money > 0.0 { pt.money * 0.5 } else { pt.money };
        pt.donors = (pt.donors * 0.3).floor();
        pt.heat = 0.0;
        pt.ruined = pt.ruined.saturating_add(1);
        if !pt.qualified {
            pt.sigs *= 0.7;
        }
    }
    if old != NONE {
        for s in 0..w.seats.len() {
            if w.seats[s].cand[p] == old {
                w.seats[s].cand[p] = NONE;
            }
            if w.seats[s].elect == old {
                w.seats[s].elect = NONE;
                w.seats[s].elect_party = NO_PARTY;
            }
        }
        let seat = w.pols[old as usize].seat;
        w.pols[old as usize].status = 0;
        if seat != NONE {
            appoint(w, seat as usize, w.seats[seat as usize].holder_party);
        }
    }
    let mut seq = Seq(key(w.seed, w.day as u64, p as u64, 24));
    let y = w.year();
    let nl = w.alloc_pol(p as u8, &mut seq, y);
    w.parties[p].leader = nl;
    w.push_log(L_CHARGED, p as i32, old, nl, 0.0);
}

/// Fills a seat with a new fictional member of `party` (vacancy appointment; a simplification of
/// real special-election rules).
fn appoint(w: &mut World, s: usize, party: u8) {
    let mut seq = Seq(key(w.seed, w.day as u64, s as u64, 25));
    let y = w.year();
    let old = w.seats[s].holder;
    if old != NONE && w.pols[old as usize].seat == s as i32 {
        w.pols[old as usize].seat = NONE;
        if w.pols[old as usize].status == 2 {
            w.pols[old as usize].status = 1;
        }
    }
    if party == NO_PARTY {
        w.seats[s].holder = NONE;
        w.seats[s].holder_party = NO_PARTY;
        return;
    }
    let i = w.alloc_pol(party, &mut seq, y);
    let pol = &mut w.pols[i as usize];
    pol.status = 2;
    pol.seat = s as i32;
    pol.top = w.seats[s].kind;
    w.seats[s].holder = i;
    w.seats[s].holder_party = party;
}

pub fn check_qualified(w: &mut World, p: usize) {
    if !w.parties[p].qualified && w.parties[p].sigs >= w.need_sigs {
        w.parties[p].qualified = true;
        w.parties[p].rep = (w.parties[p].rep + 0.05).min(1.0);
        w.push_log(L_QUALIFIED, p as i32, 0, 0, 0.0);
    }
}

// ------------------------------------------------------------------ operations

pub fn slots(pt: &Party) -> usize {
    (2 + pt.organizers as usize).min(OPS)
}

pub fn op_cost(w: &World, kind: u8, arg: i32) -> f32 {
    if kind == OP_CAMPAIGN && arg >= 0 && (arg as usize) < w.seats.len() {
        CAMPAIGN_COST[w.seats[arg as usize].kind as usize]
    } else {
        OP_SPEC[kind as usize].1
    }
}

pub fn start_op(w: &mut World, p: usize, kind: u8, target: i32, arg: i32, repeat: bool) -> Result<(), &'static str> {
    if kind == OP_NONE || kind as usize >= OP_SPEC.len() {
        return Err("unknown operation");
    }
    let pt = &w.parties[p];
    if !pt.active || !uses_money(pt.kind) {
        return Err("party cannot act");
    }
    let used = pt.ops.iter().filter(|o| o.kind != OP_NONE).count();
    if used >= slots(pt) {
        return Err("no free operation slot: hire an organizer or wait");
    }
    if pt.ops.iter().any(|o| o.kind == kind && o.target == target && o.arg == arg) {
        return Err("already running that operation there");
    }
    match kind {
        OP_TOWN => {
            if target < 0 || target as usize >= w.arenas.len() {
                return Err("no such town");
            }
        }
        OP_CAMPAIGN => {
            if arg < 0 || arg as usize >= w.seats.len() || w.seats[arg as usize].cand[p] == NONE {
                return Err("you have no candidate in that race");
            }
        }
        _ => {
            if target < 0 || target as usize >= w.nc {
                return Err("no such county");
            }
        }
    }
    if kind == OP_PETITION && pt.qualified {
        return Err("already on the ballot");
    }
    let cost = op_cost(w, kind, arg);
    if cost > 0.0 && pt.money < cost as f64 {
        return Err("not enough money");
    }
    let pt = &mut w.parties[p];
    pt.money -= cost as f64;
    let slot = pt.ops.iter().position(|o| o.kind == OP_NONE).ok_or("no free operation slot")?;
    pt.ops[slot] = Op { kind, target, arg, left: OP_SPEC[kind as usize].0, repeat };
    Ok(())
}

fn ops_daily(w: &mut World) {
    for p in PLAYER..P {
        if !w.parties[p].active {
            continue;
        }
        for i in 0..OPS {
            let op = w.parties[p].ops[i];
            if op.kind == OP_NONE {
                continue;
            }
            if op.left > 1 {
                w.parties[p].ops[i].left -= 1;
                continue;
            }
            w.parties[p].ops[i] = Op::default();
            complete_op(w, p, op);
            if op.repeat {
                let _ = start_op(w, p, op.kind, op.target, op.arg, true);
            }
        }
    }
}

fn complete_op(w: &mut World, p: usize, op: Op) {
    let rep = w.parties[p].rep;
    let mut amount = 0f32;
    let c = match op.kind {
        OP_TOWN => w.arenas[op.target as usize].county as usize,
        OP_CAMPAIGN => {
            let s = &w.seats[op.arg as usize];
            w.seat_county(s)
        }
        _ => op.target as usize,
    };
    let i = c * P + p;
    let pop = w.pop[c];
    let eff = (w.org[i] * 2000.0 / pop).clamp(0.1, 1.5);
    match op.kind {
        OP_CANVASS => {
            w.aware[i] += 0.12 * eff * (1.0 - w.aware[i]);
            w.press[i] = (w.press[i] + 0.4 * eff).min(3.0);
            amount = eff;
        }
        OP_TOWN => {
            let a = &mut w.arenas[op.target as usize];
            let e = (w.org[i] * 300.0 / a.pop).clamp(0.2, 1.5);
            a.roots[p] = (a.roots[p] + 0.5 * e).min(2.5);
            w.aware[i] += 0.05 * e * (a.pop / pop).min(1.0) * (1.0 - w.aware[i]);
            amount = e;
        }
        OP_RECRUIT => {
            let supporters = w.support[i] * pop;
            amount = (4.0 + supporters * 0.004 + (pop * w.aware[i]).sqrt() * 0.03) * (1.0 + rep).max(0.3);
            w.org[i] += amount;
        }
        OP_FUNDRAISE => {
            let supporters = w.support[i] * pop * w.wealth[c];
            amount = (400.0 + supporters * 0.4 + w.parties[p].donors.sqrt() * 500.0) * (1.0 + rep).max(0.3);
            w.parties[p].money += amount as f64;
        }
        OP_PETITION => {
            amount = (w.org[i] * 40.0 * (0.5 + w.aware[i]) * 0.7).min(pop * 0.03);
            w.parties[p].sigs += amount;
            check_qualified(w, p);
        }
        OP_RALLY => {
            w.aware[i] += 0.05 * (1.0 - w.aware[i]);
            w.org[i] += 2.0;
            w.parties[p].rep = (w.parties[p].rep + 0.005).min(1.0);
            let l = w.parties[p].leader;
            if l != NONE {
                w.pols[l as usize].recog = (w.pols[l as usize].recog + 0.03).min(1.0);
            }
        }
        OP_DONOR => {
            let seats: u16 = w.parties[p].seats.iter().sum();
            let chance = 0.25 + 0.4 * rep + 0.03 * seats as f32;
            if unit(key(w.seed, w.day as u64, p as u64, 40 + op.target as u64)) < chance && w.parties[p].donors < 60.0 {
                w.parties[p].donors += 1.0;
                amount = 1.0;
            }
            if p == PLAYER {
                w.push_log(L_DONOR, p as i32, 0, 0, amount);
            }
        }
        OP_CAMPAIGN => {
            let s = &mut w.seats[op.arg as usize];
            s.camp[p] = (s.camp[p] + 0.35).min(1.6);
            let cand = s.cand[p];
            if cand != NONE {
                w.pols[cand as usize].recog = (w.pols[cand as usize].recog + 0.02).min(1.0);
            }
            amount = 0.35;
        }
        _ => {}
    }
    if p == PLAYER && !w.ai_only && op.kind != OP_DONOR {
        w.push_log(L_OP_DONE, op.kind as i32, if op.kind == OP_CAMPAIGN { op.arg } else { op.target }, p as i32, amount);
    }
}

pub fn ad_cost(w: &World, county: i32, tier: i32) -> f32 {
    let pop = if county < 0 { w.state_pop } else { w.pop[county as usize] };
    (if county < 0 { 0.04 } else { 0.03 }) * pop * tier as f32
}

pub fn buy_ads(w: &mut World, p: usize, county: i32, tier: i32) -> Result<(), &'static str> {
    if !(1..=3).contains(&tier) || county >= w.nc as i32 {
        return Err("bad ad buy");
    }
    let cost = ad_cost(w, county, tier);
    if w.parties[p].money < cost as f64 {
        return Err("not enough money");
    }
    w.parties[p].money -= cost as f64;
    let range = if county < 0 { 0..w.nc } else { county as usize..county as usize + 1 };
    for c in range {
        let i = c * P + p;
        w.press[i] = (w.press[i] + tier as f32).min(3.0);
        w.aware[i] += 0.04 * tier as f32 * (1.0 - w.aware[i]);
    }
    Ok(())
}

pub fn buy_sigs(w: &mut World, p: usize, n: f32) -> Result<(), &'static str> {
    if w.parties[p].qualified {
        return Err("already on the ballot");
    }
    let n = n.clamp(0.0, w.need_sigs);
    let cost = n * SIG_PRICE;
    if n <= 0.0 || w.parties[p].money < cost as f64 {
        return Err("not enough money");
    }
    w.parties[p].money -= cost as f64;
    w.parties[p].sigs += n;
    check_qualified(w, p);
    Ok(())
}

pub fn bribe(w: &mut World, ct: &Content, p: usize, idx: usize) -> Result<(), &'static str> {
    let b = ct.bribes.get(idx).ok_or("no such option")?;
    if !uses_money(w.parties[p].kind) {
        return Err("party cannot act");
    }
    let cost = b.cost + b.cost_per_need * w.need_sigs;
    if w.parties[p].money < cost as f64 {
        return Err("not enough money");
    }
    match b.effect.as_str() {
        "sigs" => {
            if w.parties[p].qualified {
                return Err("already on the ballot");
            }
            w.parties[p].sigs += b.v * w.need_sigs;
            check_qualified(w, p);
        }
        "buzz" => {
            for c in 0..w.nc {
                if w.aware[c * P + p] > 0.0 {
                    w.press[c * P + p] = (w.press[c * P + p] + b.v).min(3.0);
                }
            }
        }
        "camp" => {
            let l = w.parties[p].leader;
            let _ = l;
            if w.parties[p].race == NONE {
                return Err("your leader is not in a race");
            }
            let s = w.parties[p].race as usize;
            w.seats[s].camp[p] = (w.seats[s].camp[p] + b.v).min(2.4);
        }
        _ => return Err("unknown effect"),
    }
    w.parties[p].money -= cost as f64;
    w.parties[p].heat += b.heat;
    w.push_log(L_BRIBE, p as i32, idx as i32, 0, 0.0);
    Ok(())
}

pub fn set_platform(w: &mut World, p: usize, issue: usize, pos: i8) -> Result<(), &'static str> {
    if issue >= K || !(-2..=2).contains(&pos) {
        return Err("bad platform value");
    }
    let old = w.parties[p].platform[issue];
    if old == pos {
        return Ok(());
    }
    if w.day - w.parties[p].founded > 120 {
        // Voters notice a party that changes its mind.
        w.parties[p].rep = (w.parties[p].rep - 0.03 * (pos - old).abs() as f32).max(-1.0);
    }
    w.parties[p].platform[issue] = pos;
    w.parties[p].last_platform_day = w.day;
    w.refresh_appeal();
    w.push_log(L_PLATFORM, p as i32, issue as i32, pos as i32, 0.0);
    Ok(())
}

/// The day of the next election for this seat.
pub fn seat_election_day(s: &Seat) -> i32 {
    cal::election_day(s.next_year as i32)
}

pub fn file(w: &mut World, p: usize, s: usize, use_leader: bool, deadline: i32) -> Result<i32, &'static str> {
    if s >= w.seats.len() {
        return Err("no such seat");
    }
    let (kind, ed) = (w.seats[s].kind, seat_election_day(&w.seats[s]));
    if w.day >= ed - deadline {
        return Err("the filing deadline has passed");
    }
    if ed - w.day > 420 {
        return Err("filing has not opened for that election yet");
    }
    if kind >= COUNTY && !w.parties[p].qualified {
        return Err("your party is not on the ballot yet: finish the petition first");
    }
    if w.seats[s].cand[p] != NONE {
        return Err("you already have a candidate in that race");
    }
    let pol = if use_leader {
        let l = w.parties[p].leader;
        if l == NONE {
            return Err("no leader");
        }
        if w.seats.iter().any(|x| x.cand[p] == l || x.elect == l) {
            return Err("your leader is already running or waiting to take office");
        }
        l
    } else {
        let cost = RECRUIT_COST[kind as usize];
        if uses_money(w.parties[p].kind) {
            if w.parties[p].money < cost as f64 {
                return Err("not enough money to recruit and file a candidate");
            }
            w.parties[p].money -= cost as f64;
        }
        let mut seq = Seq(key(w.seed, w.day as u64, s as u64, 50 + p as u64));
        let y = w.year();
        let i = w.try_alloc_pol(p as u8, &mut seq, y);
        if i == NONE {
            return Err("no one is available to recruit right now");
        }
        let lift = (w.parties[p].rep * 15.0).clamp(-10.0, 12.0) as i32;
        let pol = &mut w.pols[i as usize];
        pol.cha = (pol.cha as i32 + lift).clamp(20, 95) as u8;
        pol.skl = (pol.skl as i32 + lift).clamp(20, 95) as u8;
        i
    };
    w.seats[s].cand[p] = pol;
    if use_leader {
        w.parties[p].race = s as i32;
    }
    if p == PLAYER {
        w.push_log(L_FILED, s as i32, pol, p as i32, 0.0);
    }
    Ok(pol)
}

pub fn withdraw(w: &mut World, p: usize, s: usize) -> Result<(), &'static str> {
    if s >= w.seats.len() || w.seats[s].cand[p] == NONE {
        return Err("no candidate there");
    }
    let pol = w.seats[s].cand[p];
    w.seats[s].cand[p] = NONE;
    w.seats[s].camp[p] = 0.0;
    if w.parties[p].race == s as i32 {
        w.parties[p].race = NONE;
    }
    if pol != w.parties[p].leader && w.pols[pol as usize].status == 1 {
        w.pols[pol as usize].status = 0;
    }
    for o in w.parties[p].ops.iter_mut() {
        if o.kind == OP_CAMPAIGN && o.arg == s as i32 {
            *o = Op::default();
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ elections

/// Expected (or, with `noisy`, actual) vote shares for a seat among the filed candidates.
pub fn seat_shares(w: &World, s: usize, noisy: bool) -> [f32; P] {
    let seat = &w.seats[s];
    let k = seat.kind as usize;
    let local = seat.kind <= MAYOR;
    let mut m = [f32::NEG_INFINITY; P];
    let mut n = 0;
    for p in 0..P {
        let c = seat.cand[p];
        if c == NONE {
            continue;
        }
        n += 1;
        let pol = &w.pols[c as usize];
        let q = (pol.cha as f32 + pol.skl as f32) / 200.0 * 1.4 - 0.7 + pol.recog * 0.6;
        let mut v = KQ[k] * q + seat.camp[p] - pol.taint * 1.2;
        if seat.holder == c {
            v += 0.25;
        }
        if p == DEM {
            v += seat.tilt;
        } else if p == REP {
            v -= seat.tilt;
        }
        if local {
            // Established parties have standing local networks; newcomers build roots by canvassing.
            v += if p < 2 { 0.8 } else { w.arenas[seat.area as usize].roots[p] };
        }
        if noisy {
            v += normal(key(w.seed, w.day as u64, s as u64, 200 + p as u64)) * 0.10 + normal(key(w.seed, w.day as u64, 99_999, 300 + p as u64)) * 0.04;
        }
        m[p] = v;
    }
    let mut out = [0f32; P];
    if n == 0 {
        return out;
    }
    let add = |c: usize, weight: f32, out: &mut [f32; P]| {
        let mut wt = [0f32; P];
        let mut sum = 0f32;
        for p in 0..P {
            if m[p] == f32::NEG_INFINITY {
                continue;
            }
            let mut sup = w.support[c * P + p];
            if local {
                // Local races are mostly about the person: partisanship counts for less.
                sup = 0.6 * sup + 0.4 / n as f32;
            }
            wt[p] = sup * fmath::exp(m[p]);
            sum += wt[p];
        }
        if sum > 0.0 {
            for p in 0..P {
                out[p] += weight * wt[p] / sum;
            }
        }
    };
    if seat.kind == GOVERNOR {
        for c in 0..w.nc {
            add(c, w.pop[c], &mut out);
        }
    } else {
        add(w.seat_county(seat), 1.0, &mut out);
    }
    let norm = |o: &mut [f32; P]| {
        let t: f32 = o.iter().sum();
        if t > 0.0 {
            o.iter_mut().for_each(|x| *x /= t);
        }
    };
    norm(&mut out);
    if n >= 3 && !local {
        // Plurality squeeze: voters drift away from candidates they think cannot win.
        for x in out.iter_mut() {
            if *x < 0.15 {
                *x *= 0.55 + 3.0 * *x;
            }
        }
        norm(&mut out);
    }
    out
}

fn elections(w: &mut World, y: i32) {
    let up: Vec<usize> = (0..w.seats.len()).filter(|&s| w.seats[s].next_year as i32 == y).collect();
    if up.is_empty() {
        return;
    }
    let results: Vec<[f32; P]> = {
        let wr: &World = w;
        #[cfg(feature = "parallel")]
        {
            use rayon::prelude::*;
            up.par_iter().with_min_len(32).map(|&s| seat_shares(wr, s, true)).collect()
        }
        #[cfg(not(feature = "parallel"))]
        {
            up.iter().map(|&s| seat_shares(wr, s, true)).collect()
        }
    };
    let mut votes = [0f32; P];
    let mut total = 0f32;
    let mut gov_share = [0f32; P];
    let mut gov_up = false;
    for (n, &s) in up.iter().enumerate() {
        let sh = results[n];
        let kind = w.seats[s].kind;
        let mut win = NO_PARTY as usize;
        let mut best = 0f32;
        for p in 0..P {
            if sh[p] > best {
                best = sh[p];
                win = p;
            }
        }
        if kind == HOUSE || (kind == SENATE && w.seats.iter().all(|x| x.kind != HOUSE)) {
            for p in 0..P {
                votes[p] += sh[p] * w.seats[s].voters;
            }
            total += w.seats[s].voters;
        }
        if kind == GOVERNOR {
            gov_share = sh;
            gov_up = true;
        }
        let cands = w.seats[s].cand;
        for p in 0..P {
            let c = cands[p];
            if c == NONE {
                continue;
            }
            let won = p == win;
            let pol = &mut w.pols[c as usize];
            if won {
                pol.wins = pol.wins.saturating_add(1);
                pol.recog = (pol.recog + 0.1).min(1.0);
            } else {
                pol.losses = pol.losses.saturating_add(1);
            }
            let is_leader = w.parties[p].leader == c;
            if uses_money(w.parties[p].kind) {
                let rep = w.parties[p].rep;
                let d = if won { 0.006 * (kind as f32 + 1.0) * (0.7 - rep).max(0.0) } else { -0.003 };
                w.parties[p].rep = (rep + d).clamp(-1.0, 1.0);
            }
            if kind == GOVERNOR && won || (p == PLAYER && !w.ai_only) || (is_leader && p >= PLAYER && kind >= HOUSE) {
                w.push_log(if won { L_ELECTED } else { L_DEFEATED }, s as i32, c, p as i32, sh[p]);
            }
            // Unsuccessful challengers without an office leave the pool unless they lead a party.
            if !won && !is_leader && w.pols[c as usize].status == 1 {
                w.pols[c as usize].status = 0;
            }
        }
        let seat = &mut w.seats[s];
        seat.last_share = sh;
        seat.last_year = y as u16;
        seat.cand = [NONE; P];
        seat.camp = [0.0; P];
        seat.next_year += seat.term as u16;
        if win != NO_PARTY as usize {
            seat.elect = cands[win];
            seat.elect_party = win as u8;
        }
    }
    for pt in w.parties.iter_mut() {
        pt.race = NONE;
        for o in pt.ops.iter_mut() {
            if o.kind == OP_CAMPAIGN {
                *o = Op::default();
            }
        }
    }
    // Ballot status is tested at gubernatorial elections (a simplification of the real vote tests).
    if gov_up {
        for p in 2..P {
            if !w.parties[p].active || !w.parties[p].qualified {
                continue;
            }
            let leg = if total > 0.0 { votes[p] / total } else { 0.0 };
            if gov_share[p].max(leg) < w.retain {
                w.parties[p].qualified = false;
                w.parties[p].sigs = 0.0;
                w.push_log(L_LOST_STATUS, p as i32, 0, 0, gov_share[p].max(leg));
            }
        }
    }
}

fn inaugurate(w: &mut World, y: i32) {
    for s in 0..w.seats.len() {
        let e = w.seats[s].elect;
        if e == NONE {
            continue;
        }
        let party = w.seats[s].elect_party;
        w.seats[s].elect = NONE;
        w.seats[s].elect_party = NO_PARTY;
        if w.pols[e as usize].status == 0 {
            continue;
        }
        let old = w.seats[s].holder;
        if old != NONE && old != e && w.pols[old as usize].seat == s as i32 {
            w.pols[old as usize].seat = NONE;
            w.pols[old as usize].status = 1;
            if w.seats[s].kind >= SENATE {
                w.push_log(L_RETIRED, old, s as i32, 0, 0.0);
            }
        }
        let prev = w.pols[e as usize].seat;
        if prev != NONE && prev != s as i32 {
            // Moving up: the old seat is filled by an appointee of the same party.
            w.pols[e as usize].seat = NONE;
            w.seats[prev as usize].holder = NONE;
            appoint(w, prev as usize, w.seats[prev as usize].holder_party);
        }
        let kind = w.seats[s].kind;
        let pol = &mut w.pols[e as usize];
        pol.status = 2;
        pol.seat = s as i32;
        pol.top = pol.top.max(kind);
        w.seats[s].holder = e;
        w.seats[s].holder_party = party;
    }
    w.recount();
    for kind in [HOUSE, SENATE] {
        let mut lead = 0;
        for p in 0..P {
            if w.parties[p].seats[kind as usize] > w.parties[lead].seats[kind as usize] {
                lead = p;
            }
        }
        let n = w.parties[lead].seats[kind as usize];
        if n > 0 {
            w.push_log(L_CHAMBER, kind as i32, y, lead as i32, n as f32);
        }
    }
}

// ------------------------------------------------------------------ calendar hooks

fn monthly(w: &mut World, ct: &Content, _y: i32) {
    let month = (w.day / 30) as u64;
    let leaders: Vec<i32> = w.parties.iter().map(|p| p.leader).collect();
    for s in 0..w.seats.len() {
        let h = w.seats[s].holder;
        let party = w.seats[s].holder_party as usize;
        if h == NONE || party >= P {
            continue;
        }
        // Office-holders make a newer party better known where they serve.
        if party >= 2 && w.seats[s].kind != GOVERNOR {
            let c = w.seat_county(&w.seats[s]);
            let i = c * P + party;
            w.aware[i] += 0.008 * (1.0 + w.seats[s].kind as f32 * 0.5) * (1.0 - w.aware[i]);
        }
        // Scandals happen to fictional politicians only, at the same odds whatever their party.
        let pol = &w.pols[h as usize];
        if pol.real != NONE || ct.scandals.is_empty() || leaders.contains(&h) {
            continue;
        }
        let hazard = 0.0015 * (1.6 - pol.int as f32 / 100.0);
        let k = key(w.seed, month, h as u64, 60);
        if unit(k) >= hazard {
            continue;
        }
        let idx = (rng::mix(k) % ct.scandals.len() as u64) as usize;
        let sev = ct.scandals[idx].severity;
        w.pols[h as usize].taint += sev;
        if uses_money(w.parties[party].kind) {
            w.parties[party].rep = (w.parties[party].rep - 0.03 * sev).max(-1.0);
        }
        let resigned = sev > 0.85;
        let kind = w.seats[s].kind;
        let home = kind <= MAYOR && w.seats[s].area as u32 == w.home_arena;
        if kind >= SENATE || party >= PLAYER || home {
            w.push_log(L_SCANDAL, h, idx as i32, party as i32, if resigned { 1.0 } else { 0.0 });
        }
        if resigned {
            w.pols[h as usize].status = 0;
            for x in w.seats.iter_mut() {
                for p in 0..P {
                    if x.cand[p] == h {
                        x.cand[p] = NONE;
                    }
                }
                if x.elect == h {
                    x.elect = NONE;
                    x.elect_party = NO_PARTY;
                }
            }
            appoint(w, s, party as u8);
        }
    }
    if w.parties[PLAYER].leader != NONE {
        let l = w.parties[PLAYER].leader as usize;
        if w.pols[l].seat != NONE {
            w.pols[l].recog = (w.pols[l].recog + 0.004).min(1.0);
        }
    }
    w.recount();
}

fn new_year(w: &mut World, ct: &Content, y: i32) {
    inaugurate(w, y);
    let leaders: Vec<i32> = w.parties.iter().map(|p| p.leader).collect();
    // Careers: people age, fade and leave; slots return to the pool.
    for i in 0..w.pols.len() {
        let pol = &mut w.pols[i];
        if pol.status == 0 {
            continue;
        }
        pol.taint = if pol.taint > 1e-3 { pol.taint * 0.5 } else { 0.0 };
        let age = y - pol.born as i32;
        let is_leader = leaders.contains(&(i as i32));
        if pol.status == 2 {
            pol.recog = (pol.recog + 0.03).min(1.0);
        } else if !is_leader {
            let k = key(w.seed, y as u64, i as u64, 70);
            if age > 60 || pol.losses >= 2 || unit(k) < 0.35 {
                let busy = w.seats.iter().any(|s| s.cand.contains(&(i as i32)) || s.elect == i as i32);
                if !busy {
                    w.pols[i].status = 0;
                }
            }
        }
    }
    // Party leaders step down at 76; a fictional successor takes over.
    for p in PLAYER..P {
        let l = w.parties[p].leader;
        if !w.parties[p].active || l == NONE || y - (w.pols[l as usize].born as i32) < 76 {
            continue;
        }
        if w.is_candidate(l) {
            continue;
        }
        let mut seq = Seq(key(w.seed, y as u64, p as u64, 71));
        let nl = w.alloc_pol(p as u8, &mut seq, y);
        w.parties[p].leader = nl;
        if w.pols[l as usize].seat == NONE {
            w.pols[l as usize].status = 0;
        }
    }
    // Rival parties: founded by fictional politicians, dissolved if they go nowhere.
    w.recount();
    for p in 5..P {
        if w.parties[p].active {
            let seats: u16 = w.parties[p].seats.iter().sum();
            if w.parties[p].statewide < 0.004 && seats == 0 {
                w.parties[p].low_years += 1;
            } else {
                w.parties[p].low_years = 0;
            }
            if w.parties[p].low_years >= 6 {
                dissolve(w, p);
            }
        } else if unit(key(w.seed, y as u64, p as u64, 72)) < 0.22 {
            found_rival(w, ct, p, y);
        }
    }
    // One compressed history row per year, in a ring.
    let mut row = YearRow { year: y as u16, money: w.parties[PLAYER].money as f32, gov: w.seats[w.gov_seat as usize].holder_party, ..YearRow::default() };
    for p in 0..P {
        let pt = &w.parties[p];
        row.support[p] = pt.statewide;
        row.house[p] = pt.seats[HOUSE as usize];
        row.senate[p] = pt.seats[SENATE as usize];
        row.local[p] = pt.seats[COUNCIL as usize] + pt.seats[MAYOR as usize] + pt.seats[COUNTY as usize];
    }
    let i = w.years_n as usize % YEARS;
    w.years[i] = row;
    w.years_n += 1;
}

fn dissolve(w: &mut World, p: usize) {
    for c in 0..w.nc {
        let i = c * P + p;
        w.support[i] = 0.0;
        w.aware[i] = 0.0;
        w.org[i] = 0.0;
        w.press[i] = 0.0;
        w.base[i] = w.openness[c];
        w.anchor[i] = w.openness[c];
    }
    for a in w.arenas.iter_mut() {
        a.roots[p] = 0.0;
    }
    for s in w.seats.iter_mut() {
        s.cand[p] = NONE;
        s.camp[p] = 0.0;
        if s.elect_party == p as u8 {
            s.elect = NONE;
            s.elect_party = NO_PARTY;
        }
    }
    for pol in w.pols.iter_mut() {
        if pol.party == p as u8 && pol.status == 1 {
            pol.status = 0;
        }
    }
    let color = w.parties[p].color;
    w.parties[p] = Party { color, leader: NONE, race: NONE, home: NONE, ..Party::default() };
    w.push_log(L_DISSOLVED, p as i32, 0, 0, 0.0);
}

fn found_rival(w: &mut World, ct: &Content, p: usize, y: i32) {
    let mut seq = Seq(key(w.seed, y as u64, p as u64, 73));
    let arena = (seq.next() % w.arenas.len() as u64) as usize;
    let c = w.arenas[arena].county as usize;
    let mut name = String::new();
    for _ in 0..8 {
        let a = &ct.names.party_a[(seq.next() % ct.names.party_a.len().max(1) as u64) as usize];
        let b = &ct.names.party_b[(seq.next() % ct.names.party_b.len().max(1) as u64) as usize];
        name = format!("{a} {b}");
        if !w.parties.iter().any(|x| x.active && x.name == name) {
            break;
        }
    }
    let leader = w.alloc_pol(p as u8, &mut seq, y);
    let mut platform = [0i8; K];
    for k in 0..K {
        // Start near the home county's views, with a deliberate quirk or two.
        let v = w.ideal[c * K + k] + (seq.unit() - 0.5) * 2.4;
        platform[k] = v.round().clamp(-2.0, 2.0) as i8;
    }
    for c2 in 0..w.nc {
        let i = c2 * P + p;
        w.base[i] = w.openness[c2];
        w.anchor[i] = w.openness[c2];
        w.support[i] = 0.0;
        w.aware[i] = 0.0;
        w.org[i] = 0.0;
        w.press[i] = 0.0;
    }
    w.aware[c * P + p] = 0.05;
    w.org[c * P + p] = 6.0;
    w.arenas[arena].roots[p] = 0.3;
    let color = w.parties[p].color;
    w.parties[p] = Party {
        active: true,
        kind: RIVAL,
        name,
        color,
        platform,
        leader,
        race: NONE,
        founded: w.day,
        home: arena as i32,
        money: 6000.0 + seq.unit() as f64 * 6000.0,
        scruples: 0.15 + seq.unit() * 0.85,
        last_platform_day: w.day,
        ..Party::default()
    };
    w.refresh_appeal();
    w.push_log(L_FOUNDED, p as i32, 0, 0, 0.0);
}

// ------------------------------------------------------------------ events

pub fn apply_effects(w: &mut World, p: usize, effects: &[Effect]) {
    let home = if w.parties[p].home != NONE { w.arenas[w.parties[p].home as usize].county as usize } else { 0 };
    for e in effects {
        let state = e.scope == "state";
        let range = if state { 0..w.nc } else { home..home + 1 };
        match e.op.as_str() {
            "money" => w.parties[p].money += e.v as f64,
            "rep" => w.parties[p].rep = (w.parties[p].rep + e.v).clamp(-1.0, 1.0),
            "heat" => w.parties[p].heat = (w.parties[p].heat + e.v).max(0.0),
            "donors" => w.parties[p].donors = (w.parties[p].donors + e.v).clamp(0.0, 60.0),
            "sigs" => {
                if !w.parties[p].qualified {
                    w.parties[p].sigs = (w.parties[p].sigs + e.v * w.need_sigs).max(0.0);
                    check_qualified(w, p);
                }
            }
            "recognition" => {
                let l = w.parties[p].leader;
                if l != NONE {
                    w.pols[l as usize].recog = (w.pols[l as usize].recog + e.v).clamp(0.0, 1.0);
                }
            }
            "volunteers" => {
                for c in range {
                    w.org[c * P + p] = (w.org[c * P + p] + e.v).max(0.0);
                }
            }
            "awareness" => {
                for c in range {
                    let i = c * P + p;
                    w.aware[i] = (w.aware[i] + e.v * (1.0 - w.aware[i])).clamp(0.0, 1.0);
                }
            }
            "buzz" => {
                for c in range {
                    let i = c * P + p;
                    if w.aware[i] > 0.0 {
                        w.press[i] = (w.press[i] + e.v).clamp(-2.0, 3.0);
                    }
                }
            }
            _ => {}
        }
    }
}

fn eligible(w: &World, p: usize, c: &Cond) -> bool {
    let pt = &w.parties[p];
    let seats: u16 = pt.seats.iter().sum();
    w.day - pt.founded >= c.min_day
        && pt.heat >= c.min_heat
        && pt.money >= c.min_money as f64
        && (!c.needs_office || (pt.leader != NONE && w.pols[pt.leader as usize].seat != NONE))
        && c.qualified.map_or(true, |q| q == pt.qualified)
        && seats as i32 >= c.min_seats
}

fn pick_event(w: &World, ct: &Content, p: usize, salt: u64) -> Option<usize> {
    let total: f32 = ct.events.iter().filter(|e| eligible(w, p, &e.when)).map(|e| e.weight).sum();
    if total <= 0.0 {
        return None;
    }
    let mut r = unit(key(w.seed, w.day as u64, p as u64, salt)) * total;
    for (i, e) in ct.events.iter().enumerate() {
        if eligible(w, p, &e.when) {
            r -= e.weight;
            if r <= 0.0 {
                return Some(i);
            }
        }
    }
    None
}

fn events_daily(w: &mut World, ct: &Content) {
    if ct.events.is_empty() {
        return;
    }
    for i in 0..PENDING {
        if w.pending[i].active && w.day - w.pending[i].day > 45 {
            w.pending[i].active = false;
        }
    }
    for p in PLAYER..P {
        if !w.parties[p].active {
            continue;
        }
        if w.parties[p].kind == HUMAN {
            if w.day < w.next_event_day {
                continue;
            }
            w.next_event_day = w.day + 25 + (key(w.seed, w.day as u64, 0, 80) % 30) as i32;
            if let (Some(e), Some(slot)) = (pick_event(w, ct, p, 81), w.pending.iter().position(|x| !x.active)) {
                w.pending[slot] = Pending { active: true, event: e as u16, day: w.day };
            }
        } else if (w.day + p as i32 * 13) % 41 == 0 {
            // AI parties meet the same events and choose for themselves.
            if let Some(e) = pick_event(w, ct, p, 82) {
                let ch = &ct.events[e].choices;
                if ch.is_empty() {
                    continue;
                }
                let r = unit(key(w.seed, w.day as u64, p as u64, 83));
                // Cautious parties avoid choices that add heat.
                let mut pick = (r * ch.len() as f32) as usize % ch.len();
                let hot = |c: &Choice| c.effects.iter().any(|x| x.op == "heat" && x.v > 0.0);
                if hot(&ch[pick]) && unit(rng::mix(key(w.seed, w.day as u64, p as u64, 84))) < w.parties[p].scruples {
                    pick = ch.iter().position(|c| !hot(c)).unwrap_or(pick);
                }
                let fx = ch[pick].effects.clone();
                apply_effects(w, p, &fx);
            }
        }
    }
}

pub fn choose_event(w: &mut World, ct: &Content, slot: usize, choice: usize) -> Result<(), &'static str> {
    if slot >= PENDING || !w.pending[slot].active {
        return Err("no such event");
    }
    let e = ct.events.get(w.pending[slot].event as usize).ok_or("no such event")?;
    let c = e.choices.get(choice).ok_or("no such choice")?;
    w.pending[slot].active = false;
    let fx = c.effects.clone();
    apply_effects(w, PLAYER, &fx);
    Ok(())
}

// ------------------------------------------------------------------ AI

fn ai_daily(w: &mut World, ct: &Content, y: i32) {
    let ed = cal::election_day(y);
    let season = w.day <= ed && ed - w.day < 120;
    for p in 0..P {
        if !w.parties[p].active {
            continue;
        }
        match w.parties[p].kind {
            MAJOR => ai_major(w, p, season),
            RIVAL => ai_rival(w, ct, p, ed),
            _ => {}
        }
    }
}

/// Established parties answer threats: wherever an insurgent party is growing, or the two-party
/// race is close in election season, they add campaign pressure. Fixed work per day.
fn ai_major(w: &mut World, p: usize, season: bool) {
    let other = 1 - p;
    for n in 0..AI_EVALS {
        let c = (w.parties[p].cursor as usize + n) % w.nc;
        let r = c * P;
        let threat: f32 = (2..P).map(|q| w.support[r + q]).sum();
        let close = (1.0 - (w.support[r + p] - w.support[r + other]).abs() * 4.0).max(0.0);
        let target = (threat * 9.0 + if season { close * 0.6 } else { 0.0 }).min(3.0);
        if w.press[r + p] < target {
            w.press[r + p] = (w.press[r + p] + 0.3).min(target);
        }
    }
    w.parties[p].cursor = ((w.parties[p].cursor as usize + AI_EVALS) % w.nc) as u32;
}

fn appeal(w: &World, p: usize, c: usize) -> f32 {
    w.appeal[c * P + p]
}

/// Insurgent parties (and the player's party in AI-only runs) use the same operations, the same
/// prices and the same rules as a human player.
fn ai_rival(w: &mut World, ct: &Content, p: usize, ed: i32) {
    let day = w.day as u64;
    let home_arena = w.parties[p].home.max(0) as usize;
    let home = w.arenas[home_arena].county as usize;
    let money = w.parties[p].money;
    let org_n = w.parties[p].organizers;
    if org_n < 10 && money > 8_000.0 + org_n as f64 * 6_000.0 && w.parties[p].net > 110.0 * (org_n as f32 + 1.0) - 400.0 {
        w.parties[p].organizers += 1;
        w.parties[p].money -= 1500.0;
    }
    if !w.parties[p].qualified && money > 30_000.0 {
        let n = ((money * 0.3) as f32 / SIG_PRICE).min(w.need_sigs - w.parties[p].sigs + 1.0);
        let _ = buy_sigs(w, p, n);
    }
    // Shortcuts: the less scrupulous the party, the likelier it reaches for one.
    let sc = w.parties[p].scruples;
    if !ct.bribes.is_empty() && sc < 0.6 && w.parties[p].invest == 0 && unit(key(w.seed, day, p as u64, 30)) < 0.004 * (1.0 - sc) {
        let idx = (key(w.seed, day, p as u64, 31) % ct.bribes.len() as u64) as usize;
        let _ = bribe(w, ct, p, idx);
    }
    // Adapt the platform now and then toward the voters the party can actually reach.
    if w.day - w.parties[p].last_platform_day > 240 && (w.day + p as i32) % 30 == 0 {
        let mut best = (0usize, 0f32);
        for k in 0..K {
            let (mut num, mut den) = (0f32, 0f32);
            for n in 0..AI_EVALS {
                let c = (w.parties[p].cursor as usize + n * 7) % w.nc;
                let wt = w.pop[c] * (0.05 + w.aware[c * P + p]);
                num += w.ideal[c * K + k] * wt;
                den += wt;
            }
            let gap = num / den.max(1.0) - w.parties[p].platform[k] as f32;
            if gap.abs() > best.1.abs() {
                best = (k, gap);
            }
        }
        if best.1.abs() > 1.0 {
            let np = (w.parties[p].platform[best.0] + best.1.signum() as i8).clamp(-2, 2);
            let _ = set_platform(w, p, best.0, np);
        } else {
            w.parties[p].last_platform_day = w.day;
        }
    }
    let used = w.parties[p].ops.iter().filter(|o| o.kind != OP_NONE).count();
    if used >= slots(&w.parties[p]) {
        return;
    }
    // Pick the most promising county among a fixed sample.
    let mut best_c = home;
    let mut best_s = f32::MIN;
    let mut rich_c = home;
    let mut rich = 0f32;
    let mut busy = [usize::MAX; OPS];
    for (n, o) in w.parties[p].ops.iter().enumerate() {
        if o.kind != OP_NONE && o.kind != OP_TOWN && o.kind != OP_CAMPAIGN {
            busy[n] = o.target as usize;
        }
    }
    for n in 0..AI_EVALS {
        let c = if n == 0 { home } else { (w.parties[p].cursor as usize + n * 5) % w.nc };
        if busy.contains(&c) {
            continue;
        }
        let i = c * P + p;
        let known = w.aware[i] > 0.0 || c == home;
        let s = appeal(w, p, c) + 0.5 * fmath::ln(w.openness[c] / 0.03) - 0.2 * fmath::ln(w.pop[c] / 50_000.0).max(-2.0)
            + 3.0 * w.support[i]
            + if c == home { 1.2 } else { 0.0 }
            + if known { 0.4 } else { 0.0 }
            + unit(key(w.seed, day, c as u64, 32 + p as u64)) * 0.5;
        if s > best_s {
            best_s = s;
            best_c = c;
        }
        let sup = w.support[i] * w.pop[c];
        if sup > rich {
            rich = sup;
            rich_c = c;
        }
    }
    w.parties[p].cursor = ((w.parties[p].cursor as usize + AI_EVALS * 5) % w.nc) as u32;
    let c = best_c;
    let i = c * P + p;
    let r = unit(key(w.seed, day, p as u64, 33));
    let to_election = ed - w.day;
    let leader = w.parties[p].leader;
    let _ = leader;
    let leader_seat = if w.parties[p].race != NONE { Some(w.parties[p].race as usize) } else { None };
    let coverage = w.org[i] * 4000.0 / w.pop[c];
    let res = if money < 600.0 {
        if money >= 150.0 { start_op(w, p, OP_FUNDRAISE, rich_c as i32, 0, false) } else { start_op(w, p, OP_CANVASS, home as i32, 0, false) }
    } else if let (Some(s), true) = (leader_seat, to_election > 0 && to_election < 150 && r < 0.6) {
        if w.seats[s].kind <= MAYOR && r < 0.3 {
            start_op(w, p, OP_TOWN, home_arena as i32, 0, false)
        } else {
            start_op(w, p, OP_CAMPAIGN, 0, s as i32, false)
        }
    } else if !w.parties[p].qualified && w.org[i] >= 8.0 && r < 0.45 {
        start_op(w, p, OP_PETITION, c as i32, 0, false)
    } else if coverage < 1.5 && r < 0.7 {
        start_op(w, p, OP_RECRUIT, c as i32, 0, false)
    } else if w.aware[i] < 0.6 {
        start_op(w, p, OP_CANVASS, c as i32, 0, false)
    } else if money > ad_cost(w, -1, 1) as f64 * 2.5 && r < 0.5 {
        buy_ads(w, p, -1, 1)
    } else if money > ad_cost(w, c as i32, 1) as f64 * 4.0 && w.press[i] < 1.5 && (r < 0.35 || (to_election > 0 && to_election < 60)) {
        buy_ads(w, p, c as i32, 1)
    } else if r < 0.15 && money > 4000.0 {
        start_op(w, p, OP_DONOR, home as i32, 0, false)
    } else if r < 0.3 && money > 2500.0 {
        start_op(w, p, OP_RALLY, c as i32, 0, false)
    } else if r < 0.5 {
        start_op(w, p, OP_FUNDRAISE, rich_c as i32, 0, false)
    } else {
        start_op(w, p, OP_CANVASS, c as i32, 0, false)
    };
    if res.is_err() && r < 0.5 {
        let _ = start_op(w, p, OP_CANVASS, home as i32, 0, false);
    }
}

/// Candidate filing for every AI-run party, 100 days before election day.
fn ai_filing(w: &mut World, y: i32) {
    let up: Vec<usize> = (0..w.seats.len()).filter(|&s| w.seats[s].next_year as i32 == y).collect();
    if up.is_empty() {
        return;
    }
    // Established parties.
    for p in 0..4 {
        if !w.parties[p].active {
            continue;
        }
        let major = p < 2;
        let mut minor_budget = (up.len() / 12).max(1);
        for &s in &up {
            if w.seats[s].cand[p] != NONE {
                continue;
            }
            let kind = w.seats[s].kind;
            let c = w.seat_county(&w.seats[s]);
            let holder = w.seats[s].holder;
            let own_holder = holder != NONE && w.seats[s].holder_party == p as u8;
            if major {
                let two = w.support[c * P] + w.support[c * P + 1];
                if kind != GOVERNOR && !own_holder && w.support[c * P + p] / two.max(0.01) < 0.2 {
                    continue; // leave hopeless seats uncontested, as real parties often do
                }
            } else {
                if !(w.parties[p].qualified && kind >= HOUSE) {
                    continue;
                }
                if kind != GOVERNOR {
                    if minor_budget == 0 || unit(key(w.seed, y as u64, s as u64, 90 + p as u64)) > 0.12 {
                        continue;
                    }
                    minor_budget -= 1;
                }
            }
            let mut cand = NONE;
            if own_holder {
                let h = &w.pols[holder as usize];
                let age = y - h.born as i32;
                let quit = if age > 64 { (age - 64) as f32 * 0.06 } else { 0.03 };
                if unit(key(w.seed, y as u64, holder as u64, 91)) >= quit && !w.is_candidate(holder) {
                    cand = holder;
                }
            }
            if cand == NONE && major && kind >= SENATE {
                // Promote the best-known member from the next chamber down.
                let below = if kind == GOVERNOR { SENATE } else { HOUSE };
                let mut best = 0f32;
                for (n, x) in w.seats.iter().enumerate() {
                    if x.kind != below || x.holder == NONE || x.holder_party != p as u8 || x.next_year as i32 == y {
                        continue;
                    }
                    if kind == SENATE && x.area as usize != c {
                        continue;
                    }
                    let h = &w.pols[x.holder as usize];
                    let score = h.cha as f32 + h.skl as f32 + h.recog * 60.0 + unit(key(w.seed, y as u64, n as u64, 92)) * 40.0;
                    if score > best && y - (h.born as i32) < 68 {
                        best = score;
                        cand = x.holder;
                    }
                }
                if cand != NONE && w.is_candidate(cand) {
                    cand = NONE;
                }
            }
            if cand == NONE {
                let mut seq = Seq(key(w.seed, y as u64, s as u64, 93 + p as u64));
                cand = w.try_alloc_pol(p as u8, &mut seq, y);
            }
            w.seats[s].cand[p] = cand;
        }
    }
    // Insurgent parties.
    for p in PLAYER..P {
        if !w.parties[p].active || w.parties[p].kind != RIVAL {
            continue;
        }
        let leader = w.parties[p].leader;
        let home_arena = w.parties[p].home.max(0) as u16;
        let home = w.arenas[home_arena as usize].county as usize;
        let cur_kind = if leader != NONE && w.pols[leader as usize].seat != NONE { w.seats[w.pols[leader as usize].seat as usize].kind as i32 } else { -1 };
        // The leader looks for the highest office with a real chance, else the best local race.
        if leader != NONE && !w.is_candidate(leader) {
            let mut best: Option<(usize, f32)> = None;
            for &s in &up {
                let seat = &w.seats[s];
                let kind = seat.kind;
                if seat.cand[p] != NONE || (kind >= COUNTY && !w.parties[p].qualified) {
                    continue;
                }
                let near = match kind {
                    COUNCIL | MAYOR => seat.area == home_arena,
                    GOVERNOR => true,
                    _ => seat.area as usize == home,
                };
                if !near || (kind as i32) < cur_kind || (kind as i32 == cur_kind && w.pols[leader as usize].seat != s as i32) {
                    continue;
                }
                w.seats[s].cand[p] = leader;
                let share = seat_shares(w, s, false)[p];
                let lead = seat_shares(w, s, false).iter().cloned().fold(0f32, f32::max);
                w.seats[s].cand[p] = NONE;
                let ok = share > lead * 0.75 || kind as i32 <= cur_kind.max(0);
                let score = if share > lead * 0.75 { 10.0 * kind as f32 + share } else { share };
                if ok && best.map_or(true, |b| score > b.1) {
                    best = Some((s, score));
                }
            }
            if let Some((s, _)) = best {
                let _ = file(w, p, s, true, 0);
            }
        }
        // Recruits where the party has a base.
        let mut filed = 0;
        for &s in &up {
            if filed >= up.len() {
                break;
            }
            let seat = &w.seats[s];
            let kind = seat.kind;
            if seat.cand[p] != NONE || (kind >= COUNTY && !w.parties[p].qualified) {
                continue;
            }
            let c = w.seat_county(seat);
            let strong = if kind <= MAYOR { w.arenas[seat.area as usize].roots[p] > 0.6 } else if kind == GOVERNOR { w.parties[p].statewide > 0.04 } else { w.support[c * P + p] > 0.10 };
            if strong && w.parties[p].money > RECRUIT_COST[kind as usize] as f64 * 3.0 && file(w, p, s, false, 0).is_ok() {
                filed += 1;
            }
        }
    }
}
