'use strict';

import { render } from 'preact';
import { decodeStream, findLines, parseRow } from './csv';
import { AppState } from './state';

import { ConnectView, AppView } from './view';

const choosePort = (elt: Element): Promise<SerialPort> => {
  return new Promise((resolve) => {

    const serial = navigator.serial;

    const choose = async () => {
      try {
        const port = await serial.requestPort();
        const info = port.getInfo();
        console.log(`Connecting to ${info.usbVendorId} ${info.usbProductId}`);
        resolve(port);
      } catch (e) {
        console.log(e);
      }
    }

    render(ConnectView({ haveSerial: Boolean(serial), onClick: choose }), elt);
  });
}

class PortReaderTask {
  #readers = [] as ReadableStreamGenericReader[];
  #tasks = [] as Promise<any>[];

  constructor(readonly port: SerialPort, readonly state: AppState) { }

  async connect() {
    try {
      await this.port.open({
        baudRate: 115200,
        bufferSize: 40,
        flowControl: "hardware",
      });

      if (this.state.requestChange("reading")) {
        this.#tasks.push(this.#parseRows(this.port.readable));
      }

      this.#closePortWhenDone();
    } catch (e) {
      this.state.fatal(e);
      return;
    }
  }

  cancel(): void {
    for (let reader of this.#readers) {
      this.#tasks.push(reader.cancel());
    }
    this.#readers = [];
  }

  async #parseRows(stream: ReadableStream) {
    try {
      const reader = stream.getReader();
      this.#readers.push(reader);

      for await (let line of findLines(decodeStream(reader))) {
        this.state.pushLog(line);
        const row = parseRow(line);
        if (row) {
          this.state.pushRow(row);
        }
      }
    } finally {
      await stream.cancel();
    }
  }

  async #closePortWhenDone() {
    for (let task = this.#tasks.shift(); task; task = this.#tasks.shift()) {
      try {
        await task;
      } catch (e) {
        this.state.fatal(e);
      }
    }

    try {
      await this.port.close();
      this.state.requestChange("closed", { message: "Closed" });
    } catch (e) {
      this.state.fatal(e);
    }
  }
}

const main = async () => {
  const appElt = document.getElementById("app") as HTMLDivElement;

  const port = await choosePort(appElt);

  const state = new AppState();

  state.addEventListener("save", () => render(AppView(state.props), appElt));

  const task = new PortReaderTask(port, state);

  const connectUnlessCancelled = async () => {
    // Tell other windows to close the serial port.
    // This ensures we don't try to read the same serial port at the same time.
    // See: https://bugs.chromium.org/p/chromium/issues/detail?id=1319178
    localStorage.openingSerialPort = Date.now();

    // Give them a chance to pause.
    await new Promise(resolve => setTimeout(resolve, 100));

    if (state.status == "connecting") {
      task.connect();
    } else {
      console.log("connect cancelled");
    }
  }

  // Automatically close the serial port when another tab opens.
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key == "openingSerialPort") {
      state.requestClose();
    }
  });

  state.addEventListener("status", () => {
    switch (state.status) {
      case "connecting":
        connectUnlessCancelled();
        break;
      case "closing":
        task.cancel();
        break;
    }
  });

  let timeoutID = null as number;
  window.addEventListener("resize", function() {
    window.clearTimeout(timeoutID);
    timeoutID = window.setTimeout(() => { state.windowChanged() }, 250);
  })

  state.requestChange("connecting");
}

main();
