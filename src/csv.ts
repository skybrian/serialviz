export {  decodeStream }

async function* decodeStream(input: ReadableStream) : AsyncIterable<string> {
  const reader = input.getReader();
  const decoder = new TextDecoder("utf-8", {fatal: false});
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const result = decoder.decode(Uint8Array.from([]));
        if (result.length > 0) yield result;
        return;
      }
      const result = decoder.decode(value, {stream: true})
      if (result.length > 0) yield result;
    }
  } finally {
    reader.releaseLock();
  }
}
