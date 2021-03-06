import { ReadableStream } from 'node:stream/web';

import test, { ExecutionContext } from 'ava';
import { testProp, fc } from 'ava-fast-check';
import { csvParseRows, csvFormatRow } from 'd3-dsv';

import { decodeStream, findLines, parseFields, parseNumber, parseRow, range, TableBuffer } from './csv.js';

fc.configureGlobal({ numRuns: 1000 })

const biasedStrings = fc.oneof(
  fc.constantFrom("-0", "NaN"),
  fc.stringOf(fc.constantFrom("\r", "\n", "x", ",")),
  fc.asciiString(),
  fc.fullUnicodeString()
);

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (e) {
    return false;
  }
  return true;
}

const arbitraryUtf8 = fc.fullUnicodeString().map((a) => new TextEncoder().encode(a));

const invalidUtf8Examples = fc.constantFrom(...[
  [0xff],
  [192, 128],
  [193, 128],
  [237, 160, 128],
].map((x) => Uint8Array.from(x)));

testProp('isUtf8 should be true for any Unicode string', [arbitraryUtf8], (t, a) => {
  t.true(isUtf8(a));
});

testProp('isUtf8 should be false for invalid UTF8', [invalidUtf8Examples], (t, a) => {
  t.false(isUtf8(a));
});

function chunkStream(b: Uint8Array, sizes: number[]) {
  let sent = 0;
  let i = 0;
  let done = false;
  return new ReadableStream<Uint8Array>({
    pull: (controller) => {
      if (done) {
        throw "pull called when done";
      } else if (i < sizes.length) {
        controller.enqueue(b.slice(sent, sent + sizes[i]));
        sent += sizes[i];
        i++;
      } else {
        controller.enqueue(b.slice(sent));
        controller.close();
        done = true;
      }
    }
  });
}

const arbitraryBinaryChunks = (input: fc.Arbitrary<Uint8Array>): fc.Arbitrary<[Uint8Array, ReadableStream<Uint8Array>]> =>
  fc.tuple(input, fc.array(fc.nat()))
    .filter(([b, ns]) => ns.reduce((a, b) => a + b, 0) <= b.length)
    .map(([b, ns]) => [b, chunkStream(b, ns)]);

const arbitraryUtf8Chunks = (input: fc.Arbitrary<string>): fc.Arbitrary<[string, ReadableStream<Uint8Array>]> =>
  fc.tuple(input, fc.array(fc.nat()))
    .map(([s, ns]) => [s, new TextEncoder().encode(s), ns] as const)
    .filter(([_, b, ns]) => ns.reduce((a, b) => a + b, 0) <= b.length)
    .map(([s, b, ns]) => [s, chunkStream(b, ns)]);

async function concat(t: ExecutionContext, input: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of input) {
    if (chunk.length == 0) {
      t.fail("got zero-length chunk");
    }
    out += chunk;
  }
  return out;
}

testProp('decodeStream should split the original string for valid Unicode',
  [arbitraryUtf8Chunks(fc.fullUnicodeString())], async (t, [expected, chunkStream]) => {
    const actual = await concat(t, decodeStream(chunkStream.getReader()));
    t.is(actual, expected);
  }, { numRuns: 1000 });

testProp('decodeStream should emit a replacement character for invalid Unicode',
  [arbitraryBinaryChunks(invalidUtf8Examples)], async (t, [_, chunkStream]) => {
    const actual = await concat(t, decodeStream(chunkStream.getReader()));
    t.true(actual.includes('???'));
  });

testProp('decodeStream should handle arbitrary binary data',
  [arbitraryBinaryChunks(fc.uint8Array())], async (t, [original, chunkStream]) => {
    const valid = isUtf8(original);
    const actual = await concat(t, decodeStream(chunkStream.getReader()));
    if (valid) {
      t.is(new TextDecoder().decode(original), actual);
    } else {
      t.true(actual.includes('???'));
    }
  });

test('decodeStream iterator should release the lock when return is called', async (t) => {
  const stream = chunkStream(Uint8Array.of(0), []);
  const iter: AsyncIterator<string> = decodeStream(stream.getReader())[Symbol.asyncIterator]();
  await iter.next();
  t.true(stream.locked);
  await iter.return();
  t.false(stream.locked);
});

test('decodeStream iterator should release the lock when throw is called', async (t) => {
  t.plan(3);
  const stream = chunkStream(Uint8Array.of(0), []);
  const iter: AsyncIterator<string> = decodeStream(stream.getReader())[Symbol.asyncIterator]();
  await iter.next();
  t.true(stream.locked);
  try {
    await iter.throw(123);
  } catch (e) {
    t.is(e, 123);
  }
  t.false(stream.locked);
});

async function* chunkGenerator(input: string, splits: number[]): AsyncIterable<string> {
  let seen = 0;
  for (const n of splits) {
    yield input.slice(seen, seen + n);
    seen += n;
  }
  yield input.slice(seen);
}

const arbitraryStringChunks = (input: fc.Arbitrary<string>): fc.Arbitrary<[string, AsyncIterable<string>]> =>
  fc.tuple(input, fc.array(fc.nat()))
    .filter(([s, ns]) => ns.reduce((a, b) => a + b, 0) <= s.length)
    .map(([s, ns]) => [s, chunkGenerator(s, ns)]);

testProp('findLines should generate complete lines',
  [arbitraryStringChunks(biasedStrings)], async (t, [original, input]) => {
    const expected = original.split(/\r?\n/);

    const actual = [];
    for await (const line of findLines(input)) {
      actual.push(line);
    }

    t.deepEqual(actual, expected);
  });

const arbitraryAsciiRecord = fc.array(fc.string(), { minLength: 2 });

testProp('parseFields should allow fields with printable ascii characters', [arbitraryAsciiRecord], async (t, original) => {
  if (original[0].startsWith("#")) {
    t.pass(); // except for comments
    return;
  }
  const line = csvFormatRow(original);
  const actual = parseFields(line);
  t.deepEqual(actual, original);
});

testProp('parseFields should parse the same way as d3 or refuse', [biasedStrings], (t, input) => {
  const actual = parseFields(input);
  if (actual) {
    const expected = csvParseRows(input)[0];
    t.deepEqual(actual, expected);
  } else {
    t.is(actual, null);
  }
}, { examples: [["0\n"], [" 0"]] });

testProp('parseFields should parse quoted strings as one-row records', [fc.string()], (t, input) => {
  const quoted = input.includes('"') ? csvFormatRow([input]) : `"${input}"`;
  const actual = parseFields(quoted);
  t.deepEqual(actual, [input]);
});

const specialDoubles = new Set(["inf", "nan"]);

const arbitraryDoubles = fc.oneof(
  fc.double().map((n) => n + ""),
  fc.constantFrom(...specialDoubles.keys()));

testProp('parseFields should parse doubles as one-row records', [arbitraryDoubles], (t, input) => {
  t.deepEqual(parseFields(input), [input]);
});

const arbitraryNonNumber = fc.string().filter(
  (s) => !specialDoubles.has(s.trim().toLowerCase()) && isNaN(+s) && s.match(/[,"]/) == null);

const arbitraryNonCSV = fc.string().filter((s) => s.match(/^[^ 0-9,\+\-\."][^,]*$/) != null);

testProp('parseFields should reject non-CSV lines', [arbitraryNonCSV], (t, input) => {
  t.is(parseFields(input), null);
});

testProp('parseFields should reject comments', [biasedStrings], (t, input) => {
  t.is(parseFields('#' + input), null);
});


testProp('parseNumber should accept numbers as themselves', [fc.double({ next: true })], (t, input) => {
  input = (input == 0) ? 0 : input; // filter -0
  t.is(parseNumber(`${input}`), input);
});

testProp('parseNumber should reject non-numbers', [arbitraryNonNumber], (t, input) => {
  t.is(parseNumber(input), null);
});

testProp('parseNumber should always return numbers that round-trip', [biasedStrings], (t, input) => {
  t.plan(1);
  const n = parseNumber(input);
  if (n == null) {
    t.pass();
    return;
  }
  const n2 = parseNumber(`${n}`);
  t.is(n2, n);
});

testProp('parseRow should parse rows with all numbers as data', [fc.array(fc.double({ next: true }), { minLength: 1 })], (t, input) => {
  const row = parseRow(input.join(","));
  const fixedZeros = input.map((n) => n == 0 ? 0 : n);
  t.deepEqual(row, { kind: "data", values: fixedZeros });
});

testProp('parseRow should parse rows with all numbers and a trailing comma as data', [fc.array(fc.double({ next: true }), { minLength: 1 })], (t, input) => {
  const row = parseRow(input.join(",") + ",");
  const fixedZeros = input.map((n) => n == 0 ? 0 : n);
  t.deepEqual(row, { kind: "data", values: fixedZeros });
});

testProp('parseRow should parse rows with a non-number as a header, or reject', [fc.array(fc.double()), arbitraryNonNumber, fc.array(fc.double())], (t, prefix, field, suffix) => {
  const isComment = (prefix.length == 0 && field.startsWith("#"));
  const input = ([] as (string | number)[]).concat(prefix, [field], suffix);
  const row = parseRow(input.join(","));
  if (input.length == 1 || isComment) {
    t.is(row, null);
  } else {
    t.is(row.kind, "header");
  }
});

testProp('Iterating over a range should return the values in that range', [fc.nat(), fc.nat()], (t, start, len) => {
  const end = start + len;
  const r = range(start, end);
  t.is(r.length, len);
  let expectedI = start;
  for (let i of r) {
    t.is(i, expectedI);
    expectedI++;
    if (expectedI - start > 1000) {
      break; // just check the beginning.
    }
  }
  if (len < 1000) {
    t.is(expectedI, end);
  }
});

testProp('Different ranges should compare equal if constructed with the same values',
  [fc.nat(), fc.nat()], (t, aStart, aLen) => {
    const a = range(aStart, aStart + aLen);
    const a2 = range(aStart, aStart + aLen);
    t.is(a.equals(a2), true);
});

testProp('Ranges should compare nonequal when they contain different values',
  [fc.nat(), fc.nat(), fc.nat(), fc.nat()], (t, aStart, aLen, bStart, bLen) => {
    const a = range(aStart, aStart + aLen);
    const b = range(bStart, bStart + bLen);
    t.is(a.equals(b), aStart == bStart && aLen == bLen);
});

testProp('TableBuffer should preserve the last data rows added to the current table', [fc.nat(), fc.array(fc.boolean())], (t, limit, rowTypes) => {

  const buf = new TableBuffer(limit);
  t.is(buf.slice(), null);
  let tablesAdded = 0;
  let rowsAdded = 0;
  let columnName = null;
  for (let isHeader of rowTypes) {
    if (isHeader) {
      tablesAdded += 1;
      columnName = `table ${tablesAdded}`;
      buf.push({ kind: "header", fields: [columnName] });
      rowsAdded = 0;
    } else {
      buf.push({ kind: "data", values: [rowsAdded] });
      if (tablesAdded == 0) {
        columnName = "Column 1";
        tablesAdded = 1;
      }
      rowsAdded += 1;
    }

    const table = buf.slice();
    t.is(table.key, tablesAdded);
    t.deepEqual(table.columnNames, [columnName], `should have column named "${columnName}"`);

    const rowStart = rowsAdded > limit ? rowsAdded - limit : 0;
    t.is(table.rows.start, rowStart);
    t.is(table.rows.end, rowsAdded);
    t.is(table.columns.length, 1);

    const col = table.columns[0];
    t.is(col.key, `${tablesAdded}-${columnName}`);
    t.is(col.name, columnName);

    t.deepEqual(col.range, range(rowStart, rowsAdded));
    t.is(col.values.length, rowsAdded - rowStart);
    for (let i = 0; i < rowsAdded - rowStart; i++) {
      t.is(col.values[i], i + rowStart);
    }
  }
  return true;
}, { numRuns: 100 });
