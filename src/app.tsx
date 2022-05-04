'use strict';

import { h, render, Component, createRef } from 'preact';
import { Terminal } from 'xterm';

class Start extends Component<{ onConnect: (port: SerialPort) => void }, { choosing: boolean }> {
  state = { choosing: false }

  choosePort = async () => {
    this.setState({ choosing: true });

    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch (e) {
      this.setState({ choosing: false });
      throw e;
    }

    const info = port.getInfo();
    console.log(`Connecting to ${info.usbVendorId} ${info.usbProductId}`);
    this.props.onConnect(port);
  }

  render() {
    return <button id="connect" onClick={this.choosePort} disabled={this.state.choosing}>Connect</button>;
  }
}

type PortStatus = "connecting" | "reading" | "closing" | "closed" | "portGone";

interface PortState {
  status: PortStatus;
  chunks: (Uint8Array | string)[];
  chunksRead: number;
}

class App {

  port: SerialPort;
  appElt: Element;

  status = "connecting" as PortStatus;
  chunks = [] as (Uint8Array | string)[];
  chunksAdded = 0;
  reader = null as ReadableStreamDefaultReader<Uint8Array>;

  constructor(port: SerialPort, appElt: Element) {
    this.port = port;
    this.appElt = appElt;

    // Automatically close the serial port when another tab opens.
    window.addEventListener("storage", (e: StorageEvent) => {
      if (e.key == "openingSerialPort") {
        if (this.reader != null) {
          this.reader.cancel();
        }
      }
    });
    this.renderView();
    this.openPort();
  }

  renderView() {
    const state = { status: this.status, chunks: this.chunks, chunksRead: this.chunksAdded };
    render(<PortView state={state} stop={this.stop} restart={this.restart} finishedChunks={this.finishedChunks} />, this.appElt);
  }

  renderChunk(chunk: Uint8Array | string) {
    this.chunks = this.chunks.concat([chunk]);
    this.chunksAdded += 1;
    this.renderView();
  }

  renderMessage(message: string) {
    this.renderChunk(`\r\n*** ${message} ***\r\n`);
  }

  renderStatus(status: PortStatus, options = {} as { message: string }) {
    this.status = status;
    if (options.message) {
      this.renderMessage(options.message);
    } else {
      this.renderView();
    }
  }

  renderFatal(message: any) {
    this.renderStatus("portGone", { message: message + "" });
  }

  openPort = async () => {
    if (this.status != "connecting") return;
    // Tell other windows to close the serial port.
    // This ensures we don't try to read the same serial port at the same time.
    // See: https://bugs.chromium.org/p/chromium/issues/detail?id=1319178
    localStorage.openingSerialPort = Date.now();

    // Give them a chance to pause.
    await new Promise(resolve => setTimeout(resolve, 100));
    if (this.status != "connecting") return;

    try {
      await this.port.open({
        baudRate: 115200,
        bufferSize: 40,
        flowControl: "hardware",
      });

      this.reader = this.port.readable.getReader();
      this.renderStatus("reading");
    } catch (e) {
      this.renderFatal(e);
      return;
    }
    this.copyToTerminal();
  }

  copyToTerminal = async () => {
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) {
          return;
        }
        this.renderChunk(value);
      }
    } catch (e) {
      this.renderFatal(e);
    } finally {
      this.reader.releaseLock();
      this.reader = null;
      try {
        await this.port.close();
        if (this.status != "portGone") {
          this.renderStatus("closed", { message: "Closed" });
        }
      } catch (e) {
        this.renderFatal(e);
      }
    }
  }

  stop = () => {
    if (this.status == "reading") {
      if (this.reader != null) {
        this.reader.cancel();
      }
      this.renderStatus("closing");
    }
  }

  restart = () => {
    if (this.status == "closed") {
      this.chunks = [];
      this.chunksAdded = 0;
      this.renderStatus("connecting");
      this.openPort();
    }
  }

  finishedChunks = (done: number) => {
    const todo = this.chunksAdded - done;
    if (todo == this.chunks.length) return; // no change
    if (todo == 0) {
      this.chunks = [];
    } else {
      this.chunks = this.chunks.slice(-todo);
    }
  }
}

const PortView = (props: { state: PortState, stop: () => void, restart: () => void, finishedChunks: (n: number) => void }) => {

  const button = () => {
    switch (props.state.status) {
      case "reading":
        return <button onClick={props.stop}>Stop</button>;
      case "closed":
        return <button onClick={props.restart}>Restart</button>;
      default:
        return <button disabled={true}>Stop</button>;
    }
  }
  return <div>
    <div>
      {button()}
    </div>
    <TermView chunks={props.state.chunks} chunksRead={props.state.chunksRead} finishedChunks={props.finishedChunks} />
  </div>;
}

class TermView extends Component<{ chunks: (Uint8Array | string)[], chunksRead: number, finishedChunks: (n: number) => void }, {}> {
  terminal = new Terminal({
    rows: 50,
    scrollback: 0,
  });
  chunksWritten = 0;

  terminalElt = createRef();

  reader = null as ReadableStreamDefaultReader<Uint8Array>;

  componentDidMount() {
    this.terminal.open(this.terminalElt.current);
    this.componentDidUpdate();
  }

  componentDidUpdate() {
    const sent = this.props.chunksRead;
    if (sent == 0) {
      if (this.chunksWritten > 0) {
        this.terminal.clear();
        this.chunksWritten = 0;
      }
      return;
    }

    const chunks = this.props.chunks;
    const start = this.chunksWritten;
    for (let todo = sent - this.chunksWritten; todo > 0; todo--) {
      this.terminal.write(chunks[chunks.length - todo]);
      this.chunksWritten++;
    }
    if (this.chunksWritten - start > 0) {
      this.props.finishedChunks(this.chunksWritten);
    }
  }

  render() {
    return <div id="terminal" ref={this.terminalElt}></div>
  }
}

function main() {
  const appElt = document.getElementById("app") as HTMLDivElement;
  render(<Start onConnect={(port) => new App(port, appElt)} />, appElt);
}

main();
