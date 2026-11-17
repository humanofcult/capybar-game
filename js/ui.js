'use strict';
// Table UI: renders the game, turns clicks into engine answers, shows modals.

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DRINK = '<i class="drink"></i>';
const rich = t => esc(t).replace(/★/g, '<b class="st">★</b>');

function artHTML(kind, id, emoji) {
  const has = ART[kind] && ART[kind].includes(id);
  const img = has ? `<div class="art-img" style="background-image:url(assets/${kind}/${id}.webp)"></div>` : '';
  if (kind === 'capy') return `<div class="art"><svg viewBox="0 0 100 100"><use href="#capy"/></svg><span class="art-emoji">${emoji}</span>${img}</div>`;
  return `<div class="art act-art"><span class="art-big">${emoji}</span>${img}</div>`;
}
function capyCard(card, o = {}) {
  const d = CAPY[card.id], t = TYPES[d.type];
  const pts = o.pts != null ? o.pts : d.pts, cost = o.cost != null ? o.cost : d.cost;
  return `<div class="card capy ${o.size || 'md'} ${o.cls || ''}${card.cursed ? ' cursed' : ''}" style="--tc:${t.color}" data-cid="${d.id}"${card.uid ? ` data-uid="${card.uid}"` : ''}>
    <div class="c-top"><span class="coin${cost < d.cost ? ' cheap' : ''}">${cost}</span><span class="c-name">${esc(d.name)}</span><span class="pts${pts > d.pts ? ' up' : pts < d.pts ? ' down' : ''}">${pts}</span></div>
    ${artHTML('capy', d.id, d.emoji)}
    <div class="c-type">${t.icon} ${t.name}</div>
    <div class="c-text"><span>${rich(d.text)}</span></div>
    ${card.star ? '<span class="tok tok-star">×2</span>' : ''}${card.cursed ? '<span class="tok tok-curse">☠</span>' : ''}
  </div>`;
}
function actionCard(card, o = {}) {
  const a = ACT[card.id];
  return `<div class="card action ${o.size || 'md'} ${o.cls || ''}" data-aid="${a.id}"${o.attrs || ''}>
    <div class="c-top"><span class="c-name">${esc(a.name)}</span></div>
    ${artHTML('action', a.id, a.emoji)}
    <div class="c-type">⚡ Action</div>
    <div class="c-text"><span>${rich(a.text)}</span></div>
  </div>`;
}
const backCard = (kind, size) => `<div class="card back ${kind} ${size || 'md'}"><div class="back-in">${kind === 'bk-capy' ? '<svg viewBox="0 0 100 100"><use href="#capy"/></svg>' : '<span>⚡</span>'}</div></div>`;

const UI = {
  game: null, pending: null, speed: 1, msg: '', showLog: false, me: 0, mp: false,

  start(game) {
    this.game = game; this.pending = null; this.msg = ''; this.seen = new Set();
    $('#menu').classList.add('hidden'); $('#game').classList.remove('hidden');
    this.closeModal(); $('#played').innerHTML = '';
    game.onEvent = (type, data) => this.onEvent(game, type, data);
    this.render();
  },
  toMenu() {
    this.game = null; this.pending = null; Tut.stop(); this.closeModal(); if (window.Net) Net.leave();
    $('#game').classList.add('hidden'); $('#menu').classList.remove('hidden');
  },

  async onEvent(g, type, d) {
    if (this.game !== g) return new Promise(() => {}); // an abandoned game stops here
    if (type === 'say') { this.msg = d.msg; this.render(); await sleep(d.ms * this.speed); if (Tut.on) await Tut.flush(); }
    else if (type === 'round') { this.msg = `Round ${d.round}`; this.render(); }
    else if (type === 'play') {
      const p = g.players[d.pi];
      this.msg = `${p.name} plays ${ACT[d.id].name}`; this.render();
      $('#played').innerHTML = `<div class="played-wrap"><div class="played-who">${p.avatar} ${esc(p.name)} plays</div>${actionCard({ id: d.id }, { size: 'lg' })}</div>`;
      await sleep(d.ms * Math.max(this.speed, 0.6));
      $('#played').innerHTML = '';
    }
    else if (type === 'peek') { if (d.pi === this.me) await this.peekModal(g, d.target, d.cards); }
    else if (type === 'voteResult') await this.voteResultModal(g, d);
    else if (type === 'removeResult') await this.removeResultModal(g, d);
    else if (type === 'gameover') { this.msg = 'Last call! The bar is closing.'; this.render(); this.gameOverModal(g, d.results); }
    if (this.game !== g) return new Promise(() => {});
  },

  // ---------- rendering ----------
  render() {
    const G = this.game; if (!G) return;
    const before = new Map();
    document.querySelectorAll('#game [data-uid]').forEach(el => before.set(el.dataset.uid, el.getBoundingClientRect()));
    const me = G.players[this.me], pend = this.pending;
    const acting = pend && pend.mode === 'act' ? pend.opts : null;
    const req = pend && pend.mode === 'choose' ? pend.req : null;
    const pickUid = req && req.kind === 'capy' ? new Set(req.cands) : new Set();
    const pickPl = req && req.kind === 'player' ? new Set(req.cands) : new Set();
    const pickBar = req && req.kind === 'bar' ? new Set(req.cands) : new Set();
    const tableHTML = (p, size) => {
      const sc = G.score(p.idx).rows; let h = '';
      for (let i = 0; i < TABLE_MAX; i++) {
        const c = p.table[i];
        h += `<div class="slot seat ${size}">${c ? capyCard(c, { size, pts: sc[i].pts, cls: pickUid.has(c.uid) ? 'pick' : '' }) : ''}</div>`;
      }
      return h;
    };

    $('#topbar').innerHTML = `
      <div class="brand"><svg viewBox="0 0 100 100"><use href="#capy"/></svg>Capybar</div>
      <div class="round">Round <b>${Math.max(1, G.round)}</b> / ${MAX_ROUNDS}${G.finalRound ? ' · <b class="warn">final round</b>' : ''}</div>
      <div class="tb-btns">
        <button class="tbtn" data-ui="speed">${this.speed < 1 ? '⏩ Fast' : '▶ Normal'}</button>
        <button class="tbtn" data-ui="log">📜 Log</button>
        <button class="tbtn" data-ui="rules">❔ Rules</button>
        <button class="tbtn" data-ui="menu">✕ Quit</button>
      </div>`;

    $('#opps').innerHTML = G.players.filter(p => p.idx !== this.me).map(p => {
      const s = G.score(p.idx);
      return `<div class="opp${G.current === p.idx ? ' active' : ''}${pickPl.has(p.idx) ? ' pick' : ''}" data-pi="${p.idx}">
        <div class="opp-head"><span class="av">${p.avatar}</span><b class="nm">${esc(p.name)}</b>
          <span class="stat" title="Drinks">${DRINK}${p.drinks}</span><span class="stat" title="Action cards in hand">🃏${p.hand.length}</span>
          <span class="stat" title="Capybaras hidden in the Backroom">🚪${p.backroom.length}</span><span class="stat sc" title="Visible score (Backroom is hidden)">★${s.tableTotal + s.bonus}</span></div>
        <div class="opp-table">${tableHTML(p, 'sm')}</div></div>`;
    }).join('');

    const peek = G.has(this.me, 'journalist') && G.deck.length ? CAPY[G.deck[G.deck.length - 1].id].name : '';
    let bar = '';
    for (let i = 0; i < BAR_SIZE; i++) {
      const c = G.bar[i];
      const can = c && ((acting && acting.invites.some(x => x.slot === i)) || pickBar.has(i));
      bar += `<div class="slot barslot md${can ? ' can' : ''}" data-slot="${i}">${c ? capyCard(c, { size: 'md', cost: G.costFor(this.me, c), cls: can ? 'pick' : (acting || pickBar.size ? 'dim' : '') }) : ''}</div>`;
    }
    $('#center').innerHTML = `
      <div class="pile" title="Capybara deck">${G.deck.length ? backCard('bk-capy', 'md') : '<div class="slot md"></div>'}<div class="pile-lab">Deck · ${G.deck.length}${peek ? `<br><small>next: ${esc(peek)}</small>` : ''}</div></div>
      <div class="barwrap"><div class="bar-title">— The Bar —</div><div class="bar-slots">${bar}</div></div>
      <div class="pile${acting && acting.canBuy ? ' can' : ''}" data-act="buy" title="Buy a random Action card">${backCard('bk-action', 'md')}<div class="pile-lab">Action card · ${G.actionPrice(this.me)}${DRINK}</div></div>`;

    let hint = '';
    if (acting) hint = acting.mainDone ? 'You may play an Action card, or end your turn.' : 'Your turn: invite a capybara, buy an Action card, or collect Drinks.';
    else if (req) hint = req.prompt || 'Choose';
    const skip = req && req.optional ? `<button class="btn sm" data-act="skip">${req.cancel ? 'Cancel' : 'Skip'}</button>` : '';
    $('#banner').innerHTML = `<div class="ban${acting || req ? ' mine' : ''}"><span class="ban-msg">${esc(this.msg)}</span>${hint ? `<span class="ban-hint">${esc(hint)}</span>` : ''}${skip}</div>`;

    const ms = G.score(this.me);
    const hand = me.hand.map((c, i) => {
      const can = acting && acting.plays.some(x => x.hand === i);
      return `<div class="hcard${can ? ' can' : ''}" data-act="hand" data-i="${i}" style="--i:${i};--n:${me.hand.length}">${actionCard(c, { size: 'hd' })}</div>`;
    }).join('');
    $('#me').innerHTML = `
      <div class="me-info${G.current === this.me ? ' active' : ''}">
        <div class="me-name"><span class="av">${me.avatar}</span> ${esc(me.name)}</div>
        <div class="me-drinks" id="my-drinks">${DRINK}<b>${me.drinks}</b><small>Drinks</small></div>
        <div class="me-score" id="my-score"><b>★ ${ms.total}</b><small>${ms.tableTotal} table${ms.backroom ? ` + ${ms.backroom} backroom` : ''}${ms.bonus ? ` + ${ms.bonus} bonus` : ''}</small></div>
        <button class="backroom" id="my-backroom" data-ui="backroom">🚪 Backroom <b>${me.backroom.length}</b></button>
      </div>
      <div class="my-table" id="my-table">${tableHTML(me, 'my')}</div>
      <div class="me-side">
        <div class="hand" id="my-hand">${hand || '<div class="hand-empty">No Action cards</div>'}</div>
        <div class="btns">
          <button class="btn" data-act="collect" ${acting && acting.canCollect ? '' : 'disabled'}>Collect ${COLLECT} ${DRINK}</button>
          <button class="btn alt" data-act="end" ${acting && acting.canEnd ? '' : 'disabled'}>End turn</button>
        </div>
      </div>`;

    $('#log').classList.toggle('hidden', !this.showLog);
    if (this.showLog) $('#log').innerHTML = `<h3>Log</h3>` + G.logs.slice(-60).reverse().map(l => `<div class="logl"><i>R${l.round}</i> ${esc(l.msg)}</div>`).join('');

    // FLIP: slide cards from where they were, pop in the new ones
    document.querySelectorAll('#game [data-uid]').forEach(el => {
      const a = before.get(el.dataset.uid), b = el.getBoundingClientRect();
      if (a) {
        const dx = a.left - b.left, dy = a.top - b.top, s = a.width / b.width;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) el.animate([{ transform: `translate(${dx}px,${dy}px) scale(${s})`, zIndex: 50 }, { transform: 'none', zIndex: 50 }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
      } else if (!this.seen.has(el.dataset.uid)) el.animate([{ transform: 'scale(.4) rotate(-8deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
      this.seen.add(el.dataset.uid);
    });
    Tut.reposition();
  },

  nudge(text) {
    const b = $('#banner .ban'); if (!b) return;
    if (text) { const h = b.querySelector('.ban-hint') || b.querySelector('.ban-msg'); h.textContent = text; }
    b.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 260 });
  },

  // ---------- input ----------
  onClick(e) {
    const ui = e.target.closest('[data-ui]');
    if (ui) return this.uiButton(ui.dataset.ui);
    const G = this.game, p = this.pending; if (!G || !p) return;
    const el = e.target.closest('[data-act]'), act = el && el.dataset.act;
    if (p.mode === 'choose') {
      const r = p.req;
      if (act === 'skip' && r.optional) return p.resolve(null);
      if (r.kind === 'capy') { const c = e.target.closest('#game [data-uid]'); if (c && r.cands.includes(+c.dataset.uid)) p.resolve(+c.dataset.uid); }
      else if (r.kind === 'player') { const o = e.target.closest('[data-pi]'); if (o && r.cands.includes(+o.dataset.pi)) p.resolve(+o.dataset.pi); }
      else if (r.kind === 'bar') { const s = e.target.closest('[data-slot]'); if (s && r.cands.includes(+s.dataset.slot)) p.resolve(+s.dataset.slot); }
      return;
    }
    const o = p.opts, slotEl = e.target.closest('.barslot');
    if (slotEl) {
      const slot = +slotEl.dataset.slot; if (!G.bar[slot]) return;
      if (o.invites.some(x => x.slot === slot)) return p.resolve({ type: 'invite', slot });
      return this.nudge(o.mainDone ? 'You already took your main action this turn.' : 'Not enough Drinks for that capybara.');
    }
    if (act === 'buy') return o.canBuy ? p.resolve({ type: 'buy' }) : this.nudge(o.mainDone ? 'You already took your main action this turn.' : G.players[this.me].hand.length >= HAND_MAX ? 'Your hand is full.' : 'Not enough Drinks for an Action card.');
    if (act === 'collect' && o.canCollect) return p.resolve({ type: 'collect' });
    if (act === 'end' && o.canEnd) return p.resolve({ type: 'end' });
    if (act === 'hand') {
      const i = +el.dataset.i;
      if (o.plays.some(x => x.hand === i)) return p.resolve({ type: 'play', hand: i });
      return this.nudge(G.turn && G.turn.plays < 1 ? 'You can play one Action card per turn.' : 'That card has no valid target right now.');
    }
  },
  uiButton(k) {
    const G = this.game;
    if (k === 'speed') { this.speed = this.speed < 1 ? 1 : 0.4; this.render(); }
    else if (k === 'log') { this.showLog = !this.showLog; this.render(); }
    else if (k === 'rules') this.rulesModal();
    else if (k === 'menu') this.toMenu();
    else if (k === 'backroom' && G) this.infoModal('Your Backroom', G.players[this.me].backroom.length
      ? `<p>Hidden from rivals. Each scores its printed ★ at game end, with no abilities.</p><div class="cardrow">${G.players[this.me].backroom.map(c => capyCard({ id: c.id }, { size: 'md' })).join('')}</div>`
      : '<p>Empty. Capybaras only get in here through card effects (Scientist, Pilot, Backroom Deal…). They score their printed ★ at game end, hidden from everyone else.</p>');
    else if (k === 'close') this.closeModal();
  },

  humanAgent() {
    const ui = this;
    return {
      async act(G, pi, opts) {
        if (Tut.on) await Tut.beforeAct(G, opts);
        return new Promise(res => {
          ui.pending = { mode: 'act', opts, resolve: a => { if (Tut.on && !Tut.allow(a)) return ui.nudge('Follow the tutorial step first.'); ui.pending = null; if (Tut.on) Tut.afterAct(a); res(a); } };
          ui.render();
        });
      },
      async choose(G, pi, req) {
        if (req.kind === 'vote') { if (Tut.on) await Tut.beforeVote(); const v = await ui.voteModal(G, req); if (ui.mp) ui.waiting(); return v; }
        if (req.kind === 'voteRemove') { if (Tut.on) await Tut.beforeRemove(); const v = await ui.removeModal(G, req); if (ui.mp) ui.waiting(); return v; }
        if (req.kind === 'pick') return ui.pickModal(req);
        return new Promise(res => { ui.pending = { mode: 'choose', req, resolve: v => { ui.pending = null; ui.render(); res(v); } }; ui.render(); });
      },
    };
  },

  // ---------- modals ----------
  openModal(html, cls) { const m = $('#modal'); m.className = cls || ''; m.innerHTML = `<div class="mbox">${html}</div>`; return m; },
  closeModal() { const m = $('#modal'); m.className = 'hidden'; m.innerHTML = ''; },
  infoModal(title, body) { this.openModal(`<h2>${title}</h2>${body}<div class="mbtns"><button class="btn" data-ui="close">Close</button></div>`); },
  waitBtn(m, auto) {
    return new Promise(res => {
      const h = e => { const b = e.target.closest('[data-v]'); if (b) { m.removeEventListener('click', h); res(b.dataset.v); } };
      m.addEventListener('click', h);
      if (this.mp && auto) setTimeout(() => { m.removeEventListener('click', h); res('auto'); }, auto);
    });
  },
  waiting() { const m = $('#modal'); if (m && !m.classList.contains('hidden')) m.querySelector('.mbox').innerHTML = '<h2>Waiting for the other players…</h2>'; },

  async voteModal(G, req) {
    const d = CAPY[req.card.id];
    const m = this.openModal(`<h2>A newcomer is at the door</h2>
      <div class="vote-row">${capyCard({ id: req.card.id }, { size: 'lg' })}
      <div class="vote-side"><p><b>${esc(d.name)} Capybara</b> wants a seat at the Bar, but the Bar is full.</p><p>Every table votes. If the newcomer is let in, you then vote on who has to leave. A tie lets them in.</p>
      <div class="mbtns col"><button class="btn big" data-v="1">👍 Let them in</button><button class="btn big alt" data-v="0">👎 Send them away</button></div></div></div>`);
    const v = await this.waitBtn(m); return v === '1';
  },
  async voteResultModal(G, d) {
    const rows = G.players.map(p => `<div class="vrow"><span>${p.avatar} ${esc(p.name)}</span><b class="${d.votes[p.idx] ? 'yes' : 'no'}">${d.votes[p.idx] ? '👍 in' : '👎 away'}</b></div>`).join('');
    const m = this.openModal(`<h2>${d.keep ? `${esc(CAPY[d.card.id].name)} is let in` : `${esc(CAPY[d.card.id].name)} is sent away`}</h2><div class="vlist">${rows}</div>
      <p>${d.keep ? 'Now someone at the Bar has to make room.' : 'The Bar stays as it is.'}</p><div class="mbtns"><button class="btn" data-v="ok">Continue</button></div>`);
    await this.waitBtn(m, 3200); this.closeModal();
  },
  async removeModal(G, req) {
    const sel = new Set();
    const draw = () => `<h2>Who leaves the Bar?</h2><p>Vote for 1 to 3 capybaras. The one with the most votes leaves; if several tie, they all leave.</p>
      <div class="cardrow">${G.bar.map((c, i) => c ? `<div class="vpick${sel.has(i) ? ' on' : ''}" data-s="${i}">${capyCard({ id: c.id }, { size: 'md' })}</div>` : '').join('')}</div>
      <div class="mbtns"><button class="btn big" data-v="ok" ${sel.size ? '' : 'disabled'}>Confirm vote</button></div>`;
    const m = this.openModal(draw(), 'wide');
    return new Promise(res => m.addEventListener('click', function h(e) {
      const s = e.target.closest('[data-s]');
      if (s) { const i = +s.dataset.s; if (sel.has(i)) sel.delete(i); else if (sel.size < 3) sel.add(i); m.querySelector('.mbox').innerHTML = draw(); return; }
      if (e.target.closest('[data-v]') && sel.size) { m.removeEventListener('click', h); res([...sel]); }
    }));
  },
  async removeResultModal(G, d) {
    const cards = d.bar.map((c, i) => c ? `<div class="vres${d.out.includes(i) ? ' out' : ''}">${capyCard({ id: c.id }, { size: 'md' })}<div class="vcount">${d.tally[i]} vote${d.tally[i] === 1 ? '' : 's'}${d.out.includes(i) ? ' · leaves' : ''}</div></div>` : '').join('');
    const m = this.openModal(`<h2>The Bar has voted</h2><div class="cardrow">${cards}</div><div class="mbtns"><button class="btn" data-v="ok">Continue</button></div>`, 'wide');
    await this.waitBtn(m, 4500); this.closeModal();
  },
  async pickModal(req) {
    const m = this.openModal(`<h2>${esc(req.prompt)}</h2><div class="cardrow">${req.cards.map((c, i) => `<div class="vpick" data-v="${i}">${capyCard({ id: c.id }, { size: 'lg' })}</div>`).join('')}</div>`, 'wide');
    const v = await this.waitBtn(m); this.closeModal(); return +v;
  },
  async peekModal(G, target, cards) {
    const q = G.players[target], list = cards || q.backroom;
    const m = this.openModal(`<h2>${esc(q.name)}'s Backroom</h2>${list.length ? `<div class="cardrow">${list.map(c => capyCard({ id: c.id }, { size: 'md' })).join('')}</div>` : '<p>Nothing in there.</p>'}<div class="mbtns"><button class="btn" data-v="ok">Continue</button></div>`);
    await this.waitBtn(m); this.closeModal();
  },
  gameOverModal(G, results) {
    const win = results[0];
    const rows = results.map((r, k) => {
      const p = G.players[r.idx];
      return `<div class="res${k === 0 ? ' win' : ''}">
        <div class="res-head"><span class="rank">${k + 1}</span><span class="av">${p.avatar}</span><b>${esc(p.name)}</b><span class="res-total">★ ${r.total}</span></div>
        <div class="res-cards">${p.table.map((c, i) => capyCard(c, { size: 'sm', pts: r.rows[i].pts })).join('')}${p.backroom.length ? `<span class="res-sep">🚪</span>${p.backroom.map(c => capyCard({ id: c.id }, { size: 'sm' })).join('')}` : ''}</div>
        <div class="res-sum">Table ${r.tableTotal} · Backroom ${r.backroom} · Bonus ${r.bonus}</div></div>`;
    }).join('');
    this.openModal(`<h2>${win.idx === this.me ? '🏆 You are the Capybaron of the Night!' : `${esc(win.name)} is the Capybaron of the Night`}</h2><div class="results">${rows}</div>
      <div class="mbtns">${this.mp ? '' : '<button class="btn big" id="again">Play again</button>'}<button class="btn alt" data-ui="menu">Main menu</button></div>`, 'wide');
    if (!this.mp) $('#again').onclick = () => App.play();
  },
  rulesModal() {
    const types = Object.values(TYPES).map(t => `<span class="tchip" style="--tc:${t.color}">${t.icon} ${t.name}</span>`).join('');
    this.openModal(`<h2>How to play Capybar</h2><div class="rules">
      <div class="rules-text">
      <p><b>Goal.</b> You run a table in a bar. Invite capybaras that score points (★) and combine well. Highest total when the bar closes wins.</p>
      <p><b>Setup.</b> Everyone starts with a Resident Capybara and 3 Drinks. The Bar shows 6 capybaras.</p>
      <p><b>Your turn.</b> Gain 1 Drink, then take <b>one</b> main action:</p>
      <ul><li><b>Invite</b> a capybara from the Bar by paying its cost. Your table seats 6; if it is full, send one home first.</li>
      <li><b>Buy an Action card</b> for 2 Drinks (random draw, hand limit ${HAND_MAX}).</li>
      <li><b>Collect</b> ${COLLECT} Drinks.</li></ul>
      <p>You may also <b>play one Action card</b> per turn, before or after your main action.</p>
      <p><b>New round.</b> The Bar refills. Then a newcomer knocks: every table votes to let them in or not (a tie lets them in). If they come in, everyone votes for who leaves the Bar. Most votes leaves, and tied capybaras all leave.</p>
      <p><b>Backroom.</b> A hidden stash. Capybaras only get in through card effects. They score their printed ★ at game end but their abilities do not work there.</p>
      <p><b>Tokens.</b> ×2 doubles a capybara's base ★. ☠ (cursed) switches its ability off.</p>
      <p><b>Game end.</b> After the round in which the deck runs out, after round ${MAX_ROUNDS}, or when The Final Toast is played. Score = table + Backroom + bonus ★.</p>
      <p><b>Types.</b> ${types}</p></div>
      <h3>Capybaras</h3><div class="gallery">${CAPYS.map(c => capyCard({ id: c.id }, { size: 'md' })).join('')}</div>
      <h3>Action cards</h3><div class="gallery">${ACTIONS.map(a => actionCard({ id: a.id }, { size: 'md' })).join('')}</div>
      </div><div class="mbtns"><button class="btn" data-ui="close">Close</button></div>`, 'wide');
  },

  // big preview while hovering any card
  hover(e) {
    const z = $('#zoom'), el = e.target.closest && e.target.closest('.card[data-cid], .card[data-aid]');
    if (!el || el.classList.contains('lg') || el.closest('#zoom')) { z.innerHTML = ''; return; }
    if (this._z === el && z.innerHTML) return;
    this._z = el;
    const uid = el.dataset.uid, f = uid && this.game && this.game.find(+uid);
    z.innerHTML = el.dataset.cid ? capyCard(f ? f.card : { id: el.dataset.cid }, { size: 'lg' }).replace(/data-uid="\d+"/, '') : actionCard({ id: el.dataset.aid }, { size: 'lg' });
    const r = el.getBoundingClientRect(), w = z.firstElementChild.offsetWidth, h = z.firstElementChild.offsetHeight;
    let x = r.right + 12; if (x + w > innerWidth - 8) x = r.left - w - 12; if (x < 8) x = 8;
    const y = Math.max(8, Math.min(innerHeight - h - 8, r.top + r.height / 2 - h / 2));
    z.style.left = x + 'px'; z.style.top = y + 'px';
  },
};
