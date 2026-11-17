'use strict';
// Guided first game: coach bubbles, a spotlight, and a few forced moves.

const Tut = {
  on: false, stage: 0, restrict: null, queue: [], sel: null, next: 0, seen: {},

  begin() { this.on = true; this.stage = 0; this.restrict = null; this.queue = []; this.seen = {}; this.sel = null; },
  stop() { this.on = false; this.restrict = null; this.queue = []; this.hide(); },
  hide() { this.sel = null; $('#tut').className = 'hidden'; },
  allow(a) { return !this.restrict || this.restrict(a); },

  show(text, sel, withNext) {
    this.sel = sel || null;
    $('#tut').className = withNext ? 'info' : 'task';
    $('#tut-bubble').innerHTML = `<div class="tb-capy"><svg viewBox="0 0 100 100"><use href="#capy"/></svg></div><div class="tb-body"><div class="tb-text">${text}</div>
      <div class="tb-btns">${withNext ? '<button class="btn sm" id="tut-next">Next</button>' : '<span class="tb-do">👆 Your move</span>'}<button class="tb-skip" id="tut-skip">Skip tutorial</button></div></div>`;
    $('#tut-skip').onclick = () => { const r = this._res; this._res = null; this.stop(); UI.render(); if (r) r(); };
    this.reposition();
  },
  info(text, sel) {
    return new Promise(res => {
      this._res = res; this.show(text, sel, true);
      $('#tut-next').onclick = () => { this._res = null; this.hide(); res(); };
    });
  },
  task(text, sel, restrict, next) { this.restrict = restrict; this.next = next; this.show(text, sel, false); },

  reposition() {
    if (!this.on || $('#tut').classList.contains('hidden')) return;
    const spot = $('#tut-spot'), b = $('#tut-bubble'), el = this.sel && document.querySelector(this.sel);
    if (!el) { spot.style.display = 'none'; b.style.left = '50%'; b.style.top = '22%'; b.style.transform = 'translateX(-50%)'; return; }
    const r = el.getBoundingClientRect(), pad = 8;
    spot.style.display = 'block';
    Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    b.style.transform = 'none';
    const bw = b.offsetWidth, bh = b.offsetHeight;
    let x = Math.max(12, Math.min(innerWidth - bw - 12, r.left + r.width / 2 - bw / 2));
    let y = r.top - bh - 22; if (y < 12) y = r.bottom + 22;
    if (y + bh > innerHeight - 12) { y = Math.max(12, r.top + r.height / 2 - bh / 2); x = r.right + 22 + bw < innerWidth ? r.right + 22 : Math.max(12, r.left - bw - 22); }
    b.style.left = x + 'px'; b.style.top = y + 'px';
  },

  async flush() { while (this.on && this.queue.length) { const q = this.queue.shift(); await this.info(q[0], q[1]); } },

  async beforeAct(G, o) {
    if (!this.on) return;
    UI.pending = null; UI.render();
    const slotOf = id => G.bar.findIndex(c => c && c.id === id);
    const can = s => s >= 0 && o.invites.some(x => x.slot === s);
    const once = k => (this.seen[k] ? false : (this.seen[k] = true));
    switch (this.stage) {
      case 0: {
        if (once('intro')) {
          await this.info('<b>Welcome to Capybar!</b><br>You run a table in a bar full of capybaras. Invite the most interesting guests and score the most points (<b class="st">★</b>) before the bar closes.');
          await this.info('This is <b>your table</b>. It seats 6 capybaras. You start with one regular: the Resident, worth 1 <b class="st">★</b>.', '#my-table');
          await this.info('<b>Drinks</b> are the currency. You start with 3 and gain 1 at the start of each turn.', '#my-drinks');
          await this.info('This is <b>the Bar</b>: six capybaras anyone can invite. The amber coin is the cost, the dark badge is the points. Hover a card to read it in full.', '.bar-slots');
        }
        const s = slotOf('guitarist');
        if (can(s)) this.task('Each turn you take <b>one main action</b>. Let\'s invite a guest: click the <b>Guitarist</b> (2 Drinks).', `.barslot[data-slot="${s}"]`, a => a.type === 'invite' && a.slot === s, 1);
        else { this.stage = 2; return this.beforeAct(G, o); }
        break;
      }
      case 1: {
        const s = slotOf('drummer');
        if (can(s)) this.task('Capybaras combine. Your Guitarist scores <b>+2 ★ if a Drummer or Singer</b> sits with it. Invite the <b>Drummer</b> and watch the Guitarist\'s badge go up.', `.barslot[data-slot="${s}"]`, a => a.type === 'invite' && a.slot === s, 2);
        else { await this.info('Normally you would hunt for combos here, like a Drummer for your Guitarist. This turn the choice is yours.'); this.task('Take any action: invite, buy an Action card, or collect Drinks.', null, null, 2); }
        break;
      }
      case 2:
        this.task('You are running dry. When you cannot afford what you want, <b>collect 2 Drinks</b> as your main action.', '[data-act="collect"]', a => a.type === 'collect', 3);
        break;
      case 3:
        if (o.canBuy) this.task('The third main action: <b>buy an Action card</b>. It is a random draw from this deck. Click it.', '.pile[data-act="buy"]', a => a.type === 'buy', 4);
        else this.task('Collect Drinks again so you can afford an Action card next turn.', '[data-act="collect"]', a => a.type === 'collect', 3);
        break;
      case 4: {
        const h = o.plays.find(x => x.id === 'backroom_deal');
        if (!h) { this.stage = 5; return this.beforeAct(G, o); }
        this.task('You drew <b>Backroom Deal</b>. You may play <b>one Action card per turn</b>, on top of your main action. Click it to play it.', '#my-hand', a => a.type === 'play' && a.hand === h.hand, 5);
        this.afterInfo = [['A capybara went into your <b>Backroom</b>. Rivals cannot see it. It scores its printed <b class="st">★</b> at the end, but its ability does not work in there. Click the Backroom any time to look inside.', '#my-backroom']];
        break;
      }
      default:
        if (once('outro')) {
          await this.info('Your running total is always shown here. Rivals only show their table score: their Backrooms stay hidden until the end.', '#my-score');
          await this.info('The game ends after the round in which the deck runs out, or after round 12. Some Action cards are nasty: they discard, swap or curse capybaras, so keep an eye on your rivals.');
          await this.info('That is everything. The <b>Rules</b> button at the top has the full rules and every card. Good luck, and may you become the Capybaron of the Night!');
        }
        this.stop();
    }
    UI.render();
  },
  afterAct() {
    if (!this.on) return;
    this.restrict = null; this.stage = this.next; this.hide();
    if (this.afterInfo) { this.queue.push(...this.afterInfo); this.afterInfo = null; }
  },
  async beforeVote() {
    if (this.on && !this.seen.vote) { this.seen.vote = true; await this.info('<b>A new round begins.</b> The Bar tops up, then a newcomer knocks at the door. The Bar is full, so every table votes on letting them in. Vote however you like.'); }
  },
  async beforeRemove() {
    if (this.on && !this.seen.rem) { this.seen.rem = true; await this.info('The newcomer is in, so someone must leave. Vote out capybaras your rivals want, and keep the ones you are saving up for.'); }
  },
};
