'use strict';
// Capybar rules engine. No DOM here: players are driven through agents
// ({act, choose}) and the UI listens through game.onEvent.

const MAX_ROUNDS = 12, TABLE_MAX = 6, BAR_SIZE = 6, HAND_MAX = 5;
const ACTION_PRICE = 2, COLLECT = 2, START_DRINKS = 3, INCOME = 1;
const NO_COPY = ['time', 'actor'];
const CAPY = {}, ACT = {};
CAPYS.forEach(c => { CAPY[c.id] = c; });
ACTIONS.forEach(a => { ACT[a.id] = a; });

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

class Game {
  constructor(opts) {
    this.opts = opts;
    this.rand = opts.seed != null ? mulberry32(opts.seed) : Math.random;
    this.rig = opts.rig || {};
    this.reserved = new Set(this.rig.reserved || []); // tutorial: bots leave these alone
    this.nextUid = 1;
    this.round = 0; this.current = -1; this.over = false; this.finalRound = false;
    this.logs = []; this.turn = null; this.onEvent = null;
    this.discardPile = []; this.actionDiscard = [];
    this.players = opts.players.map((pl, i) => ({
      idx: i, name: pl.name, isBot: !!pl.isBot, agent: pl.agent, avatar: pl.avatar || '🦫',
      drinks: START_DRINKS, table: [this.mk('resident')], backroom: [], hand: [], bonus: 0, actionsPlayed: 0,
    }));
    this.deck = [];
    for (const c of CAPYS) for (let k = 0; k < c.copies; k++) this.deck.push(this.mk(c.id));
    this.shuffle(this.deck);
    for (const id of (this.rig.barFirst || []).slice().reverse()) {
      const i = this.deck.findIndex(c => c.id === id);
      if (i >= 0) this.deck.push(this.deck.splice(i, 1)[0]);
    }
    this.actionDeck = ACTIONS.map(a => ({ uid: this.nextUid++, id: a.id }));
    this.shuffle(this.actionDeck);
    this.bar = new Array(BAR_SIZE).fill(null);
  }

  mk(id) { return { uid: this.nextUid++, id }; }
  shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  pick(a) { return a[Math.floor(this.rand() * a.length)]; }
  others(pi) { return this.players.filter(q => q.idx !== pi); }

  async notify(type, data) { if (this.onEvent) await this.onEvent(type, data || {}); }
  async say(msg, ms, kind) { this.logs.push({ round: this.round, msg }); await this.notify('say', { msg, ms: ms == null ? 650 : ms, kind }); }
  ask(pi, req) { return this.players[pi].agent.choose(this, pi, req); }

  // ---------- card queries ----------
  isType(card, type) { return CAPY[card.id].type === type || (card.id === 'bara' && !card.cursed); }
  has(pi, id) { return this.players[pi].table.some(c => c.id === id && !c.cursed); }
  isProtected(pi, card) {
    if (card.id === 'nonchalant' && !card.cursed) return true;
    return card.id !== 'super' && this.has(pi, 'super');
  }
  find(uid) {
    for (const p of this.players) { const i = p.table.findIndex(c => c.uid === uid); if (i >= 0) return { owner: p.idx, card: p.table[i], i }; }
    return null;
  }
  costFor(pi, card) {
    let c = CAPY[card.id].cost;
    if (c > 1 && this.has(pi, 'driver')) c -= 1;
    if (this.turn && this.current === pi) c = Math.max(0, c - this.turn.discount);
    return c;
  }
  actionPrice(pi) { return this.has(pi, 'engineer') ? 1 : ACTION_PRICE; }

  // Score a player. `table` may be a hypothetical table (used by bots).
  score(pi, table) {
    const p = this.players[pi];
    table = table || p.table;
    const on = id => table.some(c => c.id === id && !c.cursed);
    const mus = table.filter(c => this.isType(c, 'musician')).length;
    const tech = table.filter(c => this.isType(c, 'tech')).length;
    const singer = on('singer');
    const nTypes = on('bara') ? Object.keys(TYPES).length : new Set(table.map(c => CAPY[c.id].type)).size;
    const rows = table.map((c, i) => {
      const d = CAPY[c.id];
      let base = d.pts, bonus = 0;
      if (c.id === 'humanoid' && !c.cursed) {
        const n = [table[i - 1], table[i + 1]].filter(Boolean).map(x => CAPY[x.id].pts);
        base = n.length ? Math.max(...n) : 0;
      }
      if (c.star) base *= 2;
      if (singer && c.id !== 'singer' && this.isType(c, 'musician')) base *= 2;
      if (!c.cursed) switch (c.id) {
        case 'sleepy': bonus = 2 * (table.filter(x => x.id === 'sleepy').length - 1); break;
        case 'party': bonus = mus; break;
        case 'pianist': bonus = 2 * (mus - 1); break;
        case 'guitarist': bonus = (on('singer') || on('drummer')) ? 2 : 0; break;
        case 'athlete': bonus = Math.min(4, Math.floor(p.drinks / 2)); break;
        case 'olympic': bonus = on('athlete') ? 4 : 0; break;
        case 'influencer': bonus = nTypes; break;
        case 'robo': bonus = 2 * (tech - 1); break;
        case 'bara': bonus = table.length >= TABLE_MAX ? 2 : 0; break;
        case 'storyteller': bonus = Math.min(5, p.actionsPlayed); break;
      }
      return { uid: c.uid, id: c.id, base, bonus, pts: base + bonus };
    });
    const tableTotal = rows.reduce((s, r) => s + r.pts, 0);
    const per = on('philosopher') ? 1 : 0;
    const backroom = p.backroom.reduce((s, c) => s + CAPY[c.id].pts + per, 0);
    return { rows, tableTotal, backroom, bonus: p.bonus, total: tableTotal + backroom + p.bonus };
  }

  // ---------- state changes ----------
  drawCapy() { return this.deck.length ? this.deck.pop() : null; }
  drawAction(pi) {
    if (this.rig.humanFirstAction && !this.players[pi].isBot) {
      const i = this.actionDeck.findIndex(c => c.id === this.rig.humanFirstAction);
      this.rig.humanFirstAction = null;
      if (i >= 0) return this.actionDeck.splice(i, 1)[0];
    }
    if (!this.actionDeck.length) { this.actionDeck = this.shuffle(this.actionDiscard); this.actionDiscard = []; }
    return this.actionDeck.pop() || null;
  }
  giveAction(pi, n) {
    const p = this.players[pi]; let got = 0;
    for (let k = 0; k < n; k++) { if (p.hand.length >= HAND_MAX) break; const c = this.drawAction(pi); if (!c) break; p.hand.push(c); got++; }
    return got;
  }
  clean(card) { delete card.star; delete card.cursed; return card; }
  refill() { let n = 0; for (let i = 0; i < BAR_SIZE; i++) if (!this.bar[i]) { const c = this.drawCapy(); if (!c) break; this.bar[i] = c; n++; } return n; }
  toBackroom(pi, card) { this.players[pi].backroom.push(this.clean(card)); }
  // Discard a capybara from a table. A discarded Zombie sends a hidden capybara from the deck into the Backroom instead,
  // so rivals never learn which capybara is back there.
  removeFromTable(pi, uid) {
    const p = this.players[pi]; const i = p.table.findIndex(c => c.uid === uid);
    if (i < 0) return null;
    const card = p.table.splice(i, 1)[0];
    const zombie = card.id === 'zombie' && !card.cursed;
    this.clean(card);
    this.discardPile.push(card);
    let hidden = false;
    if (zombie) { const c = this.drawCapy(); if (c) { this.toBackroom(pi, c); hidden = true; } }
    return { card, zombie: hidden };
  }
  swap(a, b) {
    const A = this.find(a), B = this.find(b);
    this.players[A.owner].table[A.i] = B.card; this.players[B.owner].table[B.i] = A.card;
  }
  lose(pi, n) { const p = this.players[pi]; const k = Math.min(n, p.drinks); p.drinks -= k; return k; }

  // ---------- main loop ----------
  async run() {
    this.refill();
    const n = this.players.length; let first = 0;
    while (!this.over) {
      this.round++;
      await this.notify('round', { round: this.round });
      await this.barPhase();
      if (this.round % 2 === 0) for (const p of this.players) if (this.has(p.idx, 'drummer')) { p.drinks++; await this.say(`${p.name}'s Drummer earns 1 Drink`, 450); }
      for (let k = 0; k < n; k++) await this.takeTurn((first + k) % n);
      if (this.finalRound || this.round >= MAX_ROUNDS || this.deck.length === 0) this.over = true;
      first = (first + 1) % n;
    }
    this.current = -1;
    const results = this.players.map(p => ({ idx: p.idx, name: p.name, ...this.score(p.idx) }));
    results.sort((a, b) => b.total - a.total || this.players[b.idx].drinks - this.players[a.idx].drinks);
    this.results = results;
    await this.notify('gameover', { results });
    return results;
  }

  async barPhase() {
    this.current = -1;
    const added = this.refill();
    if (this.round > 1 && added) await this.say(`The Bar tops up with ${added} new capybara${added > 1 ? 's' : ''}`, 600);
    if (this.round === 1 || !this.deck.length) return;
    const nc = this.drawCapy();
    const hole = this.bar.indexOf(null);
    if (hole >= 0) { this.bar[hole] = nc; return; }
    this.newcomer = nc;
    const name = CAPY[nc.id].name;
    await this.say(`${name} Capybara is at the door. The tables vote!`, 500);
    const votes = (await Promise.all(this.players.map(p => this.ask(p.idx, { kind: 'vote', card: nc })))).map(v => !!v);
    const yes = votes.filter(Boolean).length, keep = yes >= votes.length - yes;
    this.logs.push({ round: this.round, msg: keep ? `Vote: ${name} is let in (${yes}–${votes.length - yes})` : `Vote: ${name} is sent away (${yes}–${votes.length - yes})` });
    await this.notify('voteResult', { card: nc, votes, keep });
    if (!keep) { this.discardPile.push(nc); this.newcomer = null; return; }
    const tally = new Array(BAR_SIZE).fill(0), picks = [];
    const raw = await Promise.all(this.players.map(p => this.ask(p.idx, { kind: 'voteRemove', card: nc })));
    for (const p of this.players) {
      let sel = Array.isArray(raw[p.idx]) ? raw[p.idx] : [];
      sel = [...new Set(sel)].filter(s => this.bar[s]).slice(0, 3);
      if (!sel.length) sel = [this.bar.findIndex(Boolean)];
      picks[p.idx] = sel; sel.forEach(s => tally[s]++);
    }
    const max = Math.max(...tally);
    const out = tally.map((t, i) => t === max ? i : -1).filter(i => i >= 0);
    const gone = out.map(i => this.bar[i]);
    await this.notify('removeResult', { card: nc, picks, tally, out, bar: this.bar.slice() });
    for (const i of out) { this.discardPile.push(this.bar[i]); this.bar[i] = null; }
    this.bar[out[0]] = nc; this.newcomer = null;
    await this.say(`${name} takes a seat at the Bar. ${gone.map(c => CAPY[c.id].name).join(', ')} ${gone.length > 1 ? 'leave' : 'leaves'}.`, 700);
  }

  options(pi) {
    const p = this.players[pi], t = this.turn;
    const invites = [];
    if (!t.mainDone) this.bar.forEach((c, slot) => { if (c) { const cost = this.costFor(pi, c); if (cost <= p.drinks) invites.push({ slot, cost }); } });
    const price = this.actionPrice(pi);
    const canBuy = !t.mainDone && p.drinks >= price && p.hand.length < HAND_MAX && (this.actionDeck.length + this.actionDiscard.length) > 0;
    const plays = [];
    if (t.plays > 0) p.hand.forEach((c, hand) => { if (p.isBot && t.failed.has(c.uid)) return; if (this.actionSpec(pi, c.id)) plays.push({ hand, id: c.id }); });
    return { mainDone: t.mainDone, invites, canBuy, price, plays, canCollect: !t.mainDone, canEnd: t.mainDone };
  }

  async takeTurn(pi) {
    const p = this.players[pi];
    this.current = pi;
    this.turn = { mainDone: false, plays: 1, discount: 0, extra: false, failed: new Set() };
    p.drinks += INCOME;
    await this.say(`${p.name}'s turn`, p.isBot ? 550 : 250, 'turn');
    for (let guard = 0; guard < 40; guard++) {
      const o = this.options(pi);
      if (o.mainDone && !o.plays.length) break;
      const a = await p.agent.act(this, pi, o);
      if (!a || a.type === 'end') { if (o.mainDone) break; continue; }
      if (a.type === 'collect' && o.canCollect) {
        p.drinks += COLLECT; this.turn.mainDone = true;
        await this.say(`${p.name} collects ${COLLECT} Drinks`);
      } else if (a.type === 'buy' && o.canBuy) {
        p.drinks -= o.price; this.turn.mainDone = true;
        const c = this.drawAction(pi); if (c) p.hand.push(c);
        await this.say(`${p.name} buys an Action card`);
      } else if (a.type === 'invite' && o.invites.some(x => x.slot === a.slot)) {
        if (await this.invite(pi, a.slot)) this.turn.mainDone = true;
      } else if (a.type === 'play' && o.plays.some(x => x.hand === a.hand)) {
        const card = p.hand[a.hand];
        if (!(await this.playAction(pi, a.hand))) this.turn.failed.add(card.uid);
      }
    }
    if (p.drinks === 0 && this.has(pi, 'hungry')) { p.drinks = 1; await this.say(`${p.name}'s Hungry Capybara finds 1 Drink`, 450); }
    const extra = this.turn.extra;
    this.turn = null;
    if (extra) { await this.say(`Time Skip! ${p.name} goes again`, 600); await this.takeTurn(pi); }
  }

  async invite(pi, slot) {
    const p = this.players[pi], card = this.bar[slot], cost = this.costFor(pi, card);
    if (p.table.length >= TABLE_MAX) {
      const out = await this.ask(pi, { kind: 'capy', purpose: 'discardOwn', incoming: card, cands: p.table.map(c => c.uid), optional: true, prompt: `Your table is full. Choose a capybara to send home for ${CAPY[card.id].name}` });
      if (out == null) return false;
      const r = this.removeFromTable(pi, out);
      await this.say(r.zombie ? `${p.name}'s Zombie leaves, and a capybara slips into the Backroom` : `${p.name} sends ${CAPY[r.card.id].name} home`, 500);
    }
    p.drinks -= cost; this.bar[slot] = null; p.table.push(card); this.turn.discount = 0;
    await this.say(`${p.name} invites ${CAPY[card.id].name} for ${cost} Drink${cost === 1 ? '' : 's'}`, 750);
    await this.onInvite(pi, card.id, card.uid);
    return true;
  }

  // "On invite" abilities. `src` is the uid of the capybara that triggered it.
  async onInvite(pi, id, src) {
    const p = this.players[pi], oth = this.others(pi);
    switch (id) {
      case 'gossiping': {
        const theirs = oth.flatMap(q => q.table.filter(c => !this.isProtected(q.idx, c))).map(c => c.uid);
        const mine = p.table.filter(c => c.uid !== src).map(c => c.uid);
        if (!theirs.length || !mine.length) break;
        const take = await this.ask(pi, { kind: 'capy', purpose: 'swapTake', cands: theirs, mine, optional: true, prompt: 'Gossiping: choose a rival capybara to swap for (or skip)' });
        if (take == null) break;
        const give = await this.ask(pi, { kind: 'capy', purpose: 'swapGive', cands: mine, take, prompt: 'Gossiping: choose one of yours to give away' });
        if (give == null) break;
        await this.doSwap(pi, give, take);
        break;
      }
      case 'drunk': {
        const rest = p.table.filter(c => c.uid !== src && c.id !== 'drunk');
        if (!rest.length) break;
        const r = this.removeFromTable(pi, this.pick(rest).uid);
        await this.say(r.zombie ? `Drunk knocks out the Zombie, and a capybara slips into ${p.name}'s Backroom` : `Drunk Capybara chases ${CAPY[r.card.id].name} away from ${p.name}'s table`, 800);
        break;
      }
      case 'detective': {
        const c = oth.filter(q => q.backroom.length).map(q => q.idx);
        if (!c.length) { p.drinks += 2; await this.say(`Detective finds nothing to steal: ${p.name} gains 2 Drinks`); break; }
        const t = c.length === 1 ? c[0] : await this.ask(pi, { kind: 'player', purpose: 'steal', cands: c, prompt: 'Detective: choose a rival Backroom to steal from' });
        const q = this.players[t == null ? c[0] : t];
        const card = q.backroom.splice(Math.floor(this.rand() * q.backroom.length), 1)[0];
        p.backroom.push(card);
        await this.say(`Detective steals a capybara from ${q.name}'s Backroom`, 800);
        break;
      }
      case 'time': {
        const c = p.table.filter(x => CAPY[x.id].inv && !NO_COPY.includes(x.id) && x.uid !== src).map(x => x.uid);
        if (!c.length) break;
        const t = await this.ask(pi, { kind: 'capy', purpose: 'retrigger', cands: c, optional: true, prompt: 'Time: choose one of your capybaras to trigger again (or skip)' });
        if (t == null) break;
        const f = this.find(t);
        await this.say(`Time rewinds: ${CAPY[f.card.id].name} triggers again`, 600);
        await this.onInvite(pi, f.card.id, f.card.uid);
        break;
      }
      case 'scientist': {
        const c = this.drawCapy(); if (!c) break;
        this.toBackroom(pi, c);
        await this.say(`Scientist sneaks a capybara into ${p.name}'s Backroom`, 700);
        break;
      }
      case 'pilot': {
        if (p.drinks < 1) break;
        const c = this.bar.map((x, i) => x && CAPY[x.id].cost <= 3 ? i : -1).filter(i => i >= 0);
        if (!c.length) break;
        const s = await this.ask(pi, { kind: 'bar', purpose: 'pilot', cands: c, optional: true, prompt: 'Pilot: pay 1 Drink to fly a Bar capybara away and stash a hidden capybara in your Backroom (or skip)' });
        if (s == null) break;
        p.drinks -= 1; const card = this.bar[s]; this.bar[s] = null; this.discardPile.push(this.clean(card));
        const hid = this.drawCapy(); if (hid) this.toBackroom(pi, hid);
        await this.say(`Pilot flies ${CAPY[card.id].name} away and ${p.name} stashes a capybara in the Backroom`, 800);
        break;
      }
      case 'magician': {
        if (this.giveAction(pi, 1)) await this.say(`Magician pulls an Action card out of a hat for ${p.name}`, 700);
        break;
      }
      case 'witch': {
        const t = oth.length === 1 ? oth[0].idx : await this.ask(pi, { kind: 'player', purpose: 'harm', cands: oth.map(q => q.idx), prompt: 'Witch: choose a rival to lose 1 Drink' });
        const q = this.players[t == null ? oth[0].idx : t];
        this.lose(q.idx, 1); p.bonus += 2;
        await this.say(`Witch hexes ${q.name} (−1 Drink). ${p.name} gains 2 bonus ★`, 800);
        break;
      }
      case 'actor': {
        const c = this.players.flatMap(q => q.table).filter(x => CAPY[x.id].inv && !NO_COPY.includes(x.id) && x.uid !== src).map(x => x.uid);
        if (!c.length) break;
        const t = await this.ask(pi, { kind: 'capy', purpose: 'copy', cands: c, optional: true, prompt: 'Actor: choose any capybara whose "On invite" ability you copy (or skip)' });
        if (t == null) break;
        const f = this.find(t);
        await this.say(`Actor plays the part of ${CAPY[f.card.id].name}`, 600);
        await this.onInvite(pi, f.card.id, src);
        break;
      }
    }
  }

  async doSwap(pi, give, take) {
    const A = this.find(give), B = this.find(take);
    this.swap(give, take);
    await this.say(`${this.players[pi].name} swaps ${CAPY[A.card.id].name} for ${this.players[B.owner].name}'s ${CAPY[B.card.id].name}`, 900);
  }

  // What an Action card needs. null = cannot be played right now.
  actionSpec(pi, id) {
    const p = this.players[pi], oth = this.others(pi);
    const vuln = oth.flatMap(q => q.table.filter(c => !this.isProtected(q.idx, c)));
    const pl = (list, purpose) => list.length ? { kind: 'player', purpose, cands: list.map(q => q.idx) } : null;
    const cp = (list, purpose) => list.length ? { kind: 'capy', purpose, cands: list.map(c => c.uid) } : null;
    switch (id) {
      case 'bar_fight': return pl(oth.filter(q => q.table.some(c => !this.isProtected(q.idx, c))), 'harm');
      case 'lost_wallet': return pl(oth.filter(q => q.drinks > 0), 'harm');
      case 'stage_lights': return pl(oth.filter(q => q.drinks > 0 && q.table.some(c => this.isType(c, 'musician'))), 'harm');
      case 'conspiracy': return pl(oth.filter(q => q.backroom.length), 'harm');
      case 'bar_gossip': return pl(oth, 'peek');
      case 'applause': return cp(p.table.filter(c => !c.star), 'star');
      case 'power_nap': return cp(p.table.filter(c => CAPY[c.id].inv && !NO_COPY.includes(c.id)), 'retrigger');
      case 'secret_ingredient': return cp(oth.flatMap(q => q.table).filter(c => CAPY[c.id].inv && !NO_COPY.includes(c.id)), 'copy');
      case 'capy_swap': return vuln.length && p.table.length ? { kind: 'swap', cands: vuln.map(c => c.uid) } : null;
      case 'capybot': return cp(vuln.filter(c => this.isType(c, 'tech')), 'destroy');
      case 'witch_curse': return cp(vuln.filter(c => !c.cursed), 'curse');
      case 'backroom_deal': case 'sci_breakthrough': return this.deck.length ? { kind: 'none' } : null;
      case 'fake_id': return this.turn && !this.turn.mainDone ? { kind: 'none' } : null;
      default: return { kind: 'none' };
    }
  }

  async playAction(pi, hi) {
    const p = this.players[pi], card = p.hand[hi], a = ACT[card.id];
    const spec = this.actionSpec(pi, card.id);
    if (!spec) return false;
    let t = null, t2 = null;
    if (spec.kind === 'player' || spec.kind === 'capy') {
      t = await this.ask(pi, { ...spec, optional: true, cancel: true, prompt: a.prompt });
      if (t == null) return false;
    } else if (spec.kind === 'swap') {
      const mine = p.table.map(c => c.uid);
      t = await this.ask(pi, { kind: 'capy', purpose: 'swapTake', cands: spec.cands, mine, optional: true, cancel: true, prompt: a.prompt });
      if (t == null) return false;
      t2 = await this.ask(pi, { kind: 'capy', purpose: 'swapGive', cands: mine, take: t, optional: true, cancel: true, prompt: 'Capy Swap: choose one of yours to give away' });
      if (t2 == null) return false;
    }
    p.hand.splice(p.hand.indexOf(card), 1); this.actionDiscard.push(card);
    p.actionsPlayed++; this.turn.plays--;
    this.logs.push({ round: this.round, msg: `${p.name} plays ${a.name}` });
    await this.notify('play', { pi, id: card.id, ms: p.isBot ? 1500 : 900 });
    await this.applyAction(pi, card.id, t, t2);
    return true;
  }

  async applyAction(pi, id, t, t2) {
    const p = this.players[pi], oth = this.others(pi);
    const q = typeof t === 'number' && this.players[t];
    switch (id) {
      case 'free_round': p.drinks += 2; await this.say(`${p.name} gains 2 Drinks`); break;
      case 'bar_fight': {
        const c = q.table.filter(x => !this.isProtected(q.idx, x)); if (!c.length) break;
        const r = this.removeFromTable(q.idx, this.pick(c).uid);
        await this.say(r.zombie ? `${q.name}'s Zombie is knocked out, and a capybara slips into their Backroom` : `${CAPY[r.card.id].name} is thrown out of ${q.name}'s table`, 900);
        break;
      }
      case 'happy_hour': p.drinks += 3; oth.forEach(o => { o.drinks += 1; }); await this.say(`Happy Hour! ${p.name} gains 3 Drinks, everyone else 1`); break;
      case 'backroom_deal': { const c = this.drawCapy(); if (c) { this.toBackroom(pi, c); await this.say(`${p.name} slips a capybara into the Backroom`, 800); } break; }
      case 'capy_swap': await this.doSwap(pi, t2, t); break;
      case 'fake_id': this.turn.discount = 2; await this.say(`${p.name}'s next invite costs 2 less`); break;
      case 'bar_gossip': p.drinks += 1; await this.notify('peek', { pi, target: q.idx }); await this.say(`${p.name} peeks into ${q.name}'s Backroom and gains 1 Drink`); break;
      case 'lost_wallet': { const k = this.lose(q.idx, 2); await this.say(`${q.name} loses ${k} Drink${k === 1 ? '' : 's'}`); break; }
      case 'applause': { const f = this.find(t); f.card.star = true; await this.say(`${CAPY[f.card.id].name} gets a ×2 token`); break; }
      case 'stage_lights': { const m = q.table.filter(c => this.isType(c, 'musician')).length; const k = this.lose(q.idx, m); p.drinks += k; await this.say(`${p.name} takes ${k} Drink${k === 1 ? '' : 's'} from ${q.name}`); break; }
      case 'sci_breakthrough': {
        const cards = [this.drawCapy(), this.drawCapy()].filter(Boolean); if (!cards.length) break;
        let k = 0;
        if (cards.length > 1) { k = await this.ask(pi, { kind: 'pick', cards, prompt: 'Scientific Breakthrough: choose one for your Backroom' }); if (k !== 1) k = 0; }
        this.toBackroom(pi, cards[k]); if (cards.length > 1) this.discardPile.push(cards[1 - k]);
        await this.say(`${p.name} puts a capybara in the Backroom`, 800);
        break;
      }
      case 'magic_show': { const n = this.giveAction(pi, 2); this.turn.plays += 1; await this.say(`${p.name} draws ${n} Action card${n === 1 ? '' : 's'} and may play another`); break; }
      case 'conspiracy': { if (!q.backroom.length) break; const c = q.backroom.splice(Math.floor(this.rand() * q.backroom.length), 1)[0]; this.discardPile.push(c); await this.say(`A capybara vanishes from ${q.name}'s Backroom`, 800); break; }
      case 'late_snack': { const n = 1 + p.table.filter(c => this.isType(c, 'local')).length; p.drinks += n; await this.say(`${p.name} gains ${n} Drinks`); break; }
      case 'power_nap': { const f = this.find(t); await this.say(`${CAPY[f.card.id].name} wakes up and triggers again`, 600); await this.onInvite(pi, f.card.id, f.card.uid); break; }
      case 'secret_ingredient': { const f = this.find(t); await this.say(`${p.name} copies ${CAPY[f.card.id].name}`, 600); await this.onInvite(pi, f.card.id, -1); break; }
      case 'dimensional_drift': {
        const s = this.shuffle(this.bar.map((c, i) => c ? i : -1).filter(i => i >= 0)).slice(0, 2);
        for (const i of s) { this.discardPile.push(this.bar[i]); this.bar[i] = this.drawCapy(); }
        await this.say(`${s.length} Bar capybaras drift into another dimension`, 800);
        break;
      }
      case 'rebranding': {
        for (let i = 0; i < BAR_SIZE; i++) if (this.bar[i]) { this.discardPile.push(this.bar[i]); this.bar[i] = null; }
        this.refill(); await this.say('The Bar is rebranded: a whole new crowd arrives', 900);
        break;
      }
      case 'drink_spill': oth.forEach(o => this.lose(o.idx, 1)); p.drinks += 1; await this.say(`Everyone but ${p.name} loses 1 Drink`); break;
      case 'time_skip': this.turn.extra = true; await this.say(`${p.name} will take another turn`); break;
      case 'capybot': case 'witch_curse': {
        const f = this.find(t); if (!f) break;
        if (id === 'capybot') { const r = this.removeFromTable(f.owner, t); await this.say(`${CAPY[r.card.id].name} malfunctions and leaves ${this.players[f.owner].name}'s table`, 900); }
        else { f.card.cursed = true; await this.say(`${this.players[f.owner].name}'s ${CAPY[f.card.id].name} is cursed`, 900); }
        break;
      }
      case 'sponsorship': p.drinks += 2; p.bonus += 1; await this.say(`${p.name} gains 2 Drinks and 1 bonus ★`); break;
      case 'open_mic': { const n = 2 * p.table.filter(c => this.isType(c, 'musician')).length; p.bonus += n; await this.say(`${p.name} gains ${n} bonus ★`); break; }
      case 'final_toast': this.finalRound = true; await this.say('The Final Toast! The game ends after this round', 1100); break;
    }
  }
}

if (typeof module !== 'undefined') module.exports = { Game };
