// GEN3IA — Réparation de JSON malformé produit par les modèles de langage.
// Les LLM émettent parfois du JSON tronqué ou déséquilibré (accolades manquantes,
// virgules traînantes). Cette étape défensive évite de perdre une commande valide.
// Aucun comportement magique : on répare uniquement ce qui est prouvablement
// réparable, sinon on renvoie null (l'appelant affiche l'erreur honnête).

/** Répare un JSON "presque valide" produit par un LLM. Retourne null si irréparable. */
export function repairJson(input: string): unknown | null {
  if (typeof input !== 'string' || input.length === 0) return null

  // 1. retirer les clôtures de blocs de code et espaces parasites
  let text = input.replace(/```(?:json)?/gi, '').trim()

  // 2. délimiter : du premier ouvrant au dernier fermant
  const firstObj = text.indexOf('{')
  const firstArr = text.indexOf('[')
  const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr)
  if (start === -1) return null
  const lastObj = text.lastIndexOf('}')
  const lastArr = text.lastIndexOf(']')
  const end = Math.max(lastObj, lastArr)
  if (end <= start) return null
  text = text.slice(start, end + 1)

  // 3. tentatives en cascade
  const attempts = [
    text,
    stripTrailingCommas(text),
    balanceClosers(stripTrailingCommas(text)),
    truncateToValidJson(stripTrailingCommas(text)),
  ]
  for (const candidate of attempts) {
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object') return parsed
    } catch { /* essai suivant */ }
  }
  return null
}

/** Supprime les virgules immédiatement avant ] ou } (hors chaînes). */
function stripTrailingCommas(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (escaped) { escaped = false; out += ch; continue }
    if (ch === '\\' && inString) { escaped = true; out += ch; continue }
    if (ch === '"') inString = !inString
    if (!inString && ch === ',') {
      // lookahead : prochain caractère significatif
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] === ']' || text[j] === '}') continue // virgule traînante → omise
    }
    out += ch
  }
  return out
}

/** Ferme les accolades/crochets restés ouverts (hors chaînes). */
function balanceClosers(text: string): string | null {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\' && inString) { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') {
      const expected = stack.pop()
      // déséquilibre profond (fermant sans ouvrant) → irréparable ici
      if (expected !== ch) return null
    }
  }
  if (inString) return null // chaîne non fermée : hors périmètre
  if (stack.length === 0) return null // rien à réparer
  return text + stack.reverse().join('')
}

/** Tronque au dernier préfixe syntaxiquement complet et ferme les structures. */
function truncateToValidJson(text: string): string | null {
  // essayer chaque coupe sur un fermant, du plus long au plus court
  for (let cut = text.length; cut > 2; cut--) {
    const ch = text[cut - 1]
    if (ch !== '}' && ch !== ']') continue
    const candidate = balanceClosers(stripTrailingCommas(text.slice(0, cut)))
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object') return candidate
    } catch { /* coupe suivante */ }
  }
  return null
}
