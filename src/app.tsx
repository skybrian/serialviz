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

interface PortState {
  status: "connecting" | "reading" | "closing" | "done";
  chunks: (Uint8Array | string)[];
  chunksRead: number;
}

class PortView extends Component<{ defaultPort: SerialPort }, PortState> {
  port = this.props.defaultPort; // ignore any changes

  state = { status: "connecting", chunks: [], chunksRead: 0 } as PortState;
  reader: ReadableStreamDefaultReader<Uint8Array>;

  write(chunk: Uint8Array | string) {
    this.setState((state) => ({
      chunks: state.chunks.concat([chunk]),
      chunksRead: state.chunksRead + 1
    }));
  }

  writeStatus(message: any) {
    this.write(`\n*** ${message} ***\n`);
  }

  componentDidMount() {
    // Automatically close the serial port when another tab opens.
    window.addEventListener("storage", (e: StorageEvent) => {
      if (e.key == "openingSerialPort") {
        if (this.reader != null) {
          this.reader.cancel();
        }
      }
    });
    this.openPort();
  }

  componentDidUpdate(_: any, prev: PortState) {
    if (prev.status == "reading" && this.state.status == "closing") {
      if (this.reader != null) {
        this.reader.cancel();
      }
    }
    if (prev.status == "done" && this.state.status == "connecting") {
      this.openPort();
    }
  }

  openPort = async () => {
    if (this.state.status != "connecting") return;
    // Tell other windows to close the serial port.
    // This ensures we don't try to read the same serial port at the same time.
    // See: https://bugs.chromium.org/p/chromium/issues/detail?id=1319178
    localStorage.openingSerialPort = Date.now();

    // Give them a chance to pause.
    await new Promise(resolve => setTimeout(resolve, 100));
    if (this.state.status != "connecting") return;

    try {
      await this.port.open({
        baudRate: 115200,
        bufferSize: 40,
        flowControl: "hardware",
      });

      this.reader = this.port.readable.getReader();
      this.setState({ status: "reading" });
      this.copyToTerminal();
    } catch (e) {
      this.writeStatus(e);
      this.setState({ status: "done" });
    }
  }

  copyToTerminal = async () => {
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) {
          return;
        }
        this.write(value);
      }
    } catch (e) {
      this.writeStatus(e);
    } finally {
      this.reader.releaseLock();
      this.reader = null;
      try {
        await this.port.close();
      } catch (e) {
        this.writeStatus(e);
      }
      this.setState({ status: "done" });
    }
  }

  stop = () => {
    if (this.state.status == "reading") {
      this.setState({ status: "closing" });
    }
  }

  restart = () => {
    if (this.state.status == "done") {
      this.setState({ status: "connecting", chunks: [], chunksRead: 0 });
    }
  }

  finishedChunks = (done: number) => {
    const todo = this.state.chunksRead - done;
    if (this.state.chunks.length > todo) {
      this.setState((state) => ({ chunks: todo > 0 ? state.chunks.slice(-todo) : [] }));
    }
  }

  render() {
    const button = () => {
      switch (this.state.status) {
        case "connecting":
          return <button disabled={true}>Stop</button>;
        case "reading":
          return <button onClick={this.stop}>Stop</button>;
        case "closing":
          return <button disabled={true}>Stop</button>;
        case "done":
          return <button onClick={this.restart}>Restart</button>;
      }
    }

    return <div>
      <div>
        {button()}
      </div>
      <TermView chunks={this.state.chunks} chunksRead={this.state.chunksRead} finishedChunks={this.finishedChunks} />
    </div>;
  }
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

const appElt = document.getElementById("app") as HTMLDivElement;

function showLog(port: SerialPort) {
  render(<PortView defaultPort={port} />, appElt);
}

render(<Start onConnect={showLog} />, appElt);
