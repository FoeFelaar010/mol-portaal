// Maakt van Arduino-coderegels (losse Word-alinea's) een gekleurd codeblok dat je kunt aanpassen en kopiëren.
// Overgenomen uit code.js van de Lovable-site.
const isCode = (t) =>
  /^\s*(void |#define|#include|int |const |float |long |bool |byte |unsigned |\}|\/\/|for\s*\(|if\s*\(|else|while\s*\()/.test(t) ||
  /^\s{2,}\S/.test(t) || /[;{}]\s*(\/\/.*)?$/.test(t)

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const KW = /\b(void|int|const|float|long|bool|byte|unsigned|char|if|else|for|while|return|#define|#include)\b/
const FN = /\b(setup|loop|pinMode|digitalWrite|digitalRead|analogWrite|analogRead|delay|map|Serial|begin|println|print|tone|noTone|millis|random)\b/
const CO = /\b(HIGH|LOW|OUTPUT|INPUT|INPUT_PULLUP|true|false|LED_BUILTIN)\b/

function highlight(src) {
  return src.split('\n').map((line) => {
    let code = line, comment = ''
    const i = line.indexOf('//')
    if (i >= 0) { code = line.slice(0, i); comment = line.slice(i) }
    const out = code.split(/(#?\b\w+\b)/).map((p) => {
      if (KW.test(p) && p.match(KW)[0] === p) return `<span class="ck">${esc(p)}</span>`
      if (FN.test(p) && p.match(FN)[0] === p) return `<span class="cf">${esc(p)}</span>`
      if (CO.test(p) && p.match(CO)[0] === p) return `<span class="cc">${esc(p)}</span>`
      if (/^\d+$/.test(p)) return `<span class="cn">${p}</span>`
      return esc(p)
    }).join('')
    return out + (comment ? `<span class="cm">${esc(comment)}</span>` : '')
  }).join('\n')
}

export function maakCodeblokken(root) {
  const done = new Set()
  let n = 0
  for (const p of [...root.querySelectorAll('p')]) {
    if (done.has(p) || !isCode(p.textContent) || p.closest('.code')) continue
    const group = [p]
    let nx = p.nextElementSibling
    while (nx && nx.tagName === 'P' && isCode(nx.textContent)) { group.push(nx); nx = nx.nextElementSibling }
    group.forEach((g) => done.add(g))
    if (group.length < 2) continue
    const src = group.map((g) => g.textContent.replace(/ /g, ' ')).join('\n')
    const box = document.createElement('div')
    box.className = 'code'
    box.innerHTML = `<div class="code-bar"><span>sketch_${++n}.ino</span><button type="button" class="code-copy">📋 Kopieer code</button></div><pre class="code-hl" aria-hidden="true"></pre><textarea class="code-ed" spellcheck="false" aria-label="Code, je mag hem aanpassen"></textarea><div class="code-tip">✏️ Je mag de code hier aanpassen. Daarna kopiëren.</div>`
    const ed = box.querySelector('.code-ed'), hl = box.querySelector('.code-hl')
    const sync = () => { hl.innerHTML = highlight(ed.value) + '\n'; ed.style.height = hl.scrollHeight + 'px' }
    ed.value = src
    ed.addEventListener('input', sync)
    ed.addEventListener('scroll', () => { hl.scrollLeft = ed.scrollLeft })
    box.querySelector('.code-copy').addEventListener('click', async (e) => {
      const b = e.currentTarget
      try { await navigator.clipboard.writeText(ed.value) } catch { ed.select(); document.execCommand('copy') }
      b.textContent = '✓ Gekopieerd!'
      setTimeout(() => { b.textContent = '📋 Kopieer code' }, 1800)
    })
    p.before(box)
    group.forEach((g) => g.remove())
    requestAnimationFrame(sync)
  }
}
