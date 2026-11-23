/** Match nested delimiters in extended Markdown metadata, including mixed-width pairs typed with a Chinese IME. */
export function markdownFieldParentheses(source: string): Map<number, number> {
  const closes = new Map<number, number>();
  const stack: number[] = [];
  const asciiCloses = new Map<number, number>();
  const asciiStack: number[] = [];
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '\\') {
      index++;
      continue;
    }
    if (char === '(') asciiStack.push(index);
    if (char === ')' && asciiStack.length) asciiCloses.set(asciiStack.pop()!, index);
    if (char === '(' || char === '（') {
      stack.push(index);
    } else if ((char === ')' || char === '）') && stack.length) {
      // Metadata itself uses ASCII parentheses; a full-width mark inside
      // plain prose should not close its lone outer delimiter.
      if (char === ')' || stack.length > 1 || source[stack[0]] === '（') closes.set(stack.pop()!, index);
    }
  }
  for (const [start, end] of asciiCloses) if (!closes.has(start)) closes.set(start, end);
  return closes;
}

export function markdownFence(line: string): string | undefined {
  return line.match(/^\s*(`{3,}|~{3,})/)?.[1];
}

export function closesMarkdownFence(line: string, opening: string): boolean {
  const marker = line.trim();
  return marker.length >= opening.length && Array.from(marker).every(char => char === opening[0]);
}
