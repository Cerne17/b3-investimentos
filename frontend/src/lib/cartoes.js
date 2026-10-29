// No celular, tabelas dentro de ".cartoes" viram um cartão por linha: cada célula ganha o rótulo da coluna
// (data-label, lido do cabeçalho) e o CSS mostra "rótulo: valor". Um observador mantém os rótulos em dia.
function rotular() {
  for (const tabela of document.querySelectorAll('.cartoes table')) {
    const cab = [...tabela.querySelectorAll('thead th')].map((th) => th.textContent.replace(/[↑↓]/g, '').trim())
    for (const tr of tabela.querySelectorAll('tbody tr')) {
      ;[...tr.children].forEach((td, i) => { if (!td.dataset.label && cab[i]) td.dataset.label = cab[i] })
    }
  }
}

export function ativarCartoes() {
  let pendente = false
  const agendar = () => {
    if (pendente) return
    pendente = true
    requestAnimationFrame(() => { pendente = false; rotular() })
  }
  new MutationObserver(agendar).observe(document.body, { childList: true, subtree: true })
  agendar()
}
