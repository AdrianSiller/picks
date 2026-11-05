import fs from "node:fs";
const out = [];
for (const lg of ["uefa.europa"]) { const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/scoreboard?dates=20261105`); const j = await r.json();
  for (const e of j.events || []) { const c = e.competitions[0], H = c.competitors.find(x => x.homeAway === "home"), A = c.competitors.find(x => x.homeAway === "away");
    const sum = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/summary?event=${e.id}`)).json().catch(() => ({}));
    const bs = (sum.boxscore && sum.boxscore.teams) || [], st = (t, n) => { const T = bs.find(x => x.team.id === t.team.id); const s = T && (T.statistics || []).find(x => x.name === n); return s ? s.displayValue : null; };
    const pl = {}; for (const ro of sum.rosters || []) for (const p of ro.roster || []) { const v = n => { const s = (p.stats || []).find(x => x.name === n); return s ? +s.value : 0; }; pl[p.athlete.displayName] = [v("totalShots"), v("shotsOnTarget"), v("totalGoals")]; }
    out.push({g: `${A.team.abbreviation}@${H.team.abbreviation}`, t: e.date, st: e.status.type.shortDetail, sc: `${A.score}-${H.score}`, corners: [st(A, "wonCorners"), st(H, "wonCorners")], pl}); } }
fs.mkdirSync("data/fm", {recursive: true}); fs.writeFileSync("data/fm/live.json", JSON.stringify(out));
