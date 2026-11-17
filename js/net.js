'use strict';
// Online play over WebRTC (PeerJS). The host's browser runs the real Game;
// friends are remote "agents" that answer the engine's questions and receive
// a personal view (their own hand and Backroom only) after every event.

const ROOM_PREFIX = 'capybar-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FRIEND_AV = ['🍋', '🍇', '🍒', '🍓'];
const SELF_AV = '<svg class="avsvg" viewBox="0 0 100 100"><use href="#capy"/></svg>';

class RemoteAgent {
  constructor(conn) { this.conn = conn; this.n = 0; this.pend = new Map(); this.dead = false; }
  send(m) { try { this.conn.send(m); } catch (e) { /* connection gone */ } }
  fallback(kind, G, pi, payload) { return kind === 'act' ? Bot.act(G, pi, payload) : Bot.choose(G, pi, payload); }
  ask(kind, G, pi, payload) {
    if (this.dead) return this.fallback(kind, G, pi, payload);
    return new Promise(res => {
      const id = ++this.n;
      this.pend.set(id, { res, kind, G, pi, payload });
      this.send({ t: 'req', id, kind, payload, snap: Net.snapshot(G, pi) });
    });
  }
  act(G, pi, o) { return this.ask('act', G, pi, o); }
  choose(G, pi, r) { return this.ask('choose', G, pi, r); }
  onResp(m) {
    const p = this.pend.get(m.id); if (!p) return;
    this.pend.delete(m.id);
    let v = m.v === undefined ? null : m.v;
    // Never trust a client's answer blindly: an invalid pick falls back to the bot's choice.
    if (p.kind === 'choose' && p.payload.cands && v != null && !p.payload.cands.includes(v)) {
      return Promise.resolve(this.fallback(p.kind, p.G, p.pi, p.payload)).then(p.res);
    }
    if (p.kind === 'act' && (!v || typeof v.type !== 'string')) v = { type: 'end' };
    p.res(v);
  }
  die() {
    this.dead = true;
    const all = [...this.pend.values()]; this.pend.clear();
    for (const p of all) Promise.resolve(this.fallback(p.kind, p.G, p.pi, p.payload)).then(p.res);
  }
}

const Net = {
  role: null, peer: null, conn: null, code: '', members: [], total: 4, G: null,
  started: false, inLobby: false, sess: null, names: [], q: [], busy: false, myName: 'Player',

  // ---------- state views ----------
  snapshot(G, viewer, reveal) {
    const hidCapy = { uid: -1, id: 'resident' }, hidAct = { uid: -1, id: 'free_round' };
    const top = G.deck.length && G.has(viewer, 'journalist') ? G.deck[G.deck.length - 1] : null;
    return {
      round: G.round, current: G.current, finalRound: G.finalRound, over: G.over,
      bar: G.bar, deckLen: G.deck.length, deckTop: top, newcomer: G.newcomer || null,
      turn: G.turn ? { discount: G.turn.discount, plays: G.turn.plays, mainDone: G.turn.mainDone } : null,
      logs: G.logs.slice(-40),
      players: G.players.map(p => ({
        idx: p.idx, name: p.name, isBot: p.isBot, avatar: p.avatar, drinks: p.drinks, bonus: p.bonus, actionsPlayed: p.actionsPlayed,
        table: p.table,
        backroom: p.idx === viewer || reveal ? p.backroom : p.backroom.map(() => hidCapy),
        hand: p.idx === viewer ? p.hand : p.hand.map(() => hidAct),
      })),
    };
  },
  apply(G, s) {
    G.round = s.round; G.current = s.current; G.finalRound = s.finalRound; G.over = s.over;
    G.bar = s.bar; G.newcomer = s.newcomer; G.turn = s.turn; G.logs = s.logs; G.players = s.players;
    G.deck = new Array(s.deckLen).fill({ id: 'resident' });
    if (s.deckTop && s.deckLen) G.deck[s.deckLen - 1] = s.deckTop;
  },
  mirror() {
    return Object.assign(Object.create(Game.prototype), { onEvent: null, reserved: new Set(), rig: {}, players: [], deck: [], bar: [], logs: [], turn: null, current: -1, round: 0, finalRound: false, over: false });
  },

  // ---------- menu / lobby UI ----------
  name() { return (($('#name-in') || {}).value || '').trim().slice(0, 12) || 'Player'; },
  fail(msg) {
    const e = $('#n-err');
    if (e) { e.textContent = msg; return; }
    UI.openModal(`<h2>Online play</h2><p>${esc(msg)}</p><div class="mbtns"><button class="btn" id="n-back">Back</button></div>`);
    $('#n-back').onclick = () => this.menu();
  },
  menu(prefill) {
    this.leave(true);
    UI.openModal(`<h2>Play online</h2>
      <p>Host a room, or join a friend's with their 4-letter code. Empty seats are filled with bots.</p>
      <div class="mbtns col"><button class="btn big" id="n-host">Host a game</button>
        <div class="joinrow"><input id="n-code" class="name-in code-in" maxlength="4" placeholder="CODE" autocapitalize="characters" value="${esc((prefill || '').toUpperCase())}"><button class="btn big alt" id="n-join">Join</button></div>
        <button class="btn ghost" data-ui="close">Back</button></div><p id="n-err" class="err"></p>`);
    $('#n-host').onclick = () => this.host(this.name());
    $('#n-join').onclick = () => { const c = $('#n-code').value.trim().toUpperCase(); if (c.length !== 4) return this.fail('Enter the 4-letter room code.'); this.join(c, this.name()); };
    $('#n-code').oninput = e => { e.target.value = e.target.value.toUpperCase(); };
  },
  seatList(names, total, mine) {
    let h = '';
    for (let i = 0; i < 4; i++) {
      const n = names[i];
      if (n) h += `<div class="seatrow on"><span>${i === 0 ? '👑' : '🧑'}</span> ${esc(n)}${i === mine ? ' <small>(you)</small>' : ''}</div>`;
      else if (i < total) h += '<div class="seatrow bot"><span>🤖</span> Bot <small>fills this seat</small></div>';
      else h += '<div class="seatrow off">empty</div>';
    }
    return h;
  },
  drawHost() {
    if (!this.inLobby) return;
    const names = [this.myName, ...this.members.map(m => m.name)];
    const total = Math.max(this.total, names.length);
    const link = location.protocol.startsWith('http') ? `${location.origin}${location.pathname}?join=${this.code}` : '';
    UI.openModal(`<h2>Your room</h2>
      <div class="code-big">${this.code}</div>
      <p class="small">Friends open the game, press <b>Play online</b> and enter this code${link ? ', or just open the link:' : '.'}</p>
      ${link ? `<div class="linkrow"><input class="name-in" id="n-link" readonly value="${esc(link)}"><button class="btn sm" id="n-copy">Copy</button></div>` : ''}
      <div class="seats">${this.seatList(names, total, 0)}</div>
      <div class="opp-pick"><span>Seats</span>${[2, 3, 4].map(n => `<button class="chip${total === n ? ' on' : ''}" data-total="${n}" ${n < names.length ? 'disabled' : ''}>${n}</button>`).join('')}</div>
      <div class="mbtns"><button class="btn big" id="n-start">Start game</button><button class="btn ghost" id="n-cancel">Cancel</button></div>`);
    document.querySelectorAll('#modal [data-total]').forEach(b => b.onclick = () => { this.total = +b.dataset.total; this.drawHost(); });
    $('#n-start').onclick = () => this.startGame();
    $('#n-cancel').onclick = () => { this.leave(); UI.closeModal(); };
    const cp = $('#n-copy'); if (cp) cp.onclick = () => { try { navigator.clipboard.writeText($('#n-link').value); cp.textContent = 'Copied!'; } catch (e) { $('#n-link').select(); } };
  },
  drawJoin(msg) {
    UI.openModal(`<h2>Room ${this.code}</h2><div class="seats">${this.seatList(this.names, Math.max(this.names.length, this.total), this.names.indexOf(this.myName))}</div>
      <p>${esc(msg || 'You are in! Waiting for the host to start the game…')}</p><div class="mbtns"><button class="btn ghost" id="n-leave">Leave</button></div>`);
    $('#n-leave').onclick = () => { this.leave(); UI.closeModal(); };
  },

  // ---------- host ----------
  host(name) {
    if (typeof Peer === 'undefined') return this.fail('Online play needs an internet connection.');
    this.leave(true);
    this.role = 'host'; this.myName = name; this.members = []; this.started = false;
    const sess = this.sess = {};
    this.fail('Opening a room…');
    const open = tries => {
      const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      const peer = new Peer(ROOM_PREFIX + code);
      peer.on('open', () => { if (this.sess !== sess) return peer.destroy(); this.peer = peer; this.code = code; this.inLobby = true; this.drawHost(); });
      peer.on('connection', c => { if (this.sess === sess) this.onGuest(c); });
      peer.on('error', e => {
        if (this.sess !== sess) return;
        if (e.type === 'unavailable-id' && tries < 5) { peer.destroy(); open(tries + 1); }
        else if (!this.started) this.fail('Could not open a room (' + e.type + '). Check your connection and try again.');
      });
    };
    open(0);
  },
  memberOf(c) { return this.members.find(m => m.conn === c); },
  onGuest(c) {
    c.on('data', m => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') {
        if (this.started || this.members.length >= 3 || this.memberOf(c)) { try { c.send({ t: 'full', started: this.started }); } catch (e) {} setTimeout(() => c.close(), 400); return; }
        let nm = String(m.name || 'Friend').slice(0, 12), k = 2; const taken = () => nm === this.myName || this.members.some(x => x.name === nm);
        const base = nm; while (taken()) nm = base.slice(0, 10) + k++;
        this.members.push({ conn: c, name: nm, agent: null, seat: -1 });
        this.lobbyUpdate();
      } else if (m.t === 'resp') { const mem = this.memberOf(c); if (mem && mem.agent) mem.agent.onResp(m); }
    });
    const sess = this.sess;
    c.on('close', () => { if (this.sess === sess) this.onGuestGone(c); });
    c.on('error', () => { if (this.sess === sess) this.onGuestGone(c); });
  },
  onGuestGone(c) {
    const i = this.members.findIndex(m => m.conn === c); if (i < 0) return;
    const mem = this.members[i];
    if (!this.started) { this.members.splice(i, 1); this.lobbyUpdate(); return; }
    if (mem.agent && !mem.agent.dead) {
      mem.agent.die();
      const p = this.G.players[mem.seat]; if (p) { p.isBot = true; this.G.say(`${p.name} left the bar. A bot takes over.`, 900); }
    }
  },
  lobbyUpdate() {
    const names = [this.myName, ...this.members.map(m => m.name)];
    for (const m of this.members) { try { m.conn.send({ t: 'lobby', names, total: Math.max(this.total, names.length) }); } catch (e) {} }
    this.drawHost();
  },
  startGame() {
    if (this.started) return;
    this.started = true; this.inLobby = false;
    const humans = [{ name: this.myName, avatar: SELF_AV, agent: UI.humanAgent() }];
    this.members.forEach((m, i) => { m.seat = i + 1; m.agent = new RemoteAgent(m.conn); humans.push({ name: m.name, avatar: FRIEND_AV[i], agent: m.agent }); });
    const bots = BOTS.slice(0, Math.max(0, Math.max(this.total, humans.length) - humans.length)).map(b => ({ ...b, isBot: true, agent: Bot }));
    const G = new Game({ players: [...humans, ...bots] });
    G.refill(); this.G = G;
    for (const m of this.members) { try { m.conn.send({ t: 'start', me: m.seat, snap: this.snapshot(G, m.seat) }); } catch (e) {} }
    Tut.stop(); UI.mp = true; UI.me = 0; UI.start(G);
    G.onEvent = async (type, d) => {
      for (const m of this.members) {
        if (m.agent.dead) continue;
        const dd = type === 'peek' && d.pi === m.seat ? { ...d, cards: G.players[d.target].backroom } : d;
        m.agent.send({ t: 'ev', type, d: dd, snap: this.snapshot(G, m.seat, type === 'gameover') });
      }
      return UI.onEvent(G, type, d);
    };
    G.run().catch(e => { console.error(e); UI.msg = 'Something went wrong: ' + e.message; UI.render(); });
  },

  // ---------- client ----------
  join(code, name) {
    if (typeof Peer === 'undefined') return this.fail('Online play needs an internet connection.');
    this.leave(true);
    this.role = 'client'; this.code = code; this.myName = name; this.started = false; this.names = []; this.q = []; this.busy = false;
    const sess = this.sess = {};
    this.fail('Connecting to room ' + code + '…');
    const peer = new Peer(); this.peer = peer;
    const giveUp = setTimeout(() => { if (this.sess === sess && (!this.conn || !this.conn.open)) { this.leave(true); this.fail('Could not reach the room. Check the code and your connection.'); } }, 15000);
    peer.on('error', e => { if (this.sess !== sess) return; clearTimeout(giveUp); this.leave(true); this.fail(e.type === 'peer-unavailable' ? 'Room not found. Check the code.' : 'Connection problem (' + e.type + ').'); });
    peer.on('open', () => {
      if (this.sess !== sess) return;
      const c = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' });
      this.conn = c;
      c.on('open', () => { clearTimeout(giveUp); c.send({ t: 'hello', name }); this.drawJoin('Connected. Waiting for the host…'); });
      c.on('data', m => this.onHost(m));
      c.on('close', () => { if (this.sess === sess) this.hostGone(); });
    });
  },
  onHost(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'lobby') { this.names = m.names; this.total = m.total; if (!this.started) this.drawJoin(); }
    else if (m.t === 'full') { this.leave(true); this.fail(m.started ? 'That game has already started.' : 'That room is full.'); }
    else if (m.t === 'start') this.startClient(m);
    else if (m.t === 'ev' || m.t === 'req') { this.q.push(m); this.pump(); }
  },
  startClient(m) {
    this.started = true;
    const G = this.mirror(); this.G = G; this.apply(G, m.snap);
    Tut.stop(); UI.mp = true; UI.me = m.me; UI.start(G);
  },
  async pump() {
    if (this.busy) return; this.busy = true;
    try {
      while (this.q.length && this.G) {
        const m = this.q.shift(), G = this.G;
        this.apply(G, m.snap);
        if (m.t === 'ev') await UI.onEvent(G, m.type, m.d);
        else {
          UI.render();
          const agent = UI.humanAgent();
          const v = m.kind === 'act' ? await agent.act(G, UI.me, m.payload) : await agent.choose(G, UI.me, m.payload);
          if (this.conn) this.conn.send({ t: 'resp', id: m.id, v });
        }
      }
    } finally { this.busy = false; }
  },
  hostGone() {
    if (this.role !== 'client') return;
    const was = this.started;
    this.leave(true);
    UI.pending = null;
    UI.openModal(`<h2>${was ? 'The host left the game' : 'The room was closed'}</h2><p>${was ? 'The game cannot continue without the host.' : 'The host cancelled the room.'}</p><div class="mbtns"><button class="btn" data-ui="menu">Main menu</button></div>`);
  },

  leave(keepUI) {
    this.sess = null;
    try { if (this.conn) this.conn.close(); } catch (e) {}
    for (const m of this.members) { try { m.conn.close(); } catch (e) {} if (m.agent) m.agent.dead = true; }
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.peer = null; this.conn = null; this.members = []; this.role = null; this.G = null; this.started = false; this.inLobby = false; this.q = []; this.busy = false;
    UI.mp = false; UI.me = 0;
  },
};
