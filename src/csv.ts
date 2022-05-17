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
  kind: "header";
  fields: string[];
}

export interface DataRow {
  kind: "data";
  values: number[];
}

export type Row = HeaderRow | DataRow;

export function parseRow(input: string): Row | null {
  const fields = parseFields(input);
  if (!fields) return null;

  const values = new Array<number>(fields.length);
  for (let i = 0; i < fields.length; i++) {
    const n = parseNumber(fields[i]);
    if (n == null) {
      return { kind: "header", fields: fields };
    }
    values[i] = n;
  }
  return { kind: "data", values: values };
}

export const range = (start: number, end: number) => new Range(start, end);

export class Range {
  constructor(readonly start: number, readonly end: number) {
    if (end < start) throw `invalid range: [${start}, ${end}]`;
  }

  get length() { return this.end - this.start; }

  contains(val: number): boolean {
    return val >= this.start && val <= this.end;
  }

  equals(b: Range): boolean {
    return this.start == b.start && this.end == b.end;
  }

  *[Symbol.iterator]() {
    for (let i = this.start; i < this.end; i++) {
      yield i;
    }
  }

  toString(): string {
    return `range(${this.start}, ${this.end})`;
  }
}

export interface TableSlice {
  key: number;
  columnNames: string[];
  range: Range;
  columns: ColumnSlice[];
}

export interface ColumnSlice {
  key: string;
  name: string;
  range: Range;
  values: Float64Array;
}

export class TableBuffer {
  #tablesSeen = 0;
  #columnNames = null as string[];
  #rowStart = 0;
  #rowEnd = 0;
  #columns = null as Float64Array[];

  constructor(readonly rowLimit: number) { }

  get key(): number { return this.#tablesSeen; }

  get columnNames(): string[] | null { return this.#columnNames; }

  get range(): Range {
    return range(this.#rowStart, this.#rowEnd);
  }

  slice(rowRange?: Range): TableSlice | null {
    if (this.#columnNames == null) return null;

    if (rowRange == null) {
      rowRange = this.range;
    } else {
      if (rowRange.start < this.#rowStart || rowRange.end > this.#rowEnd) {
        throw `range out of bounds: ${rowRange}`;
      }
    }

    const sliceStart = rowRange.start - this.#rowStart;
    const sliceEnd = rowRange.end - this.#rowStart;

    const columns = new Array<ColumnSlice>(this.#columnNames.length);
    for (let i = 0; i < columns.length; i++) {
      const name = this.#columnNames[i];
      columns[i] = {
        key: `${this.#tablesSeen}-${name}`,
        name: name,
        range: rowRange,
        values: this.#columns[i].slice(sliceStart, sliceEnd)
      };
    }

    return {
      key: this.#tablesSeen,
      columnNames: this.#columnNames,
      range: rowRange,
      columns: columns,
    };
  }

  clear() {
    this.#tablesSeen = 0;
    this.#columnNames = null;
    this.#rowStart = 0;
    this.#rowEnd = 0;
    this.#columns = null;
  }

  push(row: Row) {
    switch (row.kind) {
      case "header":
        this.#startTable(row.fields);
        break;
      case "data":
        if (this.#columnNames == null) {
          const columnNames = new Array(row.values.length).fill(0).map((_, i) => `Column ${i + 1}`);
          this.#startTable(columnNames);
        }
        this.#rowEnd++;
        if (this.#rowEnd > this.rowLimit) {
          // Scroll data to left.
          for (let col of this.#columns) {
            col.copyWithin(0, 1);
          }
          this.#rowStart++;
        }
        let y = this.#rowEnd - this.#rowStart - 1;
        for (let i = 0; i < this.#columns.length; i++) {
          this.#columns[i][y] = row.values.at(i);
        }

        break;
      default:
        throw "unexpected row kind: ${row.kind}";
    }
  }

  #startTable(columnNames: string[]) {
    this.#tablesSeen++;
    this.#columnNames = columnNames;
    this.#rowStart = 0;
    this.#rowEnd = 0;
    this.#columns = Array(columnNames.length);
    for (let i = 0; i < columnNames.length; i++) {
      this.#columns[i] = new Float64Array(this.rowLimit);
    }
  }
}
