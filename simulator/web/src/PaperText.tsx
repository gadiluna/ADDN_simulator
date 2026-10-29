import type { ReactNode } from 'react';
import './paper-math.css';

/** Typeset the simulator's controlled paper notation, leaving other text literal.
 * This is deliberately not a TeX interpreter: no markup is evaluated and no
 * values are parsed as numbers, so exact integers remain unchanged.
 */
function typeset(text: string, depth = 0): ReactNode[] {
  if (depth > 8) return [text];
  const tokens = /[Σ∑]_\{|(?<![\p{L}\p{N}_])[𝓛𝓗𝓥μdsIoGE]_(?:\([^()]*\)|\{[^{}]*\}|[−-]?\d+|[A-Za-zℓ])(?:\^\+)?(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])[abAqz]\([^()]*\)|(?<![\p{L}\p{N}_])[vx]\d+(?![\p{L}\p{N}_])|[𝓛𝓗𝓥𝓖ℓΣ∑]|(?<![\p{L}_])[mnhtruvwxqVL](?![\p{L}_])/gu;
  const result: ReactNode[] = [];
  let cursor = 0;
  for (let match = tokens.exec(text); match; match = tokens.exec(text)) {
    const start = match.index;
    const token = match[0];
    result.push(text.slice(cursor, start));
    cursor = tokens.lastIndex;
    if (token === 'Σ_{' || token === '∑_{') {
      let end = cursor;
      let braces = 1;
      while (end < text.length && braces) {
        if (text[end] === '{') braces++;
        else if (text[end] === '}') braces--;
        end++;
      }
      if (braces) {
        // A malformed bound is text, never a truncated or fabricated formula.
        result.push(token);
        continue;
      }
      const bound = text.slice(cursor, end - 1);
      result.push(<span className="paper-sum paper-symbol" key={start}>
        <span className="paper-sum-sign">∑</span>
        <sub className="paper-sum-bound">{typeset(bound, depth + 1)}</sub>
      </span>);
      cursor = end;
      tokens.lastIndex = end;
      continue;
    }
    const indexed = /^([𝓛𝓗𝓥μdsIoGE])_(.*?)(\^\+)?$/u.exec(token);
    if (indexed) {
      const [, symbol, rawIndex, plus] = indexed;
      const index = /^[({]/.test(rawIndex) ? rawIndex.slice(1, -1) : rawIndex;
      result.push(<span className="paper-symbol paper-indexed" key={start}>
        <span className={/^[dsIoGE]$/.test(symbol) ? 'paper-variable' : undefined}>{symbol}</span>
        <sub>{typeset(index.replace(/-/g, '−'), depth + 1)}</sub>
        {plus && <sup>+</sup>}
      </span>);
      continue;
    }
    const call = /^([abAqz])\(([^()]*)\)$/.exec(token);
    if (call) {
      const [, symbol, argumentsText] = call;
      const className = symbol === 'a' || symbol === 'b' ? 'paper-anonymity' : symbol === 'A' ? 'paper-fiber' : 'paper-variable';
      result.push(<span className="paper-symbol" key={start}>
        <span className={className}>{symbol}</span>({typeset(argumentsText, depth + 1)})
      </span>);
      continue;
    }
    const numbered = /^([vx])(\d+)$/.exec(token);
    if (numbered) {
      result.push(<span className="paper-symbol paper-indexed" key={start}>
        <span className="paper-variable">{numbered[1]}</span><sub>{numbered[2]}</sub>
      </span>);
      continue;
    }
    result.push(<span className={`paper-symbol${/^[mnhtruvwxqVL]$/.test(token) ? ' paper-variable' : ''}`} key={start}>{token === 'Σ' ? '∑' : token}</span>);
  }
  result.push(text.slice(cursor));
  return result;
}

export default function PaperText({ children }: { children: string }) {
  return <span className="paper-text" data-notation={children}>{typeset(children)}</span>;
}
