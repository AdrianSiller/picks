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
  M.repricePr = (c, line) => { const s = M.hitStats(c.vc || [], c.vp || [], c.vo || [], line, c.s), pm = clamp(M.withDef(s.pr0, c.s, c.f) + (c.envAdj || 0) + (c.wadj || 0), 0.05, 0.95);
    return {...s, pm, pr: clamp((c.mkB != null ? (1 - M.PROP_W) * pm + M.PROP_W * c.mkB : pm) + (c.mvAdj || 0) + (c.calAdj || 0), 0.05, 0.95)}; };
  // Props lean on the book too: 50% our model, 50% the book's probability without its commission (it holds back the model's
  // extremes: the most "certain" props were the ones that failed most when the model went alone)
  M.PROP_W = 0.5;
  M.blendProp = (pm, mk) => mk == null ? pm : clamp((1 - M.PROP_W) * pm + M.PROP_W * mk, 0.05, 0.95);
  // Line movement since we first saw the prop: harder line (or our price drifting 3+ points) = the book knows something
  M.lineMove = (c, ol, op) => { const dl = (c.l - ol) * (c.s === "over" ? 1 : -1), dimp = op && c.p ? 1 / op - 1 / c.p : 0;
    return dl > 0 || (dl === 0 && dimp >= 0.03) ? -1 : dl < 0 || (dl === 0 && dimp <= -0.03) ? 1 : 0; };
  // Game environment: a high total (explosive game) helps overs, a low one (defensive game) helps unders.
  // env = how far the game's total is from the league average, as a fraction; moves the pick up to 4 points.
  M.envTag = env => env >= 0.03 ? "ofensivo" : env <= -0.03 ? "defensivo" : "normal";
  M.envAdj = (env, side, k) => clamp(env * k, -0.04, 0.04) * (side === "under" ? -1 : 1);

  // Overs from players with a small or unstable role depend on getting volume
  M.lowRole = (c, sport) => c.s === "over" && (sport === "NBA" ? c.min < 24 :
    (c.pos === "RB" && (c.cr || 0) < 10 && ["CAR", "RUSHYDS", "RRY"].includes(c.m)) || (["WR", "TE"].includes(c.pos) && (c.tg || 0) < 4 && ["REC", "RECYDS"].includes(c.m)));
  // Margin over the line with the median of the last 10 (one huge night does not inflate it)
  M.score = (c, sport) => { const typ = c.md10 != null ? c.md10 : c.a10, marg = c.m === "ATD" || typ == null ? 0 : (c.s === "over" ? 1 : -1) * (typ - c.l) / Math.max(c.l, 1);
    return c.pr * 0.8 + clamp(marg, -0.2, 0.4) * 0.5 - (c.sm ? 0.06 : 0) - (c.q ? 0.04 : 0) - (M.lowRole(c, sport) ? 0.05 : 0) - (c.b2b && c.s === "over" ? 0.02 : 0); };
  M.CFG = {NBA: {sp: "NBA", perPlayer: 1, minPr: 0.62, hca: 2.5, sd: 12.5, prevW: 0.6, prevK: 10}, NFL: {sp: "NFL", perPlayer: 1, minPr: 0.62, hca: 1.5, sd: 13.5, prevW: 0.5, prevK: 6}};
  // Why a prop doesn't qualify (same filters for the top 10 and for each game's list); "" = it qualifies
  M.fails = (c, sport) => { const cfg = M.CFG[sport];
    return c.out ? "no juega" : !c.p ? "sin momio en la casa" : c.role === 0 ? "fuera de su rol" : c.pr < cfg.minPr ? `probabilidad baja (${Math.round(c.pr * 100)}%)` : c.e < -0.02 ? "momio caro para lo que estimamos" : ""; };
  M.topPicks = (cands, sport, n = 10) => {
    const cfg = M.CFG[sport], out = [], per = {};
    for (const c of cands.slice().sort((a, b) => M.score(b, sport) - M.score(a, sport))) {
      // Same rule as game picks: support first, but never a price below what the probability is worth
      // Main-role players only (c.role 0 = bench / small or unstable role): their props swing with minutes and injuries
      if (M.fails(c, sport)) continue; if ((per[c.aid] || 0) >= cfg.perPlayer) continue;
      per[c.aid] = (per[c.aid] || 0) + 1; out.push(c); if (out.length === n) break;
    }
    return out;
  };

  /* ---------- calibration with real results ---------- */
  // Each group (sport × kind of pick) is corrected by how much it missed: hit rate minus the raw probability we gave.
  // Small groups lean on their sport and on the overall gap (k = 50 picks for half weight). Max ±5 points.
  M.CALIB = {};
  M.calAdj = k => M.CALIB[k] || 0;
  M.calGroup = x => `${x.sport}|${x.kind === "prop" ? "prop|" + x.s : x.kind === "game" ? "game" : "soc"}`;
  M.calibrate = items => {
    // Soccer only counts picks from the current model (book-weighted since Nov 2); the old ones came from a different model
    const done = items.filter(x => (x.hit === 0 || x.hit === 1) && x.pr != null && (x.sport !== "SOC" || x.date >= "2026-11-02") && (x.sport === "SOC" || x.kind !== "prop" || x.date >= "2026-11-04")), st = {}, K = 50;
    const add = (k, x) => { const s = st[k] = st[k] || {n: 0, w: 0, p: 0}; s.n++; s.w += x.hit; s.p += x.pr - (x.cal || 0); };
    for (const x of done) { add("ALL", x); add(x.sport, x); add(M.calGroup(x), x); }
    const gap = k => st[k] ? {d: (st[k].w - st[k].p) / st[k].n, w: st[k].n / (st[k].n + K)} : {d: 0, w: 0};
    // Overall gap only shared between NBA and NFL (soccer markets work differently)
    for (const x of done) if (x.sport !== "SOC") add("US", x);
    const all = gap("US"), out = {_n: done.length};
    for (const k of ["NBA|prop|over", "NBA|prop|under", "NBA|game", "NFL|prop|over", "NFL|prop|under", "NFL|game", "SOC|soc"]) {
      const sp = gap(k.split("|")[0]), g = gap(k), base = k.startsWith("SOC") ? 0 : all.w * all.d, spv = sp.w * sp.d + (1 - sp.w) * base;
      out[k] = +clamp(g.w * g.d + (1 - g.w) * spv, -0.05, 0.05).toFixed(3);
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
  // Game total (over/under): what each team scores and allows (this season, leaning on last season early on),
  // scaled by the league average, minus tired legs.
  M.totalModel = (g, ctx, H, A) => {
    const L = g.lines || {}, line = Number(L.total); if (!line || !L.overOdds || !L.underOdds) return null;
    const T = ctx.teams, sp = ctx.sp || ctx.name, K = ctx.prevK || 8;
    const rate = t => { const x = T[t]; if (!x) return null; const n = x.cur.length, pf = n ? x.cur.reduce((s, r) => s + r[3], 0) / n : 0, pa = n ? x.cur.reduce((s, r) => s + r[4], 0) / n : 0;
      const ppf = x.prevPF || pf, ppa = x.prevPA || pa; return {n, pf: (n * pf + K * ppf) / (n + K), pa: (n * pa + K * ppa) / (n + K), cpf: pf, cpa: pa}; };
    if (!ctx.__lg) { const all = Object.keys(T).map(rate).filter(Boolean); ctx.__lg = all.reduce((s, r) => s + r.pf, 0) / (all.length || 1); }
    const h = rate(g.home.abbr), a = rate(g.away.abbr); if (!h || !a) return null;
    const lg = ctx.__lg, rest = g.rest || {};
    // Absences are not subtracted: long ones already show in this season's averages and the book prices the new ones
    const eh = h.pf * a.pa / lg - (rest.h === 1 ? 1 : 0), ea = a.pf * h.pa / lg - (rest.a === 1 ? 1 : 0);
    const proj = eh + ea, sd = sp === "NFL" ? 13 : 18, pm = 1 - M.phi((line - proj) / sd);
    const mk = (1 / L.overOdds) / (1 / L.overOdds + 1 / L.underOdds), cal = M.calAdj(`${sp}|game`);
    // The book weighs 60%; if the model is 30+ points away from it, it is probably missing something: no pick
    const pO = clamp(0.4 * pm + 0.6 * mk, 0.02, 0.98), far = Math.abs(pm - mk) > 0.3;
    const opts = [{lbl: `Over ${line}`, side: "O", p: clamp(pO + cal, 0.02, 0.98), price: L.overOdds}, {lbl: `Under ${line}`, side: "U", p: clamp(1 - pO + cal, 0.02, 0.98), price: L.underOdds}]
      .map(o => ({...o, kind: "tot", line, imp: 1 / o.price, e: o.p - 1 / o.price, cal}));
    const best = far ? null : opts.filter(o => o.p >= 0.60 && o.e >= -0.02).sort((x, y) => y.p - x.p)[0] || null;
    return {far, line, proj: +proj.toFixed(1), eh: +eh.toFixed(1), ea: +ea.toFixed(1), h, a, pm, mk, opts, best, play: !!best};
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
    const cal = M.calAdj(`${ctx.sp || ctx.name}|game`);
    opts.forEach((o, i) => { o.pm = o.p; if (mk[i] != null) o.p = 0.5 * o.p + 0.5 * mk[i]; o.p = clamp(o.p + cal, 0.02, 0.98); o.cal = cal; });
    const opts2 = opts.filter(o => o.price && (o.kind === "ml" || !isNaN(o.line))).map(o => ({...o, imp: 1 / o.price, e: o.p - 1 / o.price}));
    // Solid pick first: the most likely option (55%+) that also pays at least a little more than it should.
    // An underdog that only has value (wins less than 55%) is shown apart as a risky option, never as the pick.
    // Solid = the most likely option with 60%+ whose price is fair or better (at most 2 points below our estimate)
    const solid = opts2.filter(o => o.p >= 0.60 && o.e >= -0.02).sort((a, b) => b.p - a.p)[0];
    const value = solid ? null : opts2.filter(o => o.p < 0.60 && o.e >= 0.04).sort((a, b) => b.e - a.e)[0] || null;
    const best = solid || opts2.slice().sort((a, b) => b.e - a.e)[0];
    return {H, A, margin, opts: opts2, best, play: !!solid, value, tot: M.totalModel(g, ctx, H, A)};
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
  // Soccer: model weight vs the book (the book is sharper), and max disagreement allowed for a solid pick
  // The book is much sharper than a goals model: it weighs 70% (80% in Champions) and the model only confirms.
  // If model and book disagree by more than 12 points, the model is probably missing something (lineups, rotation): no pick.
  M.SOC = {w: 0.3, wCL: 0.2, gap: 0.12, minPr: 0.62, eMin: -0.03, minP: 1.2, alpha: 1};
  // Level of each domestic league (Champions: goals against a weak league count less). 1 = Premier League.
  M.SOC_LVL = {PL: 1, LL: 0.95, SA: 0.93, BUN: 0.92, L1: 0.88, POR: 0.82, ERE: 0.8, BEL: 0.78, TUR: 0.76, AUT: 0.74, SUI: 0.73, GRE: 0.72, SCO: 0.72, CZE: 0.72, DEN: 0.72, UKR: 0.72, NOR: 0.7, SRB: 0.7, CRO: 0.7, CYP: 0.68, LMX: 0.75};
  M.SOC_INTL = new Set(["UCL", "UEL", "UECL", "UEFA "]);
  // Goals each team is expected to score according to the book: total from the over/under price, split from the 1X2
  M.mktLambdas = (L, pois) => {
    if (!L.mlHome || !L.draw || !L.mlAway || !L.total || !L.overOdds || !L.underOdds) return null;
    const inv = 1 / L.mlHome + 1 / L.draw + 1 / L.mlAway, tH = (1 / L.mlHome) / inv, tA = (1 / L.mlAway) / inv, tO = (1 / L.overOdds) / (1 / L.overOdds + 1 / L.underOdds), line = Number(L.total);
    let best = null;
    for (let s = 0.8; s <= 5; s += 0.05) { let c = 0; for (let k = 0; k <= Math.floor(line); k++) c += pois(k, s); const d = Math.abs((1 - c) - tO); if (!best || d < best.d) best = {d, s}; }
    let bestR = null;
    for (let r = 0.12; r <= 0.88; r += 0.01) { const h = best.s * r, a = best.s - h; let pH = 0, pA = 0;
      for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const q = pois(i, h) * pois(j, a); if (i > j) pH += q; else if (j > i) pA += q; }
      const d = Math.abs((pH - pA) - (tH - tA)); if (!bestR || d < bestR.d) bestR = {d, h, a}; }
    return {h: bestR.h, a: bestR.a};
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
    // Domestic league of a team = its most frequent non-continental competition in the last matches
    const homeLg = abbr => { const c = {}; for (const r of (D.teams[abbr] || [])) if (!M.SOC_INTL.has(r[1]) && !r[8]) c[r[1]] = (c[r[1]] || 0) + 1;
      const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return top ? top[0] : null; };
    const lvl = abbr => M.SOC_LVL[homeLg(abbr)] || 0.74;
    const games = [], cands = [];
    for (const g of D.games) {
      const mu = lgMu[g.lg], H = strength(g.home.abbr, g.lg), A = strength(g.away.abbr, g.lg), L = g.lines || {};
      // Champions: scale attack up and defense down by the level of each team's league (goals in a weak league are worth less)
      if (g.lg === "Champions" && M.SOC.alpha) for (const [T, ab] of [[H, g.home.abbr], [A, g.away.abbr]]) { const f = Math.pow(lvl(ab) / 0.88, M.SOC.alpha); T.att *= f; T.def /= f; T.lvl = lvl(ab); }
      // Rotation only when the lineup is confirmed (g.xi, from ↻ Actualizar): each usual starter missing weakens the team a little.
      // A Champions match nearby is only a warning, never assumed (the book already prices what it knows)
      const xi = g.xi || {}, tweak = (T, x) => { if (!x || !x.miss) return; const k = x.miss.length; T.att *= Math.max(0.85, 1 - 0.03 * k); T.def *= Math.min(1.12, 1 + 0.02 * k); };
      tweak(H, xi.h); tweak(A, xi.a);
      const lh = H.att * A.def / mu * HFA, la = A.att * H.def / mu * AFA;
      const Mx = []; for (let i = 0; i <= 10; i++) { Mx.push([]); for (let j = 0; j <= 10; j++) Mx[i].push(pois(i, lh) * pois(j, la)); }
      const P = f => { let s = 0; for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) if (f(i, j)) s += Mx[i][j]; return s; };
      const pH = P((i, j) => i > j), pD = P((i, j) => i === j), pA = P((i, j) => i < j);
      const lc = (H.cf + A.ca) / 2 * 1.05 + (A.cf + H.ca) / 2 * 0.95;
      const pCornOver = line => { let c = 0; for (let k = 0; k <= Math.floor(line); k++) c += pois(k, lc); return 0.5 + ((1 - c) - 0.5) * 0.8; };
      const sumInv = (L.mlHome && L.draw && L.mlAway) ? 1 / L.mlHome + 1 / L.draw + 1 / L.mlAway : null;
      const nv3 = x => sumInv ? (1 / x) / sumInv : null;
      const nv2 = (a, b) => a && b ? (1 / a) / (1 / a + 1 / b) : null;
      // 1 Up anchored to the book: the goals each team is expected to score according to its 1X2 and total prices,
      // then the same minute-by-minute walk; mixed with the model's like every other market
      const wM0 = g.lg === "Champions" ? M.SOC.wCL : M.SOC.w, mkL = M.mktLambdas(L, pois);
      const up = (a, b) => M.everAhead(a, b, 1), u1H = mkL ? wM0 * up(lh, la) + (1 - wM0) * up(mkL.h, mkL.a) : up(lh, la), u1A = mkL ? wM0 * up(la, lh) + (1 - wM0) * up(mkL.a, mkL.h) : up(la, lh);
      const gi = {id: g.id, fav: M.socFav(L), lh, la, lc, pH, pD, pA, pBTTS: P((i, j) => i > 0 && j > 0), H, A, up1H: u1H, up1A: u1A, mkL};
      games.push(gi);
      // Model weight vs the market: lower in Champions, where teams come from leagues of very different level
      const wM = g.lg === "Champions" ? M.SOC.wCL : M.SOC.w;
      const cal = M.calAdj("SOC|soc");
      const add = o => { const blend = clamp((o.mk != null ? wM * o.pm + (1 - wM) * o.mk : 0.5 + (o.pm - 0.5) * 0.7) + cal, 0.02, 0.98); cands.push({g: g.id, ...o, pr: +blend.toFixed(3), imp: o.p ? +(1 / o.p).toFixed(3) : null, e: o.p ? +(blend - 1 / o.p).toFixed(3) : null, cal, al: M.socAligned(o, M.socFav(L)) ? 1 : 0, thin: Math.min(H.n, A.n) < 6 ? 1 : 0, gap: o.mk != null ? +(o.pm - o.mk).toFixed(3) : null}); };
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
      // Goals per team (each line of the book's ladder with sensible prices)
      if (g.tt) for (const [sd, lam, nm] of [["H", lh, hN], ["A", la, aN]]) for (const [l, ov, un] of (g.tt[sd] || {}).lines || []) {
        let c0 = 0; for (let k = 0; k <= Math.floor(l); k++) c0 += pois(k, lam); const mk = nv2(ov, un);
        if (ov >= 1.15 && ov <= 2.6) add({k: "tt", side: "O", team: sd, lbl: `${nm} más de ${l} goles`, line: l, pm: 1 - c0, mk, p: ov});
        if (un >= 1.15 && un <= 2.6) add({k: "tt", side: "U", team: sd, lbl: `${nm} menos de ${l} goles`, line: l, pm: c0, mk: 1 - mk, p: un}); }
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
  M.socOk = c => !c.thin && c.al !== 0 && (c.gap == null || Math.abs(c.gap) <= M.SOC.gap) && (c.p ? (c.p >= M.SOC.minP && c.e >= M.SOC.eMin && c.pr >= M.SOC.minPr) : (c.pr >= 0.62 && c.pr <= 0.75));
  // Ranked by probability; value adds at most 5 points, and picks without a price start a bit lower
  M.socScore = c => c.pr + (c.p ? 0 : -0.03);
  // Top lists only take picks with a price in hand (real or estimated)
  // One pick per match: the solid one if there is one; otherwise the most likely option (62%+) that pays 1.25+ and only loses
  // the book's usual commission (up to 7 points) with model and book agreeing; 1 Up when it is clearly more likely (price to check)
  // Coherence with the favorite: when one team has 50%+ to win (book, no commission), no pick that needs the other team to deliver
  // (the underdog scoring, both teams scoring, the underdog or draw / with goals): those are the same bet repeated and fall together
  M.socFav = L => { if (!L || !L.mlHome || !L.draw || !L.mlAway) return null; const inv = 1 / L.mlHome + 1 / L.draw + 1 / L.mlAway, h = (1 / L.mlHome) / inv, a = (1 / L.mlAway) / inv;
    return h >= 0.5 ? {side: "H", p: h} : a >= 0.5 ? {side: "A", p: a} : null; };
  M.socAligned = (c, fav) => { if (!fav) return true; const dog = fav.side === "H" ? "A" : "H";
    if (c.k === "btts" && c.side === "Y") return false;
    if (c.k === "tt" && c.team === dog && c.side === "O") return false;
    if (c.k === "tt" && c.team === fav.side && c.side === "U") return false;
    if (["1x2", "hc"].includes(c.k) && c.side === dog) return false;
    if (["dc", "dc1h"].includes(c.k) && c.side === (dog === "H" ? "1X" : "X2")) return false;
    return true; };
  M.socGamePick = (cands, gi) => {
    // Too few matches of either team in the data (e.g. a league ESPN does not cover): no pick
    if (gi && gi.H && gi.A && Math.min(gi.H.n, gi.A.n) < 6) return null;
    const fav = gi && gi.fav, cs = cands.filter(c => c.p && M.socAligned(c, fav)), solid = cs.filter(c => M.socOk(c)).sort((a, b) => M.socScore(b) - M.socScore(a))[0];
    if (solid) return {c: solid, tier: "solid"};
    // The model must not see it as less likely than the book (it only confirms; it never rides on the book alone)
    const fair = cs.filter(c => c.p >= 1.25 && c.pr >= M.SOC.minPr && c.e >= -0.07 && (c.gap == null || (c.gap >= -0.05 && c.gap <= 0.15))).sort((a, b) => b.pr - a.pr)[0];
    const u = gi ? (gi.up1H >= gi.up1A ? {side: "H", pr: gi.up1H} : {side: "A", pr: gi.up1A}) : null;
    // A pick with a price first; 1 Up (no price in the source) only when there is nothing else
    if (fair) return {c: fair, tier: "fair"};
    return u && u.pr >= 0.7 ? {up1: u, tier: "up1"} : null;
  };
  M.socTop = (cands, gamesById, lg, n = 10) => { const out = [], per = {};
    for (const c of cands.filter(c => c.p && M.socOk(c)).sort((a, b) => M.socScore(b) - M.socScore(a))) { if (lg && gamesById[c.g].lg !== lg) continue; if (per[c.g]) continue; per[c.g] = 1; out.push(c); if (out.length === n) break; }
    return out; };

  if (typeof module !== "undefined" && module.exports) module.exports = M; else root.M = M;
})(typeof window !== "undefined" ? window : globalThis);
