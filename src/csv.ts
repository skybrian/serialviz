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

export function parseNumber(input: string): number | null {
  input = input.trim();
  if (input.length == 0) return null;
  else if (input == "NaN") return NaN;
  else if (input == "-0") return 0;
  const parsed = +input;
  if (isNaN(parsed)) {
    return null;
  }
  return +input;
}

/** Given something that looks like a CSV row (without the line ending), returns its fields. */
export function parseFields(input: string): string[] | null {
  if (input.length == 0) return null; // skip blank lines
  if (!input.startsWith("\"") && !input.includes(",")) {
    // check for a number
    if (input.match(/[\r\n]/)) return null; // only handle single-line input
    if (input.trim().length > 0 && parseNumber(input) != null) return [input];
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
    if (t == END) return fields;
    else if (t == NO_MATCH) return null;
    else fields.push(t);
  }
}

export interface HeaderRow {
  key: number;
  kind: "header";
  fields: string[];
}

export interface DataRow {
  key: number;
  kind: "data";
  values: number[];
}

export type Row = HeaderRow | DataRow;

export function parseRow(key: number, input: string): Row | null {
  const fields = parseFields(input);
  if (!fields) return null;

  const values = new Array<number>(fields.length);
  for (let i = 0; i < fields.length; i++) {
    const n = parseNumber(fields[i]);
    if (n == null) {
      return { key: key, kind: "header", fields: fields };
    }
    values[i] = n;
  }
  return { key: key, kind: "data", values: values };
}

export interface Table {
  key: number;
  columnNames: string[];
  rows: DataRow[];
}

export class TableBuffer {
  #tables = [] as Table[];
  #tablesSeen = 0;
  #rowCount = 0;

  constructor(readonly rowLimit: number) { }

  get tables(): Table[] {
    let size = this.#tables.length;
    let last = this.#tables.at(-1);
    if (last && last.rows.length == 0) {
      size--;
    }
    return this.#tables.slice(0, size);
  }

  clear() {
    this.#tables = [];
    this.#tablesSeen = 0;
    this.#rowCount = 0;
  }

  push(row: Row) {
    switch (row.kind) {
      case "header":
        this.pushHeader(row.fields);
        break;
      case "data":
        if (this.#tables.length == 0) {
          const columnNames = new Array(row.values.length).map((_, i) => `Column ${i + 1}`);
          this.pushHeader(columnNames);
        }
        this.#tables.at(-1).rows.push(row);
        this.#rowCount++;
        if (this.#rowCount > this.rowLimit) {
          this.#tables[0].rows.shift();
          if (this.#tables[0].rows.length == 0) {
            this.#tables.shift();
          }
          this.#rowCount--;
        }
        break;
      default:
        throw "unexpected row kind: ${row.kind}";
    }
  }

  pushHeader(columnNames: string[]) {
    const last = this.#tables.at(-1);
    if (last && last.rows.length == 0) {
      this.#tables.pop();
    }
    this.#tables.push({ key: this.#tablesSeen, columnNames: columnNames, rows: [] });
    this.#tablesSeen++;
  }
}
