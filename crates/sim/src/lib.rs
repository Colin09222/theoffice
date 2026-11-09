//! Third Party Rising — simulation core.
//!
//! Design rules (see ARCHITECTURE.md):
//! * No UI code, no I/O, no clocks. The host hands in JSON text and gets JSON text back.
//! * Deterministic from a seed. Randomness is counter-based (`rng::key`) so the result does not
//!   depend on thread count or iteration order.
//! * World state has a fixed size, chosen when a state is loaded. Nothing grows while playing:
//!   politicians live in a recycled pool, the log and yearly history are rings.
//! * The AI has a fixed number of evaluations per party per day.

pub mod api;
pub mod data;
pub mod sim;
pub mod world;

pub use api::Engine;

/// Party slots. 0-3 are the established parties, 4 is the player, 5-7 are AI-founded rivals.
pub const P: usize = 8;
pub const DEM: usize = 0;
pub const REP: usize = 1;
pub const LIB: usize = 2;
pub const GRN: usize = 3;
pub const PLAYER: usize = 4;
/// Policy axes in a platform.
pub const K: usize = 8;
pub const NONE: i32 = -1;
pub const NO_PARTY: u8 = 255;
pub const SAVE_VERSION: u32 = 1;

/// Office kinds, lowest to highest.
pub const COUNCIL: u8 = 0;
pub const MAYOR: u8 = 1;
pub const COUNTY: u8 = 2;
pub const HOUSE: u8 = 3;
pub const SENATE: u8 = 4;
pub const GOVERNOR: u8 = 5;
pub const KINDS: usize = 6;

pub mod rng {
    //! Counter-based randomness: every draw is a pure function of (seed, day, entity, purpose).
    #[inline]
    pub fn mix(mut z: u64) -> u64 {
        z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    #[inline]
    pub fn key(seed: u64, a: u64, b: u64, c: u64) -> u64 {
        mix(mix(mix(seed ^ 0xA076_1D64_78BD_642F).wrapping_add(a)).wrapping_add(b.rotate_left(21)) ^ c.rotate_left(42))
    }
    /// Uniform in [0, 1).
    #[inline]
    pub fn unit(k: u64) -> f32 {
        ((k >> 40) as f32) * (1.0 / 16_777_216.0)
    }
    /// Roughly normal(0, 1): sum of four uniforms, rescaled.
    #[inline]
    pub fn normal(k: u64) -> f32 {
        let a = unit(k) + unit(mix(k)) + unit(mix(k ^ 0x51ED)) + unit(mix(k ^ 0xC0FFEE));
        (a - 2.0) * 1.732
    }
    /// Small sequential generator for setup code.
    pub struct Seq(pub u64);
    impl Seq {
        pub fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
            mix(self.0)
        }
        pub fn unit(&mut self) -> f32 {
            unit(self.next())
        }
        pub fn range(&mut self, lo: i32, hi: i32) -> i32 {
            lo + (self.next() % ((hi - lo + 1).max(1) as u64)) as i32
        }
    }
}

pub mod fmath {
    //! exp and ln written in plain IEEE arithmetic. Faster than libm, and — unlike libm — they
    //! give the same bits on Windows, Linux and WebAssembly, which is what keeps a seed replayable
    //! across builds. Relative error is below 1e-5, far finer than anything the game models.
    #[inline]
    pub fn exp(x: f32) -> f32 {
        let t = x.clamp(-80.0, 80.0) * 1.442_695;
        // Floor by truncation: `f32::floor` is a library call on baseline x86-64.
        let i = t as i32;
        let fl = (i - (t < i as f32) as i32) as f32;
        let y = (t - fl - 0.5) * 0.693_147_2;
        let p = 1.0 + y * (1.0 + y * (0.5 + y * (1.0 / 6.0 + y * (1.0 / 24.0 + y * (1.0 / 120.0)))));
        p * 1.414_213_5 * f32::from_bits(((fl as i32 + 127) as u32) << 23)
    }
    #[inline]
    pub fn ln(x: f32) -> f32 {
        let bits = x.max(1e-30).to_bits();
        let mut e = ((bits >> 23) & 255) as i32 - 127;
        let mut m = f32::from_bits((bits & 0x007F_FFFF) | 0x3F80_0000);
        if m > 1.414_213_5 {
            m *= 0.5;
            e += 1;
        }
        let t = (m - 1.0) / (m + 1.0);
        let t2 = t * t;
        e as f32 * 0.693_147_2 + 2.0 * t * (1.0 + t2 * (1.0 / 3.0 + t2 * (0.2 + t2 * (1.0 / 7.0))))
    }
    #[inline]
    pub fn tanh(x: f32) -> f32 {
        let e = exp(2.0 * x.clamp(-10.0, 10.0));
        (e - 1.0) / (e + 1.0)
    }
}

pub mod cal {
    //! Calendar. Day 0 is 1 January 2025.
    pub const EPOCH_YEAR: i32 = 2025;
    fn leap(y: i32) -> bool {
        (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
    }
    pub fn year_len(y: i32) -> i32 {
        if leap(y) { 366 } else { 365 }
    }
    const ML: [i32; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    /// (year, month 1-12, day 1-31, day of year 0-based)
    pub fn ymd(mut day: i32) -> (i32, i32, i32, i32) {
        let mut y = EPOCH_YEAR;
        while day >= year_len(y) {
            day -= year_len(y);
            y += 1;
        }
        let doy = day;
        let mut m = 0;
        loop {
            let l = ML[m] + if m == 1 && leap(y) { 1 } else { 0 };
            if day < l { break; }
            day -= l;
            m += 1;
        }
        (y, m as i32 + 1, day + 1, doy)
    }
    pub fn year_start(y: i32) -> i32 {
        (EPOCH_YEAR..y).map(year_len).sum()
    }
    pub fn day_of(y: i32, m: i32, d: i32) -> i32 {
        let mut n = year_start(y);
        for i in 0..(m - 1) as usize {
            n += ML[i] + if i == 1 && leap(y) { 1 } else { 0 };
        }
        n + d - 1
    }
    /// General election day: the Tuesday after the first Monday in November.
    pub fn election_day(y: i32) -> i32 {
        let nov1 = day_of(y, 11, 1);
        // 1 January 2025 was a Wednesday (weekday 3, with Sunday = 0).
        let wd = (nov1 + 3).rem_euclid(7);
        let first_monday = nov1 + (8 - wd).rem_euclid(7);
        first_monday + 1
    }
}

#[cfg(test)]
mod tests {
    use super::cal::*;
    #[test]
    fn fast_math() {
        for i in -400..400 {
            let x = i as f32 * 0.05;
            assert!((super::fmath::exp(x) / x.exp() - 1.0).abs() < 2e-5, "exp {x}");
            let y = x.exp();
            assert!((super::fmath::ln(y) - x).abs() < 2e-5 * x.abs().max(1.0), "ln {y}");
        }
    }
    #[test]
    fn calendar() {
        assert_eq!(ymd(0), (2025, 1, 1, 0));
        assert_eq!(ymd(day_of(2028, 2, 29)), (2028, 2, 29, 59));
        // Real general election days.
        assert_eq!(ymd(election_day(2025)).1, 11);
        assert_eq!(ymd(election_day(2025)).2, 4);
        assert_eq!(ymd(election_day(2026)).2, 3);
        assert_eq!(ymd(election_day(2028)).2, 7);
        assert_eq!(ymd(election_day(2032)).2, 2);
    }
}
