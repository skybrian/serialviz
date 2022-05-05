export async function* decodeStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const result = decoder.decode(new Uint8Array(0));
        if (result.length > 0) yield result;
        return;
      }
      const result = decoder.decode(value, { stream: true })
      if (result.length > 0) yield result;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* findLines(input: AsyncIterable<string>): AsyncIterable<string> {
  let prefix = "";
  for await (let chunk of input) {
    if (prefix.endsWith('\r')) {
      chunk = prefix.slice(-1) + chunk;
      prefix = prefix.slice(0, -1);
    }
    const lines = chunk.split(/\r?\n/);
    if (lines.length == 1) {
      prefix += lines[0];
      continue;
    }
    yield prefix + lines[0];
    yield* lines.slice(1, lines.length - 1);
    prefix = lines[lines.length - 1];
  }
  yield prefix;
}

const NEWLINE = 10;
const RETURN = 13;
const COMMA = 44;
const QUOTE = 34;
const END = Symbol("END");
type Token = string | typeof END | typeof NO_MATCH;

const NO_MATCH = Symbol("NO_MATCH");

export interface Row {
  key: number;
  line: string;
  fields: string[];
}

/** Given something that looks like a CSV row (without the line ending), returns its fields. */
export function parseRow(key: number, input: string): Row | null {
  if (input.length == 0) return null; // skip blank lines
  if (!input.startsWith("\"") && !input.includes(",")) {
    // check for a number
    if (input.match(/[\r\n]/)) return null; // only handle single-line input
    if (input.trim().length > 0 && !isNaN(+input)) return { key: key, line: input, fields: [input] };
    return null; // line doesn't look like CSV
  }

  // if (!input.includes('"')) {
  //   return input.split(",");
  // }
  let seen = 0;
  let done = false;

  function parseField(): Token {
    if (done) return END;

    const start = seen;

    // Handle quoted field
    if (input.charCodeAt(seen) === QUOTE) {
      while (true) {
        seen++;
        if (seen >= input.length) {
          return NO_MATCH; // unterminated quote
        }
        const c = input.charCodeAt(seen);
        if (c === QUOTE) {
          seen++;
          const c = input.charCodeAt(seen);
          if (seen >= input.length) done = true;
          else if (c === QUOTE) continue;
          else if (c != COMMA) {
            return NO_MATCH; // something after a quoted field other than a comma; disallowed.
          }
          seen++;
          return input.slice(start + 1, seen - 2).replace(/""/g, "\"");
        } else if (c === NEWLINE || c === RETURN) {
          return NO_MATCH; // multiline quotes disallowed
        }
      }
    }

    // Handle unquoted field, if any
    while (true) {
      if (seen >= input.length) {
        done = true;
        return input.slice(start);
      }
      const c = input.charCodeAt(seen);
      seen++;
      if (c === COMMA) {
        return input.slice(start, seen - 1);
      } else if (c === QUOTE || c === NEWLINE || c === RETURN) {
        return NO_MATCH;
      }
    }
  }

  const fields = [];
  while (true) {
    const t = parseField();
    if (t == END) return { key: key, line: input, fields: fields };
    else if (t == NO_MATCH) return null;
    else fields.push(t);
  }
}
