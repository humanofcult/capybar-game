'use strict';
const BOTS = [{ name: 'Coco', avatar: '🥥' }, { name: 'Mango', avatar: '🥭' }, { name: 'Biscuit', avatar: '🍪' }];

const App = {
  bots: 2, last: null,
  play(tutorial) {
    if (tutorial == null) tutorial = false;
    Tut.stop();
    const n = tutorial ? 1 : this.bots;
    const name = ($('#name-in').value || '').trim() || 'Player';
    try { localStorage.setItem('capybar-name', name); } catch (e) {}
    const players = [{ name, avatar: '<img class="avimg" src="assets/misc/avatar.webp" alt="">', agent: UI.humanAgent() }]
      .concat(BOTS.slice(0, n).map(b => ({ ...b, isBot: true, agent: Bot })));
    const rig = tutorial ? { barFirst: ['guitarist', 'drummer', 'sleepy', 'athlete', 'witch', 'robo'], humanFirstAction: 'backroom_deal', reserved: ['drummer', 'guitarist'] } : null;
    const game = new Game({ players, rig });
    if (tutorial) Tut.begin();
    UI.start(game);
    game.run().catch(e => { console.error(e); UI.msg = 'Something went wrong: ' + e.message; UI.render(); });
  },
};

if (ART.misc.includes('back-capy')) document.documentElement.classList.add('art-backs');
for (const m of ART.misc) document.documentElement.style.setProperty('--img-' + m, `url("${new URL('assets/misc/' + m + '.webp', document.baseURI).href}")`);
try { const n = localStorage.getItem('capybar-name'); if (n) $('#name-in').value = n; } catch (e) {}
(function fans() {
  const fan = (ids, side) => `<div class="fan ${side}">${ids.map((id, i) => `<div class="fc" style="--i:${i};--r:${(side === 'left' ? -1 : 1) * (4 + i * 7) - (side === 'left' ? 6 : -6)}deg">${capyCard({ id }, { size: 'md' })}</div>`).join('')}</div>`;
  $('#menu-fan').innerHTML = fan(['pianist', 'bara', 'witch'], 'left') + fan(['detective', 'singer', 'magician'], 'right');
})();
document.addEventListener('click', e => UI.onClick(e));
// Touch: hold a card to read it (tap still acts). Mouse: hover as before.
(function touchPreview() {
  const HOLD = 380; let timer = null, sx = 0, sy = 0, lastTouch = 0, quiet = 0, shown = false;
  const target = e => e.target.closest && e.target.closest('.card[data-cid], .card[data-aid]');
  const hide = () => { clearTimeout(timer); timer = null; if (shown) { shown = false; $('#zoom').innerHTML = ''; $('#zoom').classList.remove('touch'); UI._z = null; } };
  document.addEventListener('mouseover', e => { if (Date.now() - lastTouch < 1000) return; UI.hover(e); });
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    lastTouch = Date.now(); hide();
    const el = target(e); if (!el || el.classList.contains('lg') || el.closest('#zoom')) return;
    sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => {
      timer = null; shown = true; quiet = Infinity;
      UI.hover({ target: el });
      const z = $('#zoom'); z.classList.add('touch');
      if (navigator.vibrate) try { navigator.vibrate(12); } catch (x) {}
    }, HOLD);
  });
  document.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse' || shown || !timer) return;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { clearTimeout(timer); timer = null; }
  });
  const up = e => { if (e.pointerType === 'mouse') return; lastTouch = Date.now(); if (shown) quiet = Date.now() + 450; hide(); };
  document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  // a long press must not also count as a tap
  window.addEventListener('click', e => { if (quiet === Infinity || Date.now() < quiet) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('contextmenu', e => { if (target(e)) e.preventDefault(); });
})();
window.addEventListener('resize', () => Tut.reposition());
document.querySelectorAll('.chip').forEach(c => c.onclick = () => {
  App.bots = +c.dataset.bots;
  document.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c));
});
$('#btn-play').onclick = () => App.play(false);
$('#btn-tutorial').onclick = () => App.play(true);
$('#btn-rules').onclick = () => UI.rulesModal();
$('#btn-online').onclick = () => Net.menu();
try { const j = new URLSearchParams(location.search).get('join'); if (j) Net.menu(j); } catch (e) {}
