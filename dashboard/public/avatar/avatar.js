// Robot avatar sitting on the Apply-now disc. renderAvatar(status) is called with the same /api/status object renderStatus uses.
(() => {
  const CAPTION = { idle: 'Ready', search: 'Searching', review: 'Reading the job', tailor: 'Tailoring', send: 'Sending', success: 'Applied!' };
  const SUCCESS_MS = 6000;
  const SUIT = 'fill="url(#botSuit)" stroke="#B3BAC5" stroke-width=".8"';
  const LEG = 'fill="url(#botLeg)" stroke="#B3BAC5" stroke-width=".8"';
  const shin = (x, side) => `<g class="bot-shin bot-shin-${side}">
      <rect x="${x}" y="228" width="24" height="80" rx="7" ${LEG}/>
      <path d="M${x + 12} 238 V304" stroke="#D3D8DF"/>
      <rect x="${x + 2}" y="304" width="20" height="9" fill="#15171C"/>
      <path d="M${x - 2} 312 H${x + 24} Q${x + 42} 314 ${x + 46} 328 V336 H${x - 4} Q${x - 7} 322 ${x - 2} 312 Z" fill="#F4F5F7" stroke="#9AA2AE" stroke-width=".8"/>
      <rect x="${x - 6}" y="333" width="54" height="7" rx="3.5" fill="#15171C"/>
      <path d="M${x + 8} 318 L${x + 22} 316 M${x + 10} 323 L${x + 26} 321" stroke="#15171C" stroke-width="2.2" stroke-linecap="round"/>
    </g>`;
  const SVG = `<svg class="bot-svg" viewBox="0 0 240 350" aria-hidden="true">
    <defs>
      <linearGradient id="botSuit" x1="0" x2="1"><stop offset="0" stop-color="#D9DEE5"/><stop offset=".45" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C6CCD5"/></linearGradient>
      <linearGradient id="botLeg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D3D8DF"/></linearGradient>
      <linearGradient id="botHelm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C3CAD4"/></linearGradient>
      <linearGradient id="botVisor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1D2433"/><stop offset="1" stop-color="#06080C"/></linearGradient>
    </defs>
    <ellipse cx="104" cy="233" rx="56" ry="5" fill="rgba(10,0,3,.35)"/>

    <!-- props held in the raised right hand -->
    <g class="bot-prop" data-s="search">
      <path d="M206 53 L209 64" stroke="#2A2F38" stroke-width="5" stroke-linecap="round"/>
      <circle cx="212" cy="40" r="14" fill="rgba(95,211,166,.18)" stroke="#E6E9EE" stroke-width="4"/>
      <path class="bot-glint" d="M205 34 Q209 30 214 31" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
    </g>
    <g class="bot-prop" data-s="review tailor">
      <rect x="188" y="8" width="44" height="54" rx="4" fill="#F2E7D5" stroke="rgba(90,31,39,.3)"/>
      <rect x="193" y="14" width="22" height="4" rx="1.5" fill="#5A1F27"/>
      ${[34, 28, 32, 24, 30].map((w, i) => `<rect class="bot-line" style="--i:${i}" x="193" y="${25 + i * 7}" width="${w}" height="3" rx="1.5" fill="#CFB8AC"/>`).join('')}
      <rect class="bot-scan" x="188" y="8" width="44" height="2.5" rx="1" fill="#5FD3A6"/>
      ${[[183, 12], [236, 30], [230, 68]].map(([x, y], i) => `<path class="bot-spark" style="--i:${i}" d="M${x} ${y - 5} L${x + 1.3} ${y - 1.3} L${x + 5} ${y} L${x + 1.3} ${y + 1.3} L${x} ${y + 5} L${x - 1.3} ${y + 1.3} L${x - 5} ${y} L${x - 1.3} ${y - 1.3} Z" fill="#E3AE57"/>`).join('')}
    </g>
    <g class="bot-prop bot-env" data-s="send">
      <rect x="192" y="34" width="36" height="24" rx="3" fill="#F2E7D5" stroke="rgba(90,31,39,.3)"/>
      <path d="M192 35 L210 48 L228 35" fill="none" stroke="#5A1F27" stroke-width="1.6"/>
    </g>
    <g class="bot-prop bot-check" data-s="success"><circle cx="206" cy="44" r="15" fill="#5FD3A6"/><path d="M199 44 l5 5 l9 -10" fill="none" stroke="#12352A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>

    <g class="bot-arm bot-arm-r">
      <rect x="135" y="120" width="18" height="90" rx="9" ${SUIT}/>
      <rect x="136" y="202" width="16" height="7" rx="2" fill="#F7F8FA"/>
      <rect x="135" y="208" width="18" height="16" rx="6" fill="#AEB5C0" stroke="#7D8591" stroke-width=".8"/>
    </g>

    <!-- seated legs: thighs go forward over the disc, shins hang over its face -->
    <path d="M66 204 L138 216 Q150 218 150 230 L148 240 L66 232 Z" ${LEG}/>
    ${shin(124, 'b')}
    <path d="M70 210 L190 220 Q204 222 204 236 L202 246 L70 238 Z" ${LEG}/>
    ${shin(178, 'f')}

    <rect x="89" y="92" width="26" height="22" fill="#3A404B"/><rect x="86" y="108" width="32" height="5" rx="2" fill="#2A2F38"/>
    <path d="M60 122 Q102 110 144 122 L150 136 L146 212 L58 212 L54 136 Z" ${SUIT}/>
    <path d="M90 116 L114 116 L102 162 Z" fill="#F7F8FA"/>
    <path d="M98 116 L106 116 L105 124 L99 124 Z" fill="#0B0C0F"/>
    <path d="M99 124 L105 124 L107 132 L104 172 L102 178 L100 172 L97 132 Z" fill="#15171C"/>
    <path d="M90 116 L82 140 L95 147 L102 162 M114 116 L122 140 L109 147 L102 162 M102 162 V210" fill="none" stroke="#AEB6C1" stroke-width=".9"/>
    <circle cx="106" cy="188" r="2" fill="#8E96A2"/>
    <path d="M64 196 h14 M126 196 h14" stroke="#AEB6C1"/>
    <path d="M118 136 L122 131 L124 135 L127 132 L128 136 Z" fill="#15171C"/>
    <rect x="114" y="138" width="18" height="9" rx="1.5" fill="#FFFFFF" stroke="#9AA2AE" stroke-width=".5"/>
    <text x="123" y="144.6" text-anchor="middle" font-size="5" font-family="system-ui,sans-serif" font-weight="700" fill="#15171C" class="bot-badge"></text>

    <g class="bot-head">
      <rect x="49" y="44" width="10" height="28" rx="4" fill="#2A2F38"/><rect x="145" y="44" width="10" height="28" rx="4" fill="#2A2F38"/>
      <path d="M57 48 Q57 3 102 3 Q147 3 147 48 V76 Q147 94 128 94 H76 Q57 94 57 76 Z" fill="url(#botHelm)" stroke="#AEB6C1" stroke-width=".8"/>
      <path d="M70 22 Q84 9 104 9" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity=".9"/>
      <rect x="63" y="36" width="78" height="38" rx="16" fill="url(#botVisor)" stroke="#06080C"/>
      <g class="bot-eyes"><rect class="bot-eye" x="80" y="47" width="13" height="15" rx="4"/><rect class="bot-eye" x="111" y="47" width="13" height="15" rx="4"/></g>
      <path class="bot-happy" d="M80 59 Q86.5 47 93 59 M111 59 Q117.5 47 124 59" fill="none" stroke="#5FD3A6" stroke-width="4" stroke-linecap="round"/>
      <path d="M70 42 Q76 38 86 38" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity=".18"/>
    </g>

    <g class="bot-arm bot-arm-l">
      <rect x="51" y="120" width="18" height="94" rx="9" ${SUIT}/>
      <rect x="52" y="207" width="16" height="7" rx="2" fill="#F7F8FA"/>
      <path d="M51 213 H69 Q74 213 74 218 V226 Q74 231 69 231 H51 Q46 231 46 226 V218 Q46 213 51 213 Z" fill="#AEB5C0" stroke="#7D8591" stroke-width=".8"/>
      <path d="M54 223 v7 M60 223 v7 M66 223 v7" stroke="#7D8591" stroke-width=".8"/>
    </g>
  </svg>`;

  const disc = document.getElementById('runBtn');
  const bot = document.createElement('div');
  bot.className = 'bot'; bot.dataset.state = 'idle'; bot.setAttribute('aria-hidden', 'true');   // decorative: the disc and steps already say what is happening
  bot.innerHTML = `${SVG}<div class="bot-confetti"></div><span class="bot-caption">Ready</span>`;
  disc.prepend(bot);

  // Which run step is happening now. Pure, so it can be tested.
  const stateOf = s => {
    const stage = s?.run?.running ? s.run.stage : null;
    if (stage === 'find') return 'search';
    if (stage === 'send') return 'send';
    if (stage === 'tailor' || s?.adding?.stage === 'tailoring' || s?.applying) return 'tailor';
    if (s?.adding?.stage === 'reading') return 'review';
    return 'idle';
  };

  let prev = 'idle', until = 0, timer;
  function set(state) {
    if (bot.dataset.state === state) return;
    bot.dataset.state = state;
    bot.querySelector('.bot-caption').textContent = CAPTION[state];
    if (state === 'success') confetti();
  }
  function confetti() {
    const box = bot.querySelector('.bot-confetti'), colors = ['#5FD3A6', '#E3AE57', '#F2E7D5', '#FF9890'];
    box.innerHTML = Array.from({ length: 22 }, (_, i) =>
      `<i style="background:${colors[i % 4]};--x:${Math.round(Math.cos(i * 1.7) * 90)}px;--y:${Math.round(Math.sin(i * 1.7) * 60 - 50)}px;animation-delay:${i * 18}ms"></i>`).join('');
  }
  window.renderAvatar = status => {
    bot.querySelector('.bot-badge').textContent = String(status?.candidate || '').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
    const now = stateOf(status);
    // Tailoring or sending just ended without an error: celebrate for a few seconds, then back to idle.
    if (['tailor', 'send'].includes(prev) && now === 'idle' && !status?.lastRun?.error && status?.adding?.stage !== 'error') {
      until = Date.now() + SUCCESS_MS;
      clearTimeout(timer); timer = setTimeout(() => window.renderAvatar(status), SUCCESS_MS);
    }
    prev = now;
    set(now === 'idle' && Date.now() < until ? 'success' : now);
  };
  window.avatarStateOf = stateOf;
})();
