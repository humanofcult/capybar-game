'use strict';
// Bot players: greedy heuristics over the engine's own scoring function.

const GOOD_TRIGGERS = ['scientist', 'witch', 'magician', 'detective', 'pilot'];

const Bot = {
  late(G) { return G.round >= MAX_ROUNDS - 2 || G.deck.length <= 4 || G.finalRound; },
  util(G, card) {
    const d = CAPY[card.id]; if (!d.util) return 0;
    return d.econ ? d.util * Math.max(0, (MAX_ROUNDS - G.round) / MAX_ROUNDS) * 1.6 : d.util;
  },
  // How much a capybara is worth to player pi if seated at `table`.
  value(G, pi, card, table) {
    table = table || G.players[pi].table;
    const before = G.score(pi, table).tableTotal;
    let v = G.score(pi, [...table, card]).tableTotal - before + this.util(G, card);
    if (card.id === 'drunk' && table.length) v -= before / table.length;
    return v;
  },
  // Points lost if `uid` left the table.
  loss(G, pi, uid) {
    const t = G.players[pi].table, c = t.find(x => x.uid === uid);
    let l = G.score(pi, t).tableTotal - G.score(pi, t.filter(x => x.uid !== uid)).tableTotal;
    if (c && c.id === 'zombie' && !c.cursed) l -= CAPY.zombie.pts;
    return l;
  },
  worstOwn(G, pi, cands) { return cands.slice().sort((a, b) => this.loss(G, pi, a) - this.loss(G, pi, b))[0]; },
  visible(G, pi) { const s = G.score(pi); return s.tableTotal + s.bonus + G.players[pi].backroom.length * 2; },
  leader(G, pi, cands) { return cands.slice().sort((a, b) => this.visible(G, b) - this.visible(G, a))[0]; },
  // Best invite, accounting for a full table.
  inviteValue(G, pi, card) {
    const p = G.players[pi];
    if (p.table.length < TABLE_MAX) return this.value(G, pi, card);
    const cur = G.score(pi).tableTotal; let best = -99;
    for (const c of p.table) {
      const z = c.id === 'zombie' && !c.cursed ? CAPY.zombie.pts : 0;
      best = Math.max(best, G.score(pi, [...p.table.filter(x => x.uid !== c.uid), card]).tableTotal - cur + z);
    }
    return best + this.util(G, card) - 0.5;
  },
  bestSwap(G, pi, theirs, mine) {
    const p = G.players[pi], cur = G.score(pi).tableTotal; let best = { gain: -99 };
    for (const tu of theirs) {
      const tc = G.find(tu).card;
      for (const mu of mine) {
        const gain = G.score(pi, p.table.map(c => c.uid === mu ? tc : c)).tableTotal - cur;
        if (gain > best.gain) best = { gain, take: tu, give: mu };
      }
    }
    return best;
  },

  wantsPlay(G, pi, id, o) {
    const p = G.players[pi];
    switch (id) {
      case 'fake_id': return !o.mainDone && G.bar.some(c => c && CAPY[c.id].cost >= 2 && Math.max(0, G.costFor(pi, c) - 2) <= p.drinks && this.inviteValue(G, pi, c) >= 2.5);
      case 'open_mic': return p.table.filter(c => G.isType(c, 'musician')).length >= 2 || (this.late(G) && p.table.some(c => G.isType(c, 'musician')));
      case 'applause': return p.table.length > 0 && (p.table.some(c => CAPY[c.id].pts >= 3) || this.late(G));
      case 'capy_swap': { const s = G.actionSpec(pi, id); return this.bestSwap(G, pi, s.cands, p.table.map(c => c.uid)).gain > 1.5; }
      case 'power_nap': return p.table.some(c => GOOD_TRIGGERS.includes(c.id));
      case 'secret_ingredient': return G.others(pi).some(q => q.table.some(c => GOOD_TRIGGERS.includes(c.id)));
      case 'rebranding': case 'dimensional_drift': return !o.mainDone && !G.bar.some(c => c && this.inviteValue(G, pi, c) >= 2.5);
      case 'final_toast': return G.round >= 5 && G.score(pi).total > Math.max(...G.others(pi).map(q => this.visible(G, q.idx))) + 3;
      case 'time_skip': return !o.mainDone;
      default: return true;
    }
  },

  async act(G, pi, o) {
    const p = G.players[pi];
    for (const pl of o.plays) if (this.wantsPlay(G, pi, pl.id, o)) return { type: 'play', hand: pl.hand };
    if (o.mainDone) return { type: 'end' };
    let best = null, wish = false;
    for (let slot = 0; slot < BAR_SIZE; slot++) {
      const card = G.bar[slot]; if (!card || G.reserved.has(card.id)) continue;
      const v = this.inviteValue(G, pi, card), cost = G.costFor(pi, card);
      if (cost > p.drinks) { if (v >= 4.5 && cost - p.drinks <= 3) wish = true; continue; }
      const s = v - 0.3 * cost;
      if (!best || s > best.s) best = { slot, v, s };
    }
    const thr = this.late(G) ? 0.8 : (p.table.length >= TABLE_MAX ? 1.5 : 2);
    if (best && best.v >= thr && !(wish && best.v < 3.5)) return { type: 'invite', slot: best.slot };
    if (o.canBuy && !wish && p.hand.length < 3 && (p.drinks >= o.price + 2 || G.rand() < 0.5)) return { type: 'buy' };
    return { type: 'collect' };
  },

  async choose(G, pi, r) {
    const p = G.players[pi];
    switch (r.kind) {
      case 'vote': return G.reserved.has(r.card.id) ? true : this.value(G, pi, r.card) >= 1.8;
      case 'voteRemove': {
        const s = G.bar.map((c, i) => ({ i, v: c ? this.value(G, pi, c) + (G.reserved.has(c.id) ? 50 : 0) : 99 })).sort((a, b) => a.v - b.v);
        return [s[0].i];
      }
      case 'pick': return CAPY[r.cards[1].id].pts > CAPY[r.cards[0].id].pts ? 1 : 0;
      case 'player': return r.purpose === 'steal' || r.purpose === 'peek'
        ? r.cands.slice().sort((a, b) => G.players[b].backroom.length - G.players[a].backroom.length)[0]
        : this.leader(G, pi, r.cands);
      case 'bar': {
        const s = r.cands.map(i => ({ i, v: CAPY[G.bar[i].id].pts })).sort((a, b) => b.v - a.v)[0];
        return s && s.v >= 2 ? s.i : null;
      }
      case 'capy': switch (r.purpose) {
        case 'discardOwn': {
          if (!r.incoming) return this.worstOwn(G, pi, r.cands);
          const cur = G.score(pi).tableTotal; let best = null;
          for (const u of r.cands) {
            const c = p.table.find(x => x.uid === u), z = c.id === 'zombie' && !c.cursed ? CAPY.zombie.pts : 0;
            const g = G.score(pi, [...p.table.filter(x => x.uid !== u), r.incoming]).tableTotal - cur + z;
            if (!best || g > best.g) best = { u, g };
          }
          return best.u;
        }
        case 'swapTake': { const b = this.bestSwap(G, pi, r.cands, r.mine); this._give = b.give; return b.gain > 1 ? b.take : null; }
        case 'swapGive': return r.cands.includes(this._give) ? this._give : this.worstOwn(G, pi, r.cands);
        case 'star': return r.cands.slice().sort((a, b) => CAPY[G.find(b).card.id].pts - CAPY[G.find(a).card.id].pts)[0];
        case 'retrigger': case 'copy': {
          const ok = r.cands.map(u => G.find(u).card).filter(c => GOOD_TRIGGERS.includes(c.id) && (c.id !== 'pilot' || p.drinks > 0));
          ok.sort((a, b) => GOOD_TRIGGERS.indexOf(a.id) - GOOD_TRIGGERS.indexOf(b.id));
          return ok.length ? ok[0].uid : null;
        }
        case 'destroy': case 'curse': {
          const s = r.cands.map(u => { const f = G.find(u); const row = G.score(f.owner).rows.find(x => x.uid === u);
            return { u, v: this.visible(G, f.owner) * 0.2 + (r.purpose === 'curse' ? row.bonus + (CAPY[f.card.id].util || 0) : this.loss(G, f.owner, u)) }; });
          return s.sort((a, b) => b.v - a.v)[0].u;
        }
        default: return r.optional ? null : r.cands[0];
      }
    }
    return null;
  },
};

if (typeof module !== 'undefined') module.exports = { Bot };
