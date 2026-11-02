// Shared math for the page (window.M) and the daily build (require("./model.js")).
// Keep it free of DOM and network code.
(function (root) {
  const M = {};
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  M.clamp = clamp;
  M.CAL = 0.8;
  M.phi = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };

  /* ---------- player props ---------- */
  // Hit rates shrunk toward 50% (+2.5 hits in 5 phantom games), weighted 40% season / 30% last 10 / 30% last season
  const sh = ([h, n]) => (h + 2.5) / (n + 5);
  const hitOf = (side, line, v) => side === "atd" ? v >= 1 : side === "over" ? v > line : v < line;
  // vc: this season's values (newest first), vp: last season's, vo: values against this opponent
  M.hitStats = (vc, vp, vo, line, side) => {
    const cnt = a => [a.filter(v => hitOf(side, line, v)).length, a.length];
    const hc = cnt(vc), h10 = cnt(vc.concat(vp).slice(0, 10)), hp = cnt(vp), hh = cnt(vo || []);
    // Role change: if this season's average is 20%+ away from last season's (4+ games), this season and the recent
    // games weigh much more and last season much less (e.g. a guard rebounding more since the starting center went down)
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0, mc = mean(vc), mp = mean(vp);
    const changed = vc.length >= 4 && vp.length >= 10 && mp > 0 && Math.abs(mc - mp) / mp >= 0.2;
    const raw = !hp[1] ? 0.55 * sh(hc) + 0.45 * sh(h10) : changed ? 0.6 * sh(hc) + 0.25 * sh(h10) + 0.15 * sh(hp) : 0.4 * sh(hc) + 0.3 * sh(h10) + 0.3 * sh(hp);
    // Calibration: the first graded days showed hit rates about 20% too optimistic (picks at ~68% hit ~60%)
    const pr = 0.5 + (raw - 0.5) * M.CAL;
    return {hc, h10, hp, hh, pr0: pr, chg: changed ? +(mc / mp - 1).toFixed(2) : 0};
  };
  // Opponent-by-position factor f (1 = average) moves the probability up to 6 points
  M.withDef = (pr0, side, f) => clamp(pr0 + (side === "under" ? -1 : 1) * ((f || 1) - 1) * 0.3, 0.05, 0.95);
  M.defFactor = (raw, n, k) => raw == null ? 1 : clamp(1 + (raw - 1) * n / (n + k), 0.8, 1.2);
  // Recompute a prop at a new line (used by the Refresh button)
  M.repricePr = (c, line) => { const s = M.hitStats(c.vc || [], c.vp || [], c.vo || [], line, c.s); return {...s, pr: clamp(M.withDef(s.pr0, c.s, c.f) + (c.envAdj || 0) + (c.wadj || 0), 0.05, 0.95)}; };
  // Game environment: a high total (explosive game) helps overs, a low one (defensive game) helps unders.
  // env = how far the game's total is from the league average, as a fraction; moves the pick up to 4 points.
  M.envTag = env => env >= 0.03 ? "ofensivo" : env <= -0.03 ? "defensivo" : "normal";
  M.envAdj = (env, side, k) => clamp(env * k, -0.04, 0.04) * (side === "under" ? -1 : 1);

  // Overs from players with a small or unstable role depend on getting volume
  M.lowRole = (c, sport) => c.s === "over" && (sport === "NBA" ? c.min < 24 :
    (c.pos === "RB" && (c.cr || 0) < 10 && ["CAR", "RUSHYDS", "RRY"].includes(c.m)) || (["WR", "TE"].includes(c.pos) && (c.tg || 0) < 4 && ["REC", "RECYDS"].includes(c.m)));
  M.score = (c, sport) => { const marg = c.m === "ATD" || c.a10 == null ? 0 : (c.s === "over" ? 1 : -1) * (c.a10 - c.l) / Math.max(c.l, 1);
    return c.pr * 0.8 + clamp(marg, -0.2, 0.4) * 0.5 - (c.sm ? 0.06 : 0) - (c.q ? 0.04 : 0) - (M.lowRole(c, sport) ? 0.05 : 0) - (c.b2b && c.s === "over" ? 0.02 : 0); };
  M.CFG = {NBA: {perPlayer: 1, minPr: 0.62, hca: 2.5, sd: 12.5, prevW: 0.6, prevK: 10}, NFL: {perPlayer: 1, minPr: 0.62, hca: 1.5, sd: 13.5, prevW: 0.5, prevK: 6}};
  M.topPicks = (cands, sport, n = 10) => {
    const cfg = M.CFG[sport], out = [], per = {};
    for (const c of cands.slice().sort((a, b) => M.score(b, sport) - M.score(a, sport))) {
      // Same rule as game picks: support first, but never a price below what the probability is worth
      // Main-role players only (c.role 0 = bench / small or unstable role): their props swing with minutes and injuries
      if (c.out || !c.p || c.role === 0 || c.pr < cfg.minPr || c.e < -0.02) continue; if ((per[c.aid] || 0) >= cfg.perPlayer) continue;
      per[c.aid] = (per[c.aid] || 0) + 1; out.push(c); if (out.length === n) break;
    }
    return out;
  };

  /* ---------- game lines (NBA / NFL) ---------- */
  M.teamForm = (T, cfg) => {
    const n = T.cur.length, diff = n ? T.cur.reduce((s, r) => s + r[3] - r[4], 0) / n : 0;
    const w = T.cur.filter(r => r[3] > r[4]).length, l = T.cur.filter(r => r[3] < r[4]).length, t = n - w - l;
    const net = (n * diff + cfg.prevK * cfg.prevW * T.prevDiff) / (n + cfg.prevK);
    return {n, w, l, t, diff, net, prevW: T.prevW, prevL: T.prevN - T.prevW, prevDiff: T.prevDiff, last: T.cur.slice().reverse()};
  };
  // ctx: {teams, outs, hca, sd, prevK, prevW}; outs[team] = [[name, minutes, points], ...]
  M.gameModel = (g, ctx) => {
    const H = M.teamForm(ctx.teams[g.home.abbr], ctx), A = M.teamForm(ctx.teams[g.away.abbr], ctx), L = g.lines || {};
    const inj = t => ((ctx.outs || {})[t] || []).reduce((s, x) => s + x[2], 0);
    H.inj = inj(g.home.abbr); A.inj = inj(g.away.abbr);
    // Second night of a back-to-back costs about 1.5 points (NBA)
    const rest = g.rest || {}, b2b = d => d === 1 ? 1.5 : 0; H.rest = rest.h; A.rest = rest.a;
    const margin = (H.net - H.inj - b2b(rest.h)) - (A.net - A.inj - b2b(rest.a)) + ctx.hca, sh = Number(L.spreadHome);
    const pH = M.phi(margin / ctx.sd), cH = M.phi((margin + sh) / ctx.sd);
    const opts = [
      {lbl: `${g.home.abbr} gana (moneyline)`, p: pH, price: L.mlHome, side: "H", kind: "ml"},
      {lbl: `${g.away.abbr} gana (moneyline)`, p: 1 - pH, price: L.mlAway, side: "A", kind: "ml"},
      {lbl: `${g.home.abbr} ${L.spreadHome} (spread)`, p: cH, price: L.spreadHomeOdds, side: "H", kind: "sp", line: Number(L.spreadHome)},
      {lbl: `${g.away.abbr} ${L.spreadAway} (spread)`, p: 1 - cH, price: L.spreadAwayOdds, side: "A", kind: "sp", line: Number(L.spreadAway)},
    ];
    // 50/50 with the market's no-vig probability: simple models overrate teams on last season's results
    const nv = (a, b) => a && b ? (1 / a) / (1 / a + 1 / b) : null;
    const mk = [nv(L.mlHome, L.mlAway), nv(L.mlAway, L.mlHome), nv(L.spreadHomeOdds, L.spreadAwayOdds), nv(L.spreadAwayOdds, L.spreadHomeOdds)];
    opts.forEach((o, i) => { o.pm = o.p; if (mk[i] != null) o.p = 0.5 * o.p + 0.5 * mk[i]; });
    const opts2 = opts.filter(o => o.price && (o.kind === "ml" || !isNaN(o.line))).map(o => ({...o, imp: 1 / o.price, e: o.p - 1 / o.price}));
    // Solid pick first: the most likely option (55%+) that also pays at least a little more than it should.
    // An underdog that only has value (wins less than 55%) is shown apart as a risky option, never as the pick.
    // Solid = the most likely option with 60%+ whose price is fair or better (at most 2 points below our estimate)
    const solid = opts2.filter(o => o.p >= 0.60 && o.e >= -0.02).sort((a, b) => b.p - a.p)[0];
    const value = solid ? null : opts2.filter(o => o.p < 0.60 && o.e >= 0.04).sort((a, b) => b.e - a.e)[0] || null;
    const best = solid || opts2.slice().sort((a, b) => b.e - a.e)[0];
    return {H, A, margin, opts: opts2, best, play: !!solid, value};
  };

  /* ---------- soccer ---------- */
  M.SOC_SKIP = new Set(["CUP", "QUAL", "FRI"]);
  // "1 Up": the bet pays as a win if the team goes ahead by k (=1) goals at any moment of the match.
  // Goals arrive minute by minute (Poisson); we follow the score difference and stop when it reaches +k.
  M.everAhead = (lt, lo, k = 1, steps = 180) => {
    const ph = lt / steps, pa = lo / steps, W = 12; let dist = new Map([[0, 1]]), hit = 0;
    for (let s = 0; s < steps; s++) { const nx = new Map();
      for (const [d, m] of dist) { const up = d + 1;
        if (up >= k) hit += m * ph; else nx.set(up, (nx.get(up) || 0) + m * ph);
        if (d - 1 > -W) nx.set(d - 1, (nx.get(d - 1) || 0) + m * pa);
        nx.set(d, (nx.get(d) || 0) + m * (1 - ph - pa)); }
      dist = nx; }
    return hit;
  };
  M.buildSoccer = D => {
    const K = 4, HFA = 1.12, AFA = 0.90;
    const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
    const rowsOf = abbr => (D.teams[abbr] || []).filter(r => !M.SOC_SKIP.has(r[8] || "")).slice(0, 10);
    const valC = r => r[6] != null && r[7] != null && (r[6] + r[7]) > 0;
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const lgTeams = {}; D.games.forEach(g => { (lgTeams[g.lg] = lgTeams[g.lg] || new Set()).add(g.home.abbr); lgTeams[g.lg].add(g.away.abbr); });
    const lgMu = {}, lgC = {};
    Object.entries(lgTeams).forEach(([lg, set]) => { const rows = [...set].flatMap(rowsOf); lgMu[lg] = mean(rows.map(r => r[4])) || 1.3; lgC[lg] = mean(rows.filter(valC).map(r => r[6])) || 5; });
    const strength = (abbr, lg) => {
      const rows = rowsOf(abbr), n = rows.length, mu = lgMu[lg], cm = lgC[lg], cr = rows.filter(valC), nc = cr.length;
      return {n, att: (rows.reduce((s, r) => s + r[4], 0) + K * mu) / (n + K), def: (rows.reduce((s, r) => s + r[5], 0) + K * mu) / (n + K),
        cf: (cr.reduce((s, r) => s + r[6], 0) + K * cm) / (nc + K), ca: (cr.reduce((s, r) => s + r[7], 0) + K * cm) / (nc + K), nc};
    };
    const games = [], cands = [];
    for (const g of D.games) {
      const mu = lgMu[g.lg], H = strength(g.home.abbr, g.lg), A = strength(g.away.abbr, g.lg), L = g.lines || {};
      // Champions a few days later (likely rotation) or just played (fatigue)
      const rot = g.rot || {}, tweak = (T, r) => { if (!r) return; if (r.next != null) { T.att *= 0.95; T.def *= 1.03; } else { T.att *= 0.97; T.def *= 1.02; } };
      tweak(H, rot.h); tweak(A, rot.a);
      const lh = H.att * A.def / mu * HFA, la = A.att * H.def / mu * AFA;
      const Mx = []; for (let i = 0; i <= 10; i++) { Mx.push([]); for (let j = 0; j <= 10; j++) Mx[i].push(pois(i, lh) * pois(j, la)); }
      const P = f => { let s = 0; for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) if (f(i, j)) s += Mx[i][j]; return s; };
      const pH = P((i, j) => i > j), pD = P((i, j) => i === j), pA = P((i, j) => i < j);
      const lc = (H.cf + A.ca) / 2 * 1.05 + (A.cf + H.ca) / 2 * 0.95;
      const pCornOver = line => { let c = 0; for (let k = 0; k <= Math.floor(line); k++) c += pois(k, lc); return 0.5 + ((1 - c) - 0.5) * 0.8; };
      const sumInv = (L.mlHome && L.draw && L.mlAway) ? 1 / L.mlHome + 1 / L.draw + 1 / L.mlAway : null;
      const nv3 = x => sumInv ? (1 / x) / sumInv : null;
      const nv2 = (a, b) => a && b ? (1 / a) / (1 / a + 1 / b) : null;
      const gi = {id: g.id, lh, la, lc, pH, pD, pA, pBTTS: P((i, j) => i > 0 && j > 0), H, A, up1H: M.everAhead(lh, la, 1), up1A: M.everAhead(la, lh, 1)};
      games.push(gi);
      // Model weight vs the market: lower in Champions, where teams come from leagues of very different level
      const wM = g.lg === "Champions" ? 0.25 : 0.5;
      const add = o => { const blend = o.mk != null ? wM * o.pm + (1 - wM) * o.mk : 0.5 + (o.pm - 0.5) * 0.7; cands.push({g: g.id, ...o, pr: +blend.toFixed(3), imp: o.p ? +(1 / o.p).toFixed(3) : null, e: o.p ? +(blend - 1 / o.p).toFixed(3) : null}); };
      const hN = g.home.abbr, aN = g.away.abbr;
      if (L.mlHome) add({k: "1x2", side: "H", lbl: `Gana ${hN}`, pm: pH, mk: nv3(L.mlHome), p: L.mlHome});
      if (L.draw) add({k: "1x2", side: "D", lbl: "Empate", pm: pD, mk: nv3(L.draw), p: L.draw});
      if (L.mlAway) add({k: "1x2", side: "A", lbl: `Gana ${aN}`, pm: pA, mk: nv3(L.mlAway), p: L.mlAway});
      const sh = Number(L.spreadHome), sa = Number(L.spreadAway);
      const mk1 = sumInv ? nv3(L.mlHome) + nv3(L.draw) : null, mk2 = sumInv ? nv3(L.mlAway) + nv3(L.draw) : null;
      // Double chance: the book's price when it offers the +0.5 handicap; otherwise estimated from its 1X2 prices
      // (combining two outcomes keeps the book's margin; 1.5% off to be conservative)
      const dcEst = (a, b) => a && b ? +(0.985 / (1 / a + 1 / b)).toFixed(2) : null;
      const dc1 = sh === 0.5 ? L.spreadHomeOdds : (L.dc1 || null), dc2 = sa === 0.5 ? L.spreadAwayOdds : (L.dc2 || null);
      add({k: "dc", side: "1X", lbl: `${hN} o empate`, pm: pH + pD, mk: mk1, p: dc1 || dcEst(L.mlHome, L.draw), est: !dc1 && !!dcEst(L.mlHome, L.draw)});
      add({k: "dc", side: "X2", lbl: `${aN} o empate`, pm: pA + pD, mk: mk2, p: dc2 || dcEst(L.mlAway, L.draw), est: !dc2 && !!dcEst(L.mlAway, L.draw)});
      // Handicap (asian): half lines win/lose; whole lines refund on a push, so the probability counts only decided games
      if (!isNaN(sh) && Math.abs(sh) >= 1 && Math.abs(sh * 4) % 2 === 0) {
        const pW = P((i, j) => i - j + sh > 0), pL = P((i, j) => i - j + sh < 0), dec = pW + pL, mk = nv2(L.spreadHomeOdds, L.spreadAwayOdds);
        add({k: "hc", side: "H", lbl: `${hN} ${L.spreadHome}`, line: sh, pm: pW / dec, mk, p: L.spreadHomeOdds});
        add({k: "hc", side: "A", lbl: `${aN} ${L.spreadAway}`, line: sa, pm: pL / dec, mk: mk != null ? 1 - mk : null, p: L.spreadAwayOdds});
      }
      // Double chance at half time: about 44% of the goals come before the break
      if (g.h1) { const l1 = lh * 0.44, l2 = la * 0.44; let a1 = 0, a2 = 0, s1 = 0;
        for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) { const q = pois(i, l1) * pois(j, l2); s1 += q; if (i >= j) a1 += q; if (j >= i) a2 += q; }
        const inv = 1 / g.h1.h + 1 / g.h1.d + 1 / g.h1.a, m1 = (1 / g.h1.h + 1 / g.h1.d) / inv, m2 = (1 / g.h1.a + 1 / g.h1.d) / inv;
        add({k: "dc1h", side: "1X", lbl: `${hN} o empate al medio tiempo`, pm: a1 / s1, mk: m1, p: dcEst(g.h1.h, g.h1.d), est: true});
        add({k: "dc1h", side: "X2", lbl: `${aN} o empate al medio tiempo`, pm: a2 / s1, mk: m2, p: dcEst(g.h1.a, g.h1.d), est: true}); }
      if (L.total) { const t = Number(L.total), po = P((i, j) => i + j > t), mk = nv2(L.overOdds, L.underOdds);
        add({k: "tot", side: "O", lbl: `Más de ${t} goles`, line: t, pm: po, mk, p: L.overOdds});
        add({k: "tot", side: "U", lbl: `Menos de ${t} goles`, line: t, pm: 1 - po, mk: mk != null ? 1 - mk : null, p: L.underOdds}); }
      const mkB = g.btts ? nv2(g.btts[0], g.btts[1]) : null;
      add({k: "btts", side: "Y", lbl: "Ambos anotan: Sí", pm: gi.pBTTS, mk: mkB, p: g.btts ? g.btts[0] : null});
      add({k: "btts", side: "N", lbl: "Ambos anotan: No", pm: 1 - gi.pBTTS, mk: mkB != null ? 1 - mkB : null, p: g.btts ? g.btts[1] : null});
      // Corners: priced line when SportsGameOdds has one (Champions), otherwise the middle of ESPN's ladder
      const corn = g.corn || (g.cl && g.cl.length ? {line: g.cl[Math.floor(g.cl.length / 2)]} : null);
      if (corn) { const po = pCornOver(corn.line), mk = nv2(corn.over, corn.under);
        add({k: "cor", side: "O", lbl: `Más de ${corn.line} corners`, line: corn.line, pm: po, mk, p: corn.over || null});
        add({k: "cor", side: "U", lbl: `Menos de ${corn.line} corners`, line: corn.line, pm: 1 - po, mk: mk != null ? 1 - mk : null, p: corn.under || null}); }
    }
    return {games, cands, lgMu, lgC, rowsOf};
  };
  // Soccer picks need support too: priced ones must hit at least 52% (value alone is not enough)
  M.socOk = c => c.p ? (c.p >= 1.2 && c.e >= -0.02 && c.pr >= 0.58) : (c.pr >= 0.62 && c.pr <= 0.75);
  // Ranked by probability; value adds at most 5 points, and picks without a price start a bit lower
  M.socScore = c => c.pr + (c.p ? 0 : -0.03);
  // Top lists only take picks with a price in hand (real or estimated)
  M.socTop = (cands, gamesById, lg, n = 10) => { const out = [], per = {};
    for (const c of cands.filter(c => c.p && M.socOk(c)).sort((a, b) => M.socScore(b) - M.socScore(a))) { if (lg && gamesById[c.g].lg !== lg) continue; if (per[c.g]) continue; per[c.g] = 1; out.push(c); if (out.length === n) break; }
    return out; };

  if (typeof module !== "undefined" && module.exports) module.exports = M; else root.M = M;
})(typeof window !== "undefined" ? window : globalThis);
